import { describe, expect, it } from 'vitest';

import {
  type CanonicalWorkerId,
  KNOWN_WORKER_IDS,
  resolveCanonicalWorkerSeats,
  resolveWorkerIdentity,
  sortSeatUidsDeterministically,
  WORKER_ROSTER,
} from '../../core/src/workerIdentity.js';

describe('workerIdentity', () => {
  describe('resolveWorkerIdentity across all 4 alias forms for all 7 workers', () => {
    const workers: CanonicalWorkerId[] = [
      'kemal',
      'zeki',
      'selim',
      'cuma',
      'dogan',
      'hasan',
      'riza',
    ];

    it.each(workers)('resolves base, -2, -yedek, and -yedek-2 variants for %s', (workerId) => {
      const roster = WORKER_ROSTER[workerId];

      const base = resolveWorkerIdentity(workerId);
      expect(base).toMatchObject({
        isKnownWorker: true,
        workerId,
        displayName: roster.displayName,
        isBackup: false,
        accountIndex: 1,
        badges: [],
        defaultSeatId: roster.defaultSeatId,
        palette: roster.palette,
        hueShift: roster.hueShift,
      });

      const acc2 = resolveWorkerIdentity(`${workerId}-2`);
      expect(acc2).toMatchObject({
        isKnownWorker: true,
        workerId,
        displayName: roster.displayName,
        isBackup: false,
        accountIndex: 2,
        badges: ['hesap 2'],
        defaultSeatId: roster.defaultSeatId,
        palette: roster.palette,
        hueShift: roster.hueShift,
      });

      const backup = resolveWorkerIdentity(`${workerId}-yedek`);
      expect(backup).toMatchObject({
        isKnownWorker: true,
        workerId,
        displayName: roster.displayName,
        isBackup: true,
        accountIndex: 1,
        badges: ['yedek'],
        defaultSeatId: roster.defaultSeatId,
        palette: roster.palette,
        hueShift: roster.hueShift,
      });

      const backup2 = resolveWorkerIdentity(`${workerId}-yedek-2`);
      expect(backup2).toMatchObject({
        isKnownWorker: true,
        workerId,
        displayName: roster.displayName,
        isBackup: true,
        accountIndex: 2,
        badges: ['yedek', 'hesap 2'],
        defaultSeatId: roster.defaultSeatId,
        palette: roster.palette,
        hueShift: roster.hueShift,
      });
    });

    it('resolves nuri, main, and workspace folder to canonical worker nuri', () => {
      const fromNuri = resolveWorkerIdentity('nuri');
      expect(fromNuri).toMatchObject({
        isKnownWorker: true,
        workerId: 'nuri',
        displayName: 'Nuri · müdür',
        defaultSeatId: 'f-nuri-3',
        palette: 0,
        hueShift: 45,
      });

      const fromMain = resolveWorkerIdentity('main-2');
      expect(fromMain).toMatchObject({
        isKnownWorker: true,
        workerId: 'nuri',
        displayName: 'Nuri · müdür',
        isBackup: false,
        accountIndex: 2,
        badges: ['hesap 2'],
      });

      const fromFolder = resolveWorkerIdentity(undefined, '/home/nuri/.openclaw/workspace');
      expect(fromFolder).toMatchObject({
        isKnownWorker: true,
        workerId: 'nuri',
        displayName: 'Nuri · müdür',
        defaultSeatId: 'f-nuri-3',
        palette: 0,
        hueShift: 45,
      });
    });

    it('prioritizes explicit worker token over workspace folderName', () => {
      const identity = resolveWorkerIdentity('cuma-2 · gemini-4-argon-high', 'workspace');
      expect(identity.isKnownWorker).toBe(true);
      expect(identity.workerId).toBe('cuma');
      expect(identity.displayName).toBe('Cuma');
      expect(identity.accountIndex).toBe(2);
      expect(identity.badges).toEqual(['hesap 2']);
    });

    it('resolves unknown/unmapped inputs cleanly without leaking Agent N or raw session IDs', () => {
      for (const raw of [
        'unknown',
        'codex',
        'Agent 3',
        'agent:unknown:acp:123:oneshot:456',
        '00000000-0000-4000-8000-000000000001',
      ]) {
        const res = resolveWorkerIdentity(raw, 'workspace');
        expect(res.isKnownWorker).toBe(false);
        expect(res.workerId).toBeUndefined();
        expect(res.displayName).not.toMatch(/^Agent\s*\d+$/i);
        expect(res.displayName).not.toContain('oneshot');
        expect(res.displayName).not.toContain('00000000');
      }

      expect(resolveWorkerIdentity('codex', 'workspace').displayName).toBe('Unknown · Codex');
      expect(resolveWorkerIdentity('Agent 3').displayName).toBe('Unknown');
      expect(resolveWorkerIdentity('agent:unknown:acp:123:oneshot:456').displayName).toBe(
        'Unknown',
      );
    });
  });

  describe('sortSeatUidsDeterministically & resolveCanonicalWorkerSeats', () => {
    it('sorts seats deterministically by row, col, then uid regardless of insertion order', () => {
      const seatsA = new Map([
        ['s-b', { seatCol: 5, seatRow: 2 }],
        ['s-a', { seatCol: 2, seatRow: 2 }],
        ['s-c', { seatCol: 1, seatRow: 1 }],
      ]);
      const seatsB = new Map([
        ['s-c', { seatCol: 1, seatRow: 1 }],
        ['s-a', { seatCol: 2, seatRow: 2 }],
        ['s-b', { seatCol: 5, seatRow: 2 }],
      ]);

      expect(sortSeatUidsDeterministically([...seatsA.keys()], seatsA)).toEqual([
        's-c',
        's-a',
        's-b',
      ]);
      expect(sortSeatUidsDeterministically([...seatsB.keys()], seatsB)).toEqual([
        's-c',
        's-a',
        's-b',
      ]);
    });

    it('maps all 8 canonical workers to their exact defaultSeatId when default-layout-3 seats exist', () => {
      const seats = new Map<string, { seatCol: number; seatRow: number }>();
      for (const id of KNOWN_WORKER_IDS) {
        const entry = WORKER_ROSTER[id];
        seats.set(entry.defaultSeatId, { seatCol: entry.rosterIndex, seatRow: 1 });
      }
      const mapped = resolveCanonicalWorkerSeats(seats, () => null);
      for (const id of KNOWN_WORKER_IDS) {
        expect(mapped.get(id)).toBe(WORKER_ROSTER[id].defaultSeatId);
      }
    });

    it('maps workers order-independently by homeArea and areaSlot when custom seat UIDs are used', () => {
      const entries: Array<[string, { seatCol: number; seatRow: number }, string]> = [
        ['ws-0', { seatCol: 2, seatRow: 2 }, 'workspace'],
        ['agy-0', { seatCol: 1, seatRow: 5 }, 'antigravity'],
        ['agy-1', { seatCol: 3, seatRow: 5 }, 'antigravity'],
        ['agy-2', { seatCol: 5, seatRow: 5 }, 'antigravity'],
        ['cur-0', { seatCol: 1, seatRow: 10 }, 'cursor'],
        ['cur-1', { seatCol: 3, seatRow: 10 }, 'cursor'],
        ['cla-0', { seatCol: 10, seatRow: 10 }, 'claude'],
        ['cla-1', { seatCol: 12, seatRow: 10 }, 'claude'],
      ];

      const forwardSeats = new Map(entries.map(([uid, pos]) => [uid, pos]));
      const reverseSeats = new Map([...entries].reverse().map(([uid, pos]) => [uid, pos]));
      const zoneMap = new Map(entries.map(([uid, , z]) => [uid, z]));

      const mapA = resolveCanonicalWorkerSeats(forwardSeats, (u) => zoneMap.get(u) ?? null);
      const mapB = resolveCanonicalWorkerSeats(reverseSeats, (u) => zoneMap.get(u) ?? null);

      expect(Object.fromEntries(mapA)).toEqual(Object.fromEntries(mapB));
      expect(mapA.get('nuri')).toBe('ws-0');
      expect(mapA.get('cuma')).toBe('agy-0');
      expect(mapA.get('hasan')).toBe('agy-1');
      expect(mapA.get('kemal')).toBe('agy-2');
      expect(mapA.get('riza')).toBe('cur-0');
      expect(mapA.get('zeki')).toBe('cur-1');
      expect(mapA.get('dogan')).toBe('cla-0');
      expect(mapA.get('selim')).toBe('cla-1');
    });
  });
});
