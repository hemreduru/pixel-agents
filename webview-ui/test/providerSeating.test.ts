/**
 * Seats are steered by Area: an agent prefers the Area named after its
 * provider, and the manager folder prefers the Area named after that folder.
 * An explicit folder → Area mapping still wins over both.
 *
 * Domain-model test on OfficeState (like teammateSeating / greeter): the seat
 * an agent lands on is not observable from the outside without a full e2e
 * layout, and the fallback order is the point.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { OfficeState } from '../src/office/engine/officeState.js';
import type { OfficeLayout, Seat } from '../src/office/types.js';
import { Direction, TileType } from '../src/office/types.js';

const COLS = 8;

/** One row of floor; tiles 0-1 are "workspace", 2-3 "claude", 4-5 "cursor", 6-7 unzoned. */
function office(): OfficeState {
  const areaTiles = ['workspace', 'workspace', 'claude', 'claude', 'cursor', 'cursor', null, null];
  const layout: OfficeLayout = {
    version: 1,
    cols: COLS,
    rows: 1,
    tiles: new Array<TileType>(COLS).fill(TileType.FLOOR_1),
    furniture: [],
    areaTiles,
  };
  const os = new OfficeState(layout);
  for (let col = 0; col < COLS; col++) {
    const seat: Seat = {
      uid: `s${col}`,
      seatCol: col,
      seatRow: 0,
      facingDir: Direction.DOWN,
      assigned: false,
    };
    os.seats.set(seat.uid, seat);
  }
  return os;
}

const seatCol = (os: OfficeState, id: number): number =>
  os.seats.get(os.characters.get(id)!.seatId!)!.seatCol;

test('an agent sits in the Area named after its provider', () => {
  const os = office();
  os.addAgent(1, 0, 0, undefined, true, 'demo', undefined, 'cursor');
  os.addAgent(2, 0, 0, undefined, true, 'demo', undefined, 'claude');
  assert.ok([4, 5].includes(seatCol(os, 1)));
  assert.ok([2, 3].includes(seatCol(os, 2)));
});

test('the manager folder sits in its own Area, ahead of its provider', () => {
  const os = office();
  os.addAgent(1, 0, 0, undefined, true, 'workspace', undefined, 'claude');
  assert.ok([0, 1].includes(seatCol(os, 1)));
});

test('a folder → Area mapping wins over the provider', () => {
  const os = office();
  os.setAreaMappings({ demo: ['cursor'] });
  os.addAgent(1, 0, 0, undefined, true, 'demo', undefined, 'claude');
  assert.ok([4, 5].includes(seatCol(os, 1)));
});

test('a full provider Area spills to unzoned seats, then to any seat', () => {
  const os = office();
  for (let id = 1; id <= 3; id++)
    os.addAgent(id, 0, 0, undefined, true, 'demo', undefined, 'cursor');
  assert.ok([6, 7].includes(seatCol(os, 3)));
});

test('providers without an Area keep the unzoned-first behavior', () => {
  const os = office();
  os.addAgent(1, 0, 0, undefined, true, 'demo', undefined, 'openai');
  assert.ok([6, 7].includes(seatCol(os, 1)));
});

/**
 * Multi-area office with workspace (2 seats), antigravity (4 seats),
 * cursor (3 seats), claude (3 seats), and unzoned (2 seats).
 */
function multiAreaOffice(): OfficeState {
  const areaTiles = [
    'workspace',
    'workspace',
    'antigravity',
    'antigravity',
    'antigravity',
    'antigravity',
    'cursor',
    'cursor',
    'cursor',
    'claude',
    'claude',
    'claude',
    null,
    null,
  ];
  const cols = areaTiles.length;
  const layout: OfficeLayout = {
    version: 1,
    cols,
    rows: 1,
    tiles: new Array<TileType>(cols).fill(TileType.FLOOR_1),
    furniture: [],
    areaTiles,
  };
  const os = new OfficeState(layout);
  for (let col = 0; col < cols; col++) {
    const seat: Seat = {
      uid: `s${col}`,
      seatCol: col,
      seatRow: 0,
      facingDir: Direction.DOWN,
      assigned: false,
    };
    os.seats.set(seat.uid, seat);
  }
  return os;
}

test('known workers and unknown agents get identical seatId, palette, and hueShift regardless of discovery order', () => {
  const roster = [
    { key: 'cuma-2', providerId: 'antigravity', agentName: 'cuma-2 · gemini-4-argon-high' },
    { key: 'hasan-2', providerId: 'antigravity', agentName: 'hasan-2 · gemini-4-argon-high' },
    { key: 'selim-yedek', providerId: 'claude', agentName: 'selim-yedek · agy-sonnet' },
    { key: 'unknown', providerId: 'antigravity', agentName: 'unknown · gemini-4-argon-high' },
  ];

  const orders = [
    ['cuma-2', 'hasan-2', 'selim-yedek', 'unknown'],
    ['unknown', 'selim-yedek', 'hasan-2', 'cuma-2'],
    ['selim-yedek', 'unknown', 'cuma-2', 'hasan-2'],
  ];

  const runOrder = (order: string[]) => {
    const os = multiAreaOffice();
    order.forEach((key, idx) => {
      const item = roster.find((r) => r.key === key)!;
      os.addAgent(
        idx + 1,
        undefined,
        undefined,
        undefined,
        true,
        'workspace',
        undefined,
        item.providerId,
        item.agentName,
      );
    });

    const result: Record<string, { seatId: string | null; palette: number; hueShift: number }> = {};
    order.forEach((key, idx) => {
      const ch = os.characters.get(idx + 1)!;
      result[key] = {
        seatId: ch.seatId,
        palette: ch.palette,
        hueShift: ch.hueShift,
      };
    });
    return result;
  };

  const baseline = runOrder(orders[0]);
  const reverse = runOrder(orders[1]);
  const mixed = runOrder(orders[2]);

  assert.deepEqual(reverse, baseline);
  assert.deepEqual(mixed, baseline);

  // Verify specific canonical slots in antigravity (s2=slot 0 for cuma, s3=slot 1 for hasan, s5=unreserved for unknown)
  assert.equal(baseline['cuma-2'].seatId, 's2');
  assert.equal(baseline['hasan-2'].seatId, 's3');
  assert.equal(baseline['selim-yedek'].seatId, 's10');
  assert.equal(baseline['unknown'].seatId, 's5');
});

test('aliases cuma, cuma-2, cuma-yedek, cuma-yedek-2 resolve to the same desk and character palette', () => {
  const aliases = ['cuma', 'cuma-2', 'cuma-yedek', 'cuma-yedek-2'];
  const snapshots = aliases.map((alias) => {
    const os = multiAreaOffice();
    os.addAgent(
      1,
      undefined,
      undefined,
      undefined,
      true,
      'workspace',
      undefined,
      'antigravity',
      `${alias} · gemini-4-argon-high`,
    );
    const ch = os.characters.get(1)!;
    return {
      seatId: ch.seatId,
      palette: ch.palette,
      hueShift: ch.hueShift,
      workerId: ch.workerId,
    };
  });

  for (const snap of snapshots) {
    assert.deepEqual(snap, {
      seatId: 's2',
      palette: 0,
      hueShift: 0,
      workerId: 'cuma',
    });
  }
});
