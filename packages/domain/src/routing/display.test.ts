import { describe, expect, it } from 'vitest';
import { cellCenter } from '../raster/grid';
import { elevationFrom, syntheticSpec } from '../testing/synthetic';
import { DEFAULT_EVA_PARAMS } from '../traversal/params';
import { roundCorners } from './display';
import { segmentIsTraversable } from './polyline';
import { prepareTerrain } from './terrain';

const spec = syntheticSpec(60, 60);
const flat = prepareTerrain(
  { spec, elevation: elevationFrom(spec, () => -2570) },
  DEFAULT_EVA_PARAMS,
);
const at = (c: number, r: number) => cellCenter(spec, c, r);

describe('rounded display corners', () => {
  const path = [at(5, 30), at(30, 30), at(30, 5)]; // a right-angle corner at (30, 30)

  it('replaces a free corner with a curve that stays within r/2 of the vertex', () => {
    const out = roundCorners(flat, path, 14);
    expect(out.length).toBeGreaterThan(path.length);
    expect(out[0]).toEqual(path[0]);
    expect(out.at(-1)).toEqual(path[2]);
    const b = path[1]!;
    const nearest = Math.min(...out.map((p) => Math.hypot(p.x - b.x, p.y - b.y)));
    expect(nearest).toBeLessThanOrEqual(14 / 2 + 1e-6);
    expect(out.some((p) => p.x === b.x && p.y === b.y)).toBe(false);
  });

  it('keeps the corner sharp when the curve would cross blocked terrain', () => {
    const excluded = new Uint8Array(60 * 60);
    // Block the inside of the corner right next to the vertex.
    for (let r = 26; r < 30; r++) for (let c = 26; c < 30; c++) excluded[r * 60 + c] = 1;
    const t = prepareTerrain(
      { spec, elevation: elevationFrom(spec, () => -2570), excluded },
      DEFAULT_EVA_PARAMS,
    );
    const out = roundCorners(t, path, 14);
    expect(out).toEqual(path);
    for (let i = 1; i < out.length; i++)
      expect(segmentIsTraversable(t, out[i - 1]!, out[i]!)).toBe(true);
  });
});
