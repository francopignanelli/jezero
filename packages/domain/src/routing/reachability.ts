import { cellCenter } from '../raster/grid';
import { traverseSupercover } from './polyline';
import { BLOCK, NEIGHBOURS, stepTarget, type PreparedTerrain } from './terrain';

/**
 * Flood fill of the cells reachable from `start` under the hard constraints, using the same
 * 8-connectivity and no-corner-cutting rule as the path search.
 */
export function reachableFrom(t: PreparedTerrain, start: number): Uint8Array {
  const { cols, rows } = t.layers.spec;
  const seen = new Uint8Array(cols * rows);
  if (t.block[start] !== BLOCK.none) return seen;
  const queue = new Int32Array(cols * rows);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  seen[start] = 1;
  while (head < tail) {
    const cur = queue[head++]!;
    const col = cur % cols;
    const row = (cur / cols) | 0;
    for (const [dc, dr] of NEIGHBOURS) {
      const next = stepTarget(t, cols, rows, col, row, dc, dr);
      if (next < 0 || seen[next]) continue;
      seen[next] = 1;
      queue[tail++] = next;
    }
  }
  return seen;
}

export type BarrierKind = 'slope' | 'nodata' | 'excluded' | 'mixed';

export interface Disconnection {
  /** Reachable cell closest to the target. */
  nearestReachable: number;
  /** Ground distance (m) from that cell to the target. */
  gapM: number;
  barrier: BarrierKind;
}

/**
 * Explains why `goal` cannot be reached from `start`: the closest reachable cell, and the dominant
 * kind of the first blocked cells met on the straight line from that cell toward the goal.
 */
export function diagnoseDisconnection(
  t: PreparedTerrain,
  start: number,
  goal: number,
): Disconnection {
  const spec = t.layers.spec;
  const { cols } = spec;
  const seen = reachableFrom(t, start);
  const gc = goal % cols;
  const gr = (goal / cols) | 0;
  let nearest = start;
  let best = Number.POSITIVE_INFINITY;
  for (let k = 0; k < seen.length; k++) {
    if (!seen[k]) continue;
    const r = (k / cols) | 0;
    const dx = ((k % cols) - gc) * t.rowWidthM[r]!;
    const dy = (r - gr) * t.cellHeightM;
    const d = dx * dx + dy * dy;
    if (d < best) {
      best = d;
      nearest = k;
    }
  }

  const counts = { slope: 0, nodata: 0, excluded: 0 };
  let sampled = 0;
  const from = cellCenter(spec, nearest % cols, (nearest / cols) | 0);
  const to = cellCenter(spec, gc, gr);
  traverseSupercover(spec, from, to, (k) => {
    const b = t.block[k];
    if (b === BLOCK.none) return true;
    if (b === BLOCK.slope) counts.slope++;
    else if (b === BLOCK.nodata) counts.nodata++;
    else counts.excluded++;
    return ++sampled < BARRIER_SAMPLE_CELLS;
  });
  let barrier: BarrierKind = 'mixed';
  for (const kind of ['slope', 'nodata', 'excluded'] as const) {
    if (sampled > 0 && counts[kind] / sampled >= 0.7) barrier = kind;
  }
  return { nearestReachable: nearest, gapM: Math.sqrt(best), barrier };
}

/** Number of blocked cells examined toward the goal to classify a barrier. */
const BARRIER_SAMPLE_CELLS = 8;
