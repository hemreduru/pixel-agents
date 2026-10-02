/** A label centred on `x`, occupying `height` px below `top`, in screen pixels. */
export interface StackableLabel {
  id: number;
  x: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Upward offset (px) per label id so that no two labels overlap. Labels are
 * placed left to right (ties by id, so the result does not depend on input
 * order); one that collides with an already-placed label moves up `step` px at
 * a time until it is clear.
 */
export function stackLabels(labels: StackableLabel[], step: number): Map<number, number> {
  const placed: { left: number; right: number; top: number; bottom: number }[] = [];
  const offsets = new Map<number, number>();
  for (const label of [...labels].sort((a, b) => a.x - b.x || a.id - b.id)) {
    const left = label.x - label.width / 2;
    const right = label.x + label.width / 2;
    let offset = 0;
    while (
      placed.some(
        (p) =>
          p.left < right &&
          left < p.right &&
          p.top < label.top + label.height - offset &&
          label.top - offset < p.bottom,
      )
    ) {
      offset += step;
    }
    placed.push({
      left,
      right,
      top: label.top - offset,
      bottom: label.top + label.height - offset,
    });
    offsets.set(label.id, offset);
  }
  return offsets;
}
