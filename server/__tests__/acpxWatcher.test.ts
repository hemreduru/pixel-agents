import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AcpxWatcher, parseAcpxRecord } from '../src/acpxWatcher.js';
import { AgentStateStore } from '../src/agentStateStore.js';

const FIXTURES = path.join(__dirname, 'fixtures', 'acpx');
const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf-8'));

describe('parseAcpxRecord', () => {
  it('extracts agent id, model, cwd and tools from an Antigravity record', () => {
    const s = parseAcpxRecord(fixture('agy-pro.json'))!;
    expect(s.agentId).toBe('agy-pro');
    expect(s.model).toBe('gemini-3.1-pro-high');
    expect(s.providerId).toBe('antigravity');
    expect(s.cwd).toBe('/srv/projeler/claude-office');
    expect(s.closed).toBe(true);
    expect(s.tools.map((t) => t.name)).toEqual([
      'run_command',
      'view_file',
      'view_file',
      'run_command',
    ]);
  });

  it('falls back to the acpx agent id as provider and no model', () => {
    const s = parseAcpxRecord({
      schema: 'acpx.session.v1',
      acpx_record_id: 'agent:codex:acp:a:oneshot:b',
      agent_command: 'codex-acp',
      agent_argv: ['codex-acp'],
      cwd: '/x',
      messages: [],
    })!;
    expect(s.providerId).toBe('codex');
    expect(s.model).toBeUndefined();
    expect(s.tools).toEqual([]);
  });

  it('rejects other schemas and garbage', () => {
    expect(parseAcpxRecord({ schema: 'other' })).toBeNull();
    expect(parseAcpxRecord(null)).toBeNull();
  });
});

describe('AcpxWatcher lifecycle', () => {
  let dir: string;
  let store: AgentStateStore;
  let watcher: AcpxWatcher;
  let sent: Record<string, unknown>[];
  const removed: number[] = [];
  let tick = 0;

  const write = (name: string, patch: Record<string, unknown>) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, JSON.stringify({ ...fixture('agy-pro.json'), ...patch }));
    // distinct mtime per write so the watcher's change detection fires
    const t = new Date(1_700_000_000_000 + ++tick * 1000);
    fs.utimesSync(file, t, t);
  };
  const messages = (ids: string[], results: string[] = []) => [
    { User: { id: 'u', content: [{ Text: 't' }] } },
    {
      Agent: {
        content: ids.map((id) => ({ ToolUse: { id, name: 'Executing run_command', input: {} } })),
        tool_results: Object.fromEntries(results.map((id) => [id, { tool_use_id: id }])),
      },
    },
  ];

  beforeEach(() => {
    vi.useFakeTimers();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acpx-'));
    store = new AgentStateStore();
    sent = [];
    store.on('broadcast', (m) => sent.push(m));
    removed.length = 0;
    watcher = new AcpxWatcher(
      store,
      dir,
      (id) => {
        removed.push(id);
        store.delete(id);
      },
      { isPidAlive: () => true },
    );
  });
  afterEach(() => {
    watcher.dispose();
    vi.useRealTimers();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('ignores records that are already closed at startup', () => {
    write('a.json', { closed: true });
    watcher.scan();
    expect(store.size).toBe(0);
  });

  it('skips claude agents', () => {
    write('a.json', { closed: false, acpx_record_id: 'agent:claude:acp:x:oneshot:y' });
    watcher.scan();
    expect(store.size).toBe(0);
  });

  it('ignores open records whose pid is dead', () => {
    const dead = new AcpxWatcher(store, dir, () => {}, { isPidAlive: () => false });
    write('a.json', { closed: false });
    dead.scan();
    expect(store.size).toBe(0);
    dead.dispose();
  });

  it('open -> tool -> closed', () => {
    write('a.json', { closed: false, messages: [] });
    watcher.scan();
    expect(store.size).toBe(1);
    const agent = [...store.values()][0];
    expect(agent.folderName).toBe('claude-office');
    expect(agent.agentName).toBe('agy-pro · gemini-3.1-pro-high');
    expect(agent.providerId).toBe('antigravity');
    expect(agent.model).toBe('gemini-3.1-pro-high');

    write('a.json', { closed: false, messages: messages(['s1']) });
    watcher.scan();
    expect(sent.find((m) => m.type === 'agentToolStart')).toMatchObject({
      id: agent.id,
      toolId: 's1',
      toolName: 'Bash',
    });
    expect(sent.some((m) => m.type === 'agentStatus' && m.status === 'active')).toBe(true);

    write('a.json', { closed: false, messages: messages(['s1'], ['s1']) });
    watcher.scan();
    vi.advanceTimersByTime(1000);
    expect(sent.some((m) => m.type === 'agentToolDone' && m.toolId === 's1')).toBe(true);

    write('a.json', { closed: true });
    watcher.scan();
    expect(removed).toEqual([agent.id]);
    expect(store.size).toBe(0);
  });

  it('marks an open record idle after 60s without updates', () => {
    write('a.json', {
      closed: false,
      updated_at: new Date().toISOString(),
      messages: messages(['s1']),
    });
    watcher.scan();
    sent.length = 0;
    vi.advanceTimersByTime(61_000);
    watcher.scan();
    expect(sent.some((m) => m.type === 'agentStatus' && m.status === 'waiting')).toBe(true);
  });
});
