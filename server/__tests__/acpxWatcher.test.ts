import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AcpxWatcher, extractAcpxTaskSummary, parseAcpxRecord } from '../src/acpxWatcher.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { ACPX_SCAN_INTERVAL_MS } from '../src/constants.js';

const FIXTURES = path.join(__dirname, 'fixtures', 'acpx');
const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf-8'));

describe('parseAcpxRecord', () => {
  it('extracts agent id, model, cwd and tools from an Antigravity record', () => {
    const s = parseAcpxRecord(fixture('agy-pro.json'))!;
    expect(s.agentId).toBe('agy-pro');
    expect(s.model).toBe('gemini-3.1-pro-high');
    expect(s.providerId).toBe('antigravity');
    expect(s.cwd).toBe('/tmp/demo-project');
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

  const record = (agentId: string, command: string, argv: string[]) => ({
    schema: 'acpx.session.v1',
    acpx_record_id: `agent:${agentId}:acp:a:oneshot:b`,
    agent_command: command,
    agent_argv: argv,
    cwd: '/x',
    messages: [],
  });

  it('detects Cursor from the agent command and reads --model', () => {
    const s = parseAcpxRecord(
      record('cursor-opus', '/opt/bin/cursor-agent --model sonnet-5.5 acp', [
        '/opt/bin/cursor-agent',
        '--model',
        'sonnet-5.5',
        'acp',
      ]),
    )!;
    expect(s.providerId).toBe('cursor');
    expect(s.model).toBe('sonnet-5.5');
  });

  it('detects Cursor from argv alone', () => {
    const s = parseAcpxRecord(record('cursor-composer', '', ['cursor-agent', 'acp']))!;
    expect(s.providerId).toBe('cursor');
    expect(s.model).toBeUndefined();
  });

  it('detects Antigravity from argv alone and reads -m', () => {
    const s = parseAcpxRecord(
      record('agy-flash', '', ['/opt/antigravity/bin/agy', '-m', 'gemini-3.8-flash']),
    )!;
    expect(s.providerId).toBe('antigravity');
    expect(s.model).toBe('gemini-3.8-flash');
  });

  it('rejects other schemas and garbage', () => {
    expect(parseAcpxRecord({ schema: 'other' })).toBeNull();
    expect(parseAcpxRecord(null)).toBeNull();
  });

  it('detects Claude provider when agent_command or agent_argv contains claude', () => {
    const s = parseAcpxRecord(
      record('selim-yedek', 'node /home/nuri/.openclaw/bin/claude-agent-acp-wrapper.mjs', [
        'node',
        '/home/nuri/.openclaw/bin/claude-agent-acp-wrapper.mjs',
        '-m',
        'claude-opus-4-7',
      ]),
    )!;
    expect(s.providerId).toBe('claude');
    expect(s.model).toBe('claude-opus-4-7');
  });

  it('extracts taskLabel stripping boilerplate and generic markdown headings', () => {
    const summary1 = extractAcpxTaskSummary([
      {
        User: {
          content: [
            {
              Text: 'İlk iş /home/nuri/.openclaw/workspace/ekip/cuma.md dosyasını oku ve uy.\n\n## Bağlam\n## Görev\n# Task: Fix Persistent Named Desks in Pixel Agents\nMore details here.',
            },
          ],
        },
      },
    ]);
    expect(summary1).toBe('Fix Persistent Named Desks in Pixel Agents');

    const summary2 = extractAcpxTaskSummary([
      {
        User: {
          content: [
            {
              Text: '<USER_REQUEST>\nFirst read /home/nuri/.openclaw/workspace/ekip/selim.md and follow it.\n## Context\nImplement OAuth PKCE flow for mobile clients\n</USER_REQUEST>',
            },
          ],
        },
      },
    ]);
    expect(summary2).toBe('Implement OAuth PKCE flow for mobile clients');
  });

  it('derives lastToolStatus even when the final Agent message only has Text', () => {
    const s = parseAcpxRecord({
      schema: 'acpx.session.v1',
      acpx_record_id: 'agent:selim-yedek:acp:1:oneshot:2',
      agent_command: 'claude-agent-acp-wrapper.mjs',
      agent_argv: ['claude-agent-acp-wrapper.mjs'],
      cwd: '/home/nuri/.openclaw/workspace',
      closed: true,
      updated_at: '2026-01-01T10:00:10.000Z',
      messages: [
        {
          User: {
            content: [{ Text: 'Görev: Audit server auth routes' }],
          },
        },
        {
          Agent: {
            content: [
              {
                ToolUse: {
                  id: 't1',
                  name: 'Executing read_file',
                  input: { file_path: '/srv/app/auth.ts' },
                },
              },
            ],
            tool_results: { t1: { tool_use_id: 't1' } },
          },
        },
        {
          Agent: {
            content: [{ Text: 'All auth routes look solid.' }],
          },
        },
      ],
    })!;
    expect(s.taskLabel).toBe('Audit server auth routes');
    expect(s.tools).toEqual([]);
    expect(s.lastToolStatus).toContain('Reading');
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
    expect(agent.folderName).toBe('demo-project');
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

  it('marks an open record idle after 60s without updates once its tools are done', () => {
    write('a.json', {
      closed: false,
      updated_at: new Date().toISOString(),
      messages: messages(['s1'], ['s1']),
    });
    watcher.scan();
    sent.length = 0;
    vi.advanceTimersByTime(61_000);
    watcher.scan();
    expect(sent.some((m) => m.type === 'agentStatus' && m.status === 'waiting')).toBe(true);
  });

  it('does not mark the agent waiting while a tool is still running', () => {
    write('a.json', {
      closed: false,
      updated_at: new Date().toISOString(),
      messages: messages(['s1']),
    });
    watcher.scan();
    sent.length = 0;
    vi.advanceTimersByTime(61_000);
    watcher.scan();
    expect(sent.some((m) => m.type === 'agentStatus' && m.status === 'waiting')).toBe(false);
  });

  it('finishes tools that dropped out of the latest agent turn', () => {
    write('a.json', { closed: false, messages: messages(['s1']) });
    watcher.scan();
    const agent = [...store.values()][0];
    write('a.json', { closed: false, messages: messages(['s2']) });
    watcher.scan();
    vi.advanceTimersByTime(1000);
    expect(sent.some((m) => m.type === 'agentToolDone' && m.toolId === 's1')).toBe(true);
    expect([...agent.activeToolIds]).toEqual(['s2']);
  });

  it.each([0, -1, 1.5])('treats pid %s as not alive', (pid) => {
    const real = new AcpxWatcher(store, dir, () => {});
    write('a.json', { closed: false, pid });
    real.scan();
    expect(store.size).toBe(0);
    real.dispose();
  });

  it('picks up sessions when the sessions dir is created after start()', () => {
    const late = path.join(dir, 'late');
    const w = new AcpxWatcher(store, late, () => {}, { isPidAlive: () => true });
    w.start();
    fs.mkdirSync(late);
    fs.writeFileSync(
      path.join(late, 'a.json'),
      JSON.stringify({ ...fixture('agy-pro.json'), closed: false, messages: [] }),
    );
    vi.advanceTimersByTime(ACPX_SCAN_INTERVAL_MS);
    expect(store.size).toBe(1);
    w.dispose();
  });

  it('retains finished known-worker sessions in idle/finished state instead of dropping them', () => {
    write('selim.json', {
      acpx_record_id: 'agent:selim-yedek:acp:111:oneshot:222',
      agent_command: 'claude-agent-acp-wrapper.mjs',
      agent_argv: ['claude-agent-acp-wrapper.mjs', '-m', 'claude-opus-4-7'],
      cwd: '/home/nuri/.openclaw/workspace',
      closed: true,
      messages: [
        {
          User: {
            content: [
              {
                Text: 'İlk iş /home/nuri/.openclaw/workspace/ekip/selim.md dosyasını oku ve uy.\n\nGörev: Check database indexes',
              },
            ],
          },
        },
        {
          Agent: {
            content: [
              {
                ToolUse: {
                  id: 't1',
                  name: 'Executing run_command',
                  input: { command: 'psql -c "\\d"' },
                },
              },
            ],
            tool_results: { t1: { tool_use_id: 't1' } },
          },
        },
        {
          Agent: {
            content: [{ Text: 'Done checking indexes.' }],
          },
        },
      ],
    });

    watcher.scan();
    expect(store.size).toBe(1);
    const agent = [...store.values()][0];
    expect(agent.workerId).toBe('selim');
    expect(agent.isWaiting).toBe(true);
    expect(agent.isFinished).toBe(true);
    expect(agent.taskLabel).toBe('Check database indexes');
    expect(agent.lastToolStatus).toBeDefined();
    expect(agent.folderName).toBeUndefined();
    expect(removed).toEqual([]);
  });

  it('transitions an active known worker to finished/idle without removing its desk agent', () => {
    write('hasan.json', {
      acpx_record_id: 'agent:hasan:acp:111:oneshot:222',
      cwd: '/home/nuri/.openclaw/workspace',
      closed: false,
      messages: [
        { User: { content: [{ Text: 'Görev: Build pixel desk sprites' }] } },
        {
          Agent: {
            content: [{ ToolUse: { id: 'h1', name: 'Executing run_command', input: {} } }],
            tool_results: {},
          },
        },
      ],
    });
    watcher.scan();
    expect(store.size).toBe(1);
    const agent = [...store.values()][0];
    expect(agent.workerId).toBe('hasan');
    expect(agent.isFinished).toBe(false);
    expect(agent.activeToolIds.has('h1')).toBe(true);

    write('hasan.json', {
      acpx_record_id: 'agent:hasan:acp:111:oneshot:222',
      cwd: '/home/nuri/.openclaw/workspace',
      closed: true,
      messages: [
        { User: { content: [{ Text: 'Görev: Build pixel desk sprites' }] } },
        {
          Agent: {
            content: [{ ToolUse: { id: 'h1', name: 'Executing run_command', input: {} } }],
            tool_results: { h1: { tool_use_id: 'h1' } },
          },
        },
      ],
    });
    watcher.scan();
    expect(removed).toEqual([]);
    expect(store.size).toBe(1);
    expect(agent.isWaiting).toBe(true);
    expect(agent.isFinished).toBe(true);
    expect(agent.activeToolIds.size).toBe(0);
    expect(
      sent.some((m) => m.type === 'agentStatus' && m.id === agent.id && m.status === 'waiting'),
    ).toBe(true);
  });

  it('consolidates multiple alias sessions for the same workerId into a single agent', () => {
    write('cuma-old.json', {
      acpx_record_id: 'agent:cuma:acp:100:oneshot:200',
      cwd: '/home/nuri/.openclaw/workspace',
      closed: true,
      updated_at: '2026-01-01T10:00:00.000Z',
      messages: [{ User: { content: [{ Text: 'Old task' }] } }],
    });
    watcher.scan();
    expect(store.size).toBe(1);
    const firstAgent = [...store.values()][0];
    const originalId = firstAgent.id;
    const originalSeat = firstAgent.seatId;
    const originalPalette = firstAgent.palette;
    expect(firstAgent.workerId).toBe('cuma');
    expect(firstAgent.isFinished).toBe(true);
    expect(firstAgent.taskLabel).toBe('Old task');

    // Now cuma-2 starts an active session in another file while cuma-old.json remains on disk
    write('cuma-2-active.json', {
      acpx_record_id: 'agent:cuma-2:acp:300:oneshot:400',
      cwd: '/home/nuri/.openclaw/workspace',
      closed: false,
      updated_at: '2026-01-01T09:00:00.000Z', // even if timestamp is older, active beats closed!
      messages: [{ User: { content: [{ Text: 'Active task on account 2' }] } }],
    });
    watcher.scan();

    expect(store.size).toBe(1);
    const updatedAgent = store.get(originalId)!;
    expect(updatedAgent).toBeDefined();
    expect(updatedAgent.id).toBe(originalId);
    expect(updatedAgent.seatId).toBe(originalSeat);
    expect(updatedAgent.palette).toBe(originalPalette);
    expect(updatedAgent.isFinished).toBe(false);
    expect(updatedAgent.agentName).toContain('cuma-2');
    expect(updatedAgent.taskLabel).toBe('Active task on account 2');
  });
});
