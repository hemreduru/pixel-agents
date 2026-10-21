/**
 * AcpxWatcher: shows OpenClaw ACP sessions (~/.openclaw/acpx/sessions/*.json,
 * schema acpx.session.v1) as agents. Read-only; Claude ACP workers (agent id
 * `claude`) are skipped because transcript scanning already covers them.
 */

import * as fs from 'fs';
import * as path from 'path';

import { type CanonicalWorkerId, resolveWorkerIdentity } from '../../core/src/workerIdentity.js';
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
  /** Human-readable task summary extracted from User message */
  taskLabel?: string;
  /** Formatted status of the most recent tool used in this session */
  lastToolStatus?: string;
}

/** Antigravity tool name (after stripping "Executing ") -> Claude tool name, for status text + animation. */
const TOOL_ALIASES: Record<string, string> = {
  run_command: 'Bash',
  view_file: 'Read',
  view_file_outline: 'Read',
  view_code_item: 'Read',
  read_file: 'Read',
  grep_search: 'Grep',
  find_by_name: 'Glob',
  list_dir: 'Glob',
  write_to_file: 'Write',
  write_file: 'Write',
  replace_file_content: 'Edit',
  multi_replace_file_content: 'Edit',
  edit_file: 'Edit',
  read_url_content: 'WebFetch',
  search_web: 'WebSearch',
  invoke_subagent: 'Task',
};

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Extract a concise human-readable task summary from ACPX `messages`.
 */
export function extractAcpxTaskSummary(messages: unknown[]): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  const userTexts: string[] = [];
  for (const msg of messages) {
    const user = isObj(msg) ? msg.User : undefined;
    if (!isObj(user) || !Array.isArray(user.content)) continue;
    const parts: string[] = [];
    for (const block of user.content) {
      if (!isObj(block)) continue;
      if (typeof block.Text === 'string') parts.push(block.Text);
      else if (typeof block.text === 'string') parts.push(block.text);
    }
    const joined = parts.join('\n').trim();
    if (joined) userTexts.push(joined);
  }
  if (userTexts.length === 0) return undefined;

  const rawText = userTexts.find((t) => !t.startsWith('[Inter-session message]')) ?? userTexts[0];

  const stripped = rawText
    .replace(/<\/?USER_REQUEST>/gi, '')
    .replace(/^\[Inter-session message\][^\n]*\n?/i, '')
    .replace(/İlk iş\s+\S*ekip\/\S+\.md\s+dosyasını oku ve uy\.?/gi, '')
    .replace(/First read\s+\S*ekip\/\S+\.md\s+and follow it\.?/gi, '');

  for (const rawLine of stripped.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line) continue;
    if (
      /^#+\s*(context|bağlam|goal|hedef|görev|amaç|task|brief|brifing|sorun|problem)\s*:?\s*$/i.test(
        line,
      )
    ) {
      continue;
    }
    if (
      /^(context|bağlam|goal|hedef|görev|amaç|task|brief|brifing|sorun|problem)\s*:?\s*$/i.test(
        line,
      )
    ) {
      continue;
    }
    line = line
      .replace(/^(?:#+\s*)?(?:task|görev|hedef|amaç|brief|brifing)\s*:\s*/i, '')
      .replace(/^#+\s*/, '')
      .replace(/^[-*•]\s+/, '')
      .replace(/\*\*/g, '')
      .replace(/`/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!line) continue;
    return line.length > 64 ? `${line.slice(0, 63).trimEnd()}…` : line;
  }
  return undefined;
}

export function parseAcpxRecord(raw: unknown): AcpxSession | null {
  if (!isObj(raw) || raw.schema !== 'acpx.session.v1') return null;
  const recordId = raw.acpx_record_id;
  if (typeof recordId !== 'string') return null;
  const agentId = recordId.split(':')[1];
  if (!agentId) return null;

  const argv = Array.isArray(raw.agent_argv) ? (raw.agent_argv as unknown[]) : [];
  const mIdx = argv.findIndex((a) => a === '-m' || a === '--model');
  const model =
    mIdx >= 0 && typeof argv[mIdx + 1] === 'string' ? (argv[mIdx + 1] as string) : undefined;
  const command = typeof raw.agent_command === 'string' ? raw.agent_command : '';
  const launch = [command, ...argv.filter((a): a is string => typeof a === 'string')].join(' ');
  const providerId = launch.includes('cursor-agent')
    ? 'cursor'
    : launch.includes('antigravity') || /\bagy\b/.test(launch)
      ? 'antigravity'
      : launch.includes('claude')
        ? 'claude'
        : agentId;

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

  let lastToolStatus: string | undefined;
  for (let i = messages.length - 1; i >= 0 && !lastToolStatus; i--) {
    const agent = isObj(messages[i]) ? (messages[i] as Json).Agent : undefined;
    if (!isObj(agent)) continue;
    const content = Array.isArray(agent.content) ? (agent.content as unknown[]) : [];
    for (let j = content.length - 1; j >= 0; j--) {
      const u = isObj(content[j]) ? (content[j] as Json).ToolUse : undefined;
      if (!isObj(u) || typeof u.name !== 'string') continue;
      const rawName = u.name.replace(/^Executing /, '');
      const toolName = TOOL_ALIASES[rawName] ?? rawName;
      lastToolStatus = claudeProvider.formatToolStatus(toolName, u.input);
      break;
    }
  }

  const taskLabel = extractAcpxTaskSummary(messages);
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
    taskLabel,
    lastToolStatus,
  };
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false; // kill(0, 0) signals the whole process group
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function resolveAcpxFolderName(cwd: string, workerId?: string): string | undefined {
  if (!cwd) return undefined;
  const base = path.basename(cwd);
  if (!base) return undefined;
  if (base.toLowerCase() === 'workspace' && workerId !== 'nuri') {
    return undefined;
  }
  return base;
}

interface Tracked {
  id: number;
  seenTools: Set<string>;
}

export class AcpxWatcher {
  private readonly tracked = new Map<string, Tracked>(); // trackKey -> agent
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
    console.log(`[Pixel Agents] Watching ACP sessions: ${this.dir}`);
    if (fs.existsSync(this.dir)) {
      try {
        this.fsWatcher = fs.watch(this.dir, () => this.scan());
        this.fsWatcher.on('error', () => {});
      } catch {
        /* the poll below covers it */
      }
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

  private isSessionActive(s: AcpxSession): boolean {
    return !s.closed && (s.pid === undefined || this.isPidAlive(s.pid));
  }

  scan(): void {
    let files: string[];
    try {
      files = fs
        .readdirSync(this.dir)
        .filter((f) => f.endsWith('.json'))
        .sort();
    } catch {
      return;
    }
    const seen = new Set<string>();
    const bestByWorker = new Map<CanonicalWorkerId, AcpxSession>();
    const unknownSessions: AcpxSession[] = [];

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
      const session = entry?.session;
      if (!session || session.agentId === 'claude') continue;

      const identity = resolveWorkerIdentity(session.agentId, undefined);
      if (identity.isKnownWorker && identity.workerId) {
        const prev = bestByWorker.get(identity.workerId);
        if (!prev) {
          bestByWorker.set(identity.workerId, session);
        } else {
          const prevActive = this.isSessionActive(prev);
          const nextActive = this.isSessionActive(session);
          if (
            (nextActive && !prevActive) ||
            (nextActive === prevActive && session.updatedAtMs >= prev.updatedAtMs)
          ) {
            bestByWorker.set(identity.workerId, {
              ...session,
              taskLabel: session.taskLabel ?? prev.taskLabel,
              lastToolStatus: session.lastToolStatus ?? prev.lastToolStatus,
            });
          } else if (!prev.taskLabel || !prev.lastToolStatus) {
            bestByWorker.set(identity.workerId, {
              ...prev,
              taskLabel: prev.taskLabel ?? session.taskLabel,
              lastToolStatus: prev.lastToolStatus ?? session.lastToolStatus,
            });
          }
        }
      } else {
        unknownSessions.push(session);
      }
    }

    for (const [workerId, session] of bestByWorker) {
      const key = `worker:${workerId}`;
      seen.add(key);
      this.apply(key, session, workerId);
    }

    for (const session of unknownSessions) {
      seen.add(session.recordId);
      this.apply(session.recordId, session, undefined);
    }

    for (const [full] of this.parsed) {
      if (!files.includes(path.basename(full))) this.parsed.delete(full);
    }
    // Record file deleted while its agent is tracked
    for (const [trackKey, t] of this.tracked) {
      if (!seen.has(trackKey)) this.drop(trackKey, t);
    }
  }

  private drop(trackKey: string, t: Tracked): void {
    this.tracked.delete(trackKey);
    this.removeAgent(t.id);
  }

  private apply(trackKey: string, s: AcpxSession, workerId?: CanonicalWorkerId): void {
    const isFinished = !this.isSessionActive(s);
    let t = this.tracked.get(trackKey);

    if (isFinished) {
      if (!workerId) {
        if (t) this.drop(trackKey, t);
        return;
      }
      // Known worker: persist at desk in finished/idle state
      if (!t) {
        const agent = this.createAgent(s, workerId, true);
        t = { id: agent.id, seenTools: new Set(s.tools.map((tool) => tool.id)) };
        this.tracked.set(trackKey, t);
        this.store.broadcast({ type: 'agentStatus', id: agent.id, status: 'waiting' });
        return;
      }
      const agent = this.store.get(t.id);
      if (!agent) return;
      if (agent.activeToolIds.size > 0) {
        agent.activeToolIds.clear();
        agent.activeToolStatuses.clear();
        agent.activeToolNames.clear();
        this.store.broadcast({ type: 'agentToolsClear', id: t.id });
      }
      const wasWaiting = agent.isWaiting;
      const wasFinished = agent.isFinished;
      agent.isWaiting = true;
      this.syncAgentMetadata(agent, s, workerId, true);
      if (!wasWaiting || !wasFinished) {
        this.store.broadcast({ type: 'agentStatus', id: t.id, status: 'waiting' });
      }
      return;
    }

    if (!t) {
      t = { id: this.createAgent(s, workerId, false).id, seenTools: new Set() };
      // Tools that already finished before we noticed the session are history
      for (const tool of s.tools) if (tool.done) t.seenTools.add(tool.id);
      this.tracked.set(trackKey, t);
    } else {
      const existing = this.store.get(t.id);
      if (existing) {
        if (existing.acpxRecordId !== s.recordId) {
          t.seenTools.clear();
          for (const tool of s.tools) if (tool.done) t.seenTools.add(tool.id);
          if (existing.isFinished) {
            existing.isWaiting = false;
          }
        }
        this.syncAgentMetadata(existing, s, workerId, false);
      }
    }

    const agent = this.store.get(t.id);
    if (!agent) return;

    const current = new Set(s.tools.map((tool) => tool.id));
    for (const toolId of [...agent.activeToolIds]) {
      if (!current.has(toolId)) {
        agent.activeToolIds.delete(toolId);
        agent.activeToolStatuses.delete(toolId);
        agent.activeToolNames.delete(toolId);
        this.broadcastToolDone(t.id, toolId);
      }
    }

    for (const tool of s.tools) {
      if (!t.seenTools.has(tool.id)) {
        t.seenTools.add(tool.id);
        const toolName = TOOL_ALIASES[tool.name] ?? tool.name;
        const status = claudeProvider.formatToolStatus(toolName, tool.input);
        agent.activeToolIds.add(tool.id);
        agent.activeToolStatuses.set(tool.id, status);
        agent.activeToolNames.set(tool.id, toolName);
        agent.lastToolStatus = status;
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
        agent.activeToolStatuses.delete(tool.id);
        agent.activeToolNames.delete(tool.id);
        this.broadcastToolDone(t.id, tool.id);
      }
    }

    if (
      !agent.isWaiting &&
      agent.activeToolIds.size === 0 &&
      Date.now() - s.updatedAtMs > ACPX_IDLE_THRESHOLD_MS
    ) {
      agent.isWaiting = true;
      this.store.broadcast({ type: 'agentStatus', id: t.id, status: 'waiting' });
    }
  }

  private syncAgentMetadata(
    agent: AgentState,
    s: AcpxSession,
    workerId: CanonicalWorkerId | undefined,
    isFinished: boolean,
  ): void {
    const nextAgentName = s.model ? `${s.agentId} · ${s.model}` : s.agentId;
    const nextFolderName = resolveAcpxFolderName(s.cwd, workerId);
    const nextTaskLabel = s.taskLabel ?? agent.taskLabel;
    const nextLastToolStatus = s.lastToolStatus ?? agent.lastToolStatus;
    const changed =
      agent.agentName !== nextAgentName ||
      agent.providerId !== s.providerId ||
      agent.model !== s.model ||
      agent.folderName !== nextFolderName ||
      agent.taskLabel !== nextTaskLabel ||
      agent.lastToolStatus !== nextLastToolStatus ||
      agent.isFinished !== isFinished;

    agent.sessionId = s.recordId;
    agent.acpxRecordId = s.recordId;
    agent.projectDir = s.cwd;
    agent.folderName = nextFolderName;
    agent.agentName = nextAgentName;
    agent.providerId = s.providerId;
    agent.model = s.model;
    agent.taskLabel = nextTaskLabel;
    agent.lastToolStatus = nextLastToolStatus;
    agent.isFinished = isFinished;

    if (changed) {
      this.store.broadcast({
        type: 'agentCreated',
        id: agent.id,
        folderName: agent.folderName,
        isExternal: agent.isExternal || undefined,
        hooksOnly: agent.hooksOnly || undefined,
        palette: agent.palette,
        hueShift: agent.hueShift,
        agentName: agent.agentName,
        providerId: agent.providerId ?? 'claude',
        model: agent.model,
        seatId: agent.seatId,
        workerId: agent.workerId,
        taskLabel: agent.taskLabel,
        lastToolStatus: agent.lastToolStatus,
        isFinished: agent.isFinished,
      });
    }
  }

  private broadcastToolDone(id: number, toolId: string): void {
    setTimeout(
      () => this.store.broadcast({ type: 'agentToolDone', id, toolId }),
      TOOL_DONE_DELAY_MS,
    );
  }

  private createAgent(
    s: AcpxSession,
    workerId?: CanonicalWorkerId,
    isFinished = false,
  ): AgentState {
    const id = this.store.nextAgentId.current++;
    const agentName = s.model ? `${s.agentId} · ${s.model}` : s.agentId;
    const identity = resolveWorkerIdentity(agentName, undefined);
    const resolvedWorkerId = workerId ?? identity.workerId;
    const persistedSeats = this.store.getAdapter()?.loadSeats() ?? {};
    const persistedSeat = resolvedWorkerId
      ? persistedSeats[`worker:${resolvedWorkerId}`]
      : persistedSeats[`record:${s.recordId}`];

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
      isWaiting: isFinished,
      permissionSent: false,
      hadToolsInTurn: false,
      hookDelivered: true,
      hooksOnly: true,
      lastDataAt: Date.now(),
      linesProcessed: 0,
      seenUnknownRecordTypes: new Set(),
      folderName: resolveAcpxFolderName(s.cwd, resolvedWorkerId),
      agentName,
      providerId: s.providerId,
      model: s.model,
      acpxRecordId: s.recordId,
      contextTokens: 0,
      maxContextTokens: 0,
      workerId: resolvedWorkerId,
      seatId: persistedSeat?.seatId ?? identity.defaultSeatId,
      palette: persistedSeat?.palette,
      hueShift: persistedSeat?.hueShift,
      taskLabel: s.taskLabel,
      lastToolStatus: s.lastToolStatus,
      isFinished,
    };
    assignPaletteIfNeeded(agent, this.store);
    this.store.set(id, agent);
    console.log(
      `[Pixel Agents] ACP: Agent ${id} - ${agent.agentName} (${agent.folderName ?? '?'})`,
    );
    return agent;
  }
}
