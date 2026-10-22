import { RAD_TO_DEG } from '../geo/angles';
import { stepTimeS } from '../traversal/speed';
import { MinHeap } from './heap';
import { BLOCK, NEIGHBOURS, stepTarget, type PreparedTerrain } from './terrain';

/**
 * Walking time (s, default speed model with the timeline factor) between `start` and every
 * traversable cell, over the same 8-connected grid and hard constraints as the planner (no corner
 * cutting). `direction: 'out'` is start → cell; `'back'` is cell → start (grades reversed).
 * Cells beyond `maxS` or unreachable are +Infinity. Grid paths are up to ~8 % longer than the
 * smoothed routes, so the result is conservative.
 */
export function travelTimes(
  t: PreparedTerrain,
  start: number,
  maxS: number,
  direction: 'out' | 'back',
): Float32Array {
  const { cols, rows } = t.layers.spec;
  // Float64 internally: Float32 rounding would make fresh heap entries look stale and skip them.
  const time = new Float64Array(cols * rows).fill(Number.POSITIVE_INFINITY);
  if (t.block[start] !== BLOCK.none) return Float32Array.from(time);
  const z = t.layers.elevation;
  const sign = direction === 'out' ? 1 : -1;
  const heap = new MinHeap(1 << 16);
  time[start] = 0;
  heap.push(0, start);
  while (heap.size > 0) {
    const tCur = heap.peekKey();
    const cur = heap.pop();
    if (tCur > time[cur]!) continue; // stale entry
    const col = cur % cols;
    const row = (cur / cols) | 0;
    for (const [dc, dr] of NEIGHBOURS) {
      const next = stepTarget(t, cols, rows, col, row, dc, dr);
      if (next < 0) continue;
      const nr = row + dr;
      const width = (t.rowWidthM[row]! + t.rowWidthM[nr]!) / 2;
      const lengthH = Math.hypot(dc * width, dr * t.cellHeightM);
      const dz = sign * (z[next]! - z[cur]!);
      const step = stepTimeS(
        'copernico-default',
        Math.hypot(lengthH, dz),
        Math.atan2(dz, lengthH) * RAD_TO_DEG,
        t.params,
      );
      const candidate = tCur + step;
      if (candidate < time[next]! && candidate <= maxS) {
        time[next] = candidate;
        heap.push(candidate, next);
      }
    }
  }
  return Float32Array.from(time);
}

/**
 * Round-trip walking time from `start` to each cell and back (s): the area a crew can visit and
 * still return within a budget. +Infinity where the round trip exceeds `maxRoundTripS`.
 *
 * The default speed model depends only on |grade| and every grid edge has the same length both
 * ways, so the walk back costs exactly the walk out: one search to half the budget suffices
 * (`travelTimes(…, 'back')` remains for direction-dependent models).
 */
export function roundTripTimes(
  t: PreparedTerrain,
  start: number,
  maxRoundTripS: number,
): Float32Array {
  const out = travelTimes(t, start, maxRoundTripS / 2, 'out');
  const total = new Float32Array(out.length);
  for (let i = 0; i < out.length; i++) {
    const s = 2 * out[i]!;
    total[i] = s <= maxRoundTripS ? s : Number.POSITIVE_INFINITY;
  }
  return total;
}
