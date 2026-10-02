/**
 * AcpxWatcher: shows OpenClaw ACP sessions (~/.openclaw/acpx/sessions/*.json,
 * schema acpx.session.v1) as agents. Read-only; Claude ACP workers (agent id
 * `claude`) are skipped because transcript scanning already covers them.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { AgentStateStore } from './agentStateStore.js';
import { ACPX_IDLE_THRESHOLD_MS, ACPX_SCAN_INTERVAL_MS, TOOL_DONE_DELAY_MS } from './constants.js';
import { assignPaletteIfNeeded } from './paletteAssigner.js';
import { claudeProvider } from './providers/hook/claude/claude.js';
import type { AgentState } from './types.js';

export interface AcpxTool {
  id: string;
  name: string;
  input: unknown;
  done: boolean;
}

export interface AcpxSession {
  recordId: string;
  agentId: string;
  providerId: string;
  model?: string;
  cwd: string;
  closed: boolean;
  pid?: number;
  updatedAtMs: number;
  /** ToolUse blocks of the last Agent message */
  tools: AcpxTool[];
}

/** Antigravity tool name (after stripping "Executing ") -> Claude tool name, for status text + animation. */
const TOOL_ALIASES: Record<string, string> = {
  run_command: 'Bash',
  view_file: 'Read',
  view_file_outline: 'Read',
  view_code_item: 'Read',
  grep_search: 'Grep',
  find_by_name: 'Glob',
  list_dir: 'Glob',
  write_to_file: 'Write',
  replace_file_content: 'Edit',
  multi_replace_file_content: 'Edit',
  read_url_content: 'WebFetch',
  search_web: 'WebSearch',
};

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseAcpxRecord(raw: unknown): AcpxSession | null {
  if (!isObj(raw) || raw.schema !== 'acpx.session.v1') return null;
  const recordId = raw.acpx_record_id;
  if (typeof recordId !== 'string') return null;
  const agentId = recordId.split(':')[1];
  if (!agentId) return null;

  const argv = Array.isArray(raw.agent_argv) ? (raw.agent_argv as unknown[]) : [];
  const mIdx = argv.indexOf('-m');
  const model =
    mIdx >= 0 && typeof argv[mIdx + 1] === 'string' ? (argv[mIdx + 1] as string) : undefined;
  const command = typeof raw.agent_command === 'string' ? raw.agent_command : '';
  const providerId = command.includes('antigravity') ? 'antigravity' : agentId;

  const messages = Array.isArray(raw.messages) ? (raw.messages as unknown[]) : [];
  const tools: AcpxTool[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const agent = isObj(messages[i]) ? (messages[i] as Json).Agent : undefined;
    if (!isObj(agent)) continue;
    const results = isObj(agent.tool_results) ? agent.tool_results : {};
    const content = Array.isArray(agent.content) ? (agent.content as unknown[]) : [];
    for (const c of content) {
      const u = isObj(c) ? c.ToolUse : undefined;
      if (!isObj(u) || typeof u.id !== 'string' || typeof u.name !== 'string') continue;
      tools.push({
        id: u.id,
        name: u.name.replace(/^Executing /, ''),
        input: u.input,
        done: u.id in results,
      });
    }
    break;
  }

  const updated = Date.parse(String(raw.updated_at));
  return {
    recordId,
    agentId,
    providerId,
    model,
    cwd: typeof raw.cwd === 'string' ? raw.cwd : '',
    closed: raw.closed === true,
    pid: typeof raw.pid === 'number' ? raw.pid : undefined,
    updatedAtMs: Number.isNaN(updated) ? 0 : updated,
    tools,
  };
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

interface Tracked {
  id: number;
  seenTools: Set<string>;
}

export class AcpxWatcher {
  private readonly tracked = new Map<string, Tracked>(); // recordId -> agent
  private readonly parsed = new Map<string, { stamp: string; session: AcpxSession | null }>(); // file -> cache
  private timer: ReturnType<typeof setInterval> | null = null;
  private fsWatcher: fs.FSWatcher | null = null;
  private readonly isPidAlive: (pid: number) => boolean;

  constructor(
    private readonly store: AgentStateStore,
    private readonly dir: string,
    private readonly removeAgent: (id: number) => void,
    opts: { isPidAlive?: (pid: number) => boolean } = {},
  ) {
    this.isPidAlive = opts.isPidAlive ?? pidAlive;
  }

  start(): void {
    if (!fs.existsSync(this.dir)) return;
    console.log(`[Pixel Agents] Watching ACP sessions: ${this.dir}`);
    try {
      this.fsWatcher = fs.watch(this.dir, () => this.scan());
      this.fsWatcher.on('error', () => {});
    } catch {
      /* the poll below covers it */
    }
    this.timer = setInterval(() => this.scan(), ACPX_SCAN_INTERVAL_MS);
    this.scan();
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.fsWatcher?.close();
    this.fsWatcher = null;
  }

  scan(): void {
    let files: string[];
    try {
      files = fs.readdirSync(this.dir).filter((f) => f.endsWith('.json'));
    } catch {
      return;
    }
    const seen = new Set<string>();
    for (const f of files) {
      const full = path.join(this.dir, f);
      let entry = this.parsed.get(full);
      try {
        const st = fs.statSync(full);
        const stamp = `${st.mtimeMs}:${st.size}`;
        if (entry?.stamp !== stamp) {
          entry = {
            stamp,
            session: parseAcpxRecord(JSON.parse(fs.readFileSync(full, 'utf-8'))),
          };
          this.parsed.set(full, entry);
        }
      } catch {
        continue; // mid-write or vanished: retry next tick
      }
      if (!entry.session) continue;
      seen.add(entry.session.recordId);
      this.apply(entry.session);
    }
    for (const [full] of this.parsed) {
      if (!files.includes(path.basename(full))) this.parsed.delete(full);
    }
    // Record file deleted while its agent is tracked
    for (const [recordId, t] of this.tracked) {
      if (!seen.has(recordId)) this.drop(recordId, t);
    }
  }

  private drop(recordId: string, t: Tracked): void {
    this.tracked.delete(recordId);
    this.removeAgent(t.id);
  }

  private apply(s: AcpxSession): void {
    if (s.agentId === 'claude') return;
    let t = this.tracked.get(s.recordId);
    if (s.closed || (s.pid !== undefined && !this.isPidAlive(s.pid))) {
      if (t) this.drop(s.recordId, t);
      return;
    }
    if (!t) {
      t = { id: this.createAgent(s).id, seenTools: new Set() };
      // Tools that already finished before we noticed the session are history
      for (const tool of s.tools) if (tool.done) t.seenTools.add(tool.id);
      this.tracked.set(s.recordId, t);
    }
    const agent = this.store.get(t.id);
    if (!agent) return;

    for (const tool of s.tools) {
      if (!t.seenTools.has(tool.id)) {
        t.seenTools.add(tool.id);
        const toolName = TOOL_ALIASES[tool.name] ?? tool.name;
        const status = claudeProvider.formatToolStatus(toolName, tool.input);
        agent.activeToolIds.add(tool.id);
        agent.isWaiting = false;
        this.store.broadcast({
          type: 'agentToolStart',
          id: t.id,
          toolId: tool.id,
          status,
          toolName,
        });
        this.store.broadcast({ type: 'agentStatus', id: t.id, status: 'active' });
      }
      if (tool.done && agent.activeToolIds.delete(tool.id)) {
        const id = t.id;
        setTimeout(
          () => this.store.broadcast({ type: 'agentToolDone', id, toolId: tool.id }),
          TOOL_DONE_DELAY_MS,
        );
      }
    }

    if (!agent.isWaiting && Date.now() - s.updatedAtMs > ACPX_IDLE_THRESHOLD_MS) {
      agent.isWaiting = true;
      this.store.broadcast({ type: 'agentStatus', id: t.id, status: 'waiting' });
    }
  }

  private createAgent(s: AcpxSession): AgentState {
    const id = this.store.nextAgentId.current++;
    const agent: AgentState = {
      id,
      sessionId: s.recordId,
      terminalRef: undefined,
      isExternal: true,
      projectDir: s.cwd,
      jsonlFile: '',
      fileOffset: 0,
      lineBuffer: '',
      activeToolIds: new Set(),
      activeToolStatuses: new Map(),
      activeToolNames: new Map(),
      activeSubagentToolIds: new Map(),
      activeSubagentToolNames: new Map(),
      backgroundAgentToolIds: new Set(),
      isWaiting: false,
      permissionSent: false,
      hadToolsInTurn: false,
      hookDelivered: true,
      hooksOnly: true,
      lastDataAt: Date.now(),
      linesProcessed: 0,
      seenUnknownRecordTypes: new Set(),
      folderName: s.cwd ? path.basename(s.cwd) : undefined,
      agentName: s.model ? `${s.agentId} · ${s.model}` : s.agentId,
      providerId: s.providerId,
      model: s.model,
      acpxRecordId: s.recordId,
      contextTokens: 0,
      maxContextTokens: 0,
    };
    assignPaletteIfNeeded(agent, this.store);
    this.store.set(id, agent);
    console.log(
      `[Pixel Agents] ACP: Agent ${id} - ${agent.agentName} (${agent.folderName ?? '?'})`,
    );
    return agent;
  }
}
