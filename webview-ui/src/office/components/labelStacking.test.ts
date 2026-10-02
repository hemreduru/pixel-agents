import { describe, expect, it } from 'vitest';

import { stackLabels } from './labelStacking.js';

const label = (id: number, x: number, top = 100, width = 40, height = 20) => ({
  id,
  x,
  top,
  width,
  height,
});

describe('stackLabels', () => {
  it('leaves labels that do not collide at offset 0', () => {
    const offsets = stackLabels([label(1, 0), label(2, 100)], 5);
    expect(offsets.get(1)).toBe(0);
    expect(offsets.get(2)).toBe(0);
  });

  it('lifts a label that overlaps an earlier one until it clears it', () => {
    const offsets = stackLabels([label(1, 0), label(2, 20), label(3, 30)], 5);
    expect(offsets.get(1)).toBe(0);
    expect(offsets.get(2)).toBe(20);
    expect(offsets.get(3)).toBe(40);
  });

  it('does not lift labels on different rows', () => {
    const offsets = stackLabels([label(1, 0, 100), label(2, 0, 140)], 5);
    expect(offsets.get(2)).toBe(0);
  });

  it('accounts for each label height', () => {
    const offsets = stackLabels([label(1, 0, 100, 40, 20), label(2, 10, 100, 40, 50)], 5);
    expect(offsets.get(2)).toBe(50);
  });

  it('is independent of input order', () => {
    const a = label(1, 0);
    const b = label(2, 20);
    expect(stackLabels([a, b], 5)).toEqual(stackLabels([b, a], 5));
  });
});
