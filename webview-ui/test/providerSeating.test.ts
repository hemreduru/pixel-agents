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
