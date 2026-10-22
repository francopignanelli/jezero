import { costLowerBound, evaluateStep, type RouteProfile } from './cost';
import { MinHeap } from './heap';
import { BLOCK, NEIGHBOURS, stepTarget, type PreparedTerrain } from './terrain';

export interface PathSearchResult {
  /** Cell indices from start to goal inclusive, or null if the goal is unreachable. */
  path: number[] | null;
  cost: number;
  expandedNodes: number;
}

/**
 * Minimal horizontal ground length (m) of an 8-connected grid path spanning |dc| × |dr| cells,
 * computed with the narrowest cell width so it never overestimates (admissible heuristic).
 */
export function octileLengthM(t: PreparedTerrain, dc: number, dr: number): number {
  const ac = Math.abs(dc);
  const ar = Math.abs(dr);
  const diag = Math.min(ac, ar);
  const w = t.minCellWidthM;
  const h = t.cellHeightM;
  return diag * Math.hypot(w, h) + (ac - diag) * w + (ar - diag) * h;
}

/**
 * A* over the 8-connected grid of traversable cells. Diagonal moves require both orthogonally
 * adjacent cells to be traversable (no corner-cutting past blocked terrain). Nodes are re-opened
 * when a cheaper path is found, so the result is optimal for the admissible heuristic even if it is
 * not consistent.
 */
export function findPath(
  t: PreparedTerrain,
  profile: RouteProfile,
  start: number,
  goal: number,
): PathSearchResult {
  const { cols, rows } = t.layers.spec;
  const n = cols * rows;
  if (t.block[start] !== BLOCK.none || t.block[goal] !== BLOCK.none) {
    return { path: null, cost: Number.POSITIVE_INFINITY, expandedNodes: 0 };
  }
  const elevation = t.layers.elevation;
  const g = new Float64Array(n).fill(Number.POSITIVE_INFINITY);
  const cameFrom = new Int32Array(n).fill(-1);
  const heap = new MinHeap();
  const goalCol = goal % cols;
  const goalRow = (goal / cols) | 0;
  const heuristic = (idx: number): number =>
    costLowerBound(
      t,
      profile,
      octileLengthM(t, (idx % cols) - goalCol, ((idx / cols) | 0) - goalRow),
    );

  g[start] = 0;
  heap.push(heuristic(start), start);
  let expanded = 0;

  while (heap.size > 0) {
    const f = heap.peekKey();
    const cur = heap.pop();
    const gCur = g[cur]!;
    if (f > gCur + heuristic(cur) + 1e-9) continue; // stale entry
    if (cur === goal) break;
    expanded++;

    const col = cur % cols;
    const row = (cur / cols) | 0;
    for (const [dc, dr] of NEIGHBOURS) {
      const next = stepTarget(t, cols, rows, col, row, dc, dr);
      if (next < 0) continue;
      const nr = row + dr;
      const width = (t.rowWidthM[row]! + t.rowWidthM[nr]!) / 2;
      const step = evaluateStep(
        t,
        profile,
        cur,
        next,
        dc * width,
        -dr * t.cellHeightM,
        elevation[next]! - elevation[cur]!,
      );
      const candidate = gCur + step.cost;
      if (candidate < g[next]!) {
        g[next] = candidate;
        cameFrom[next] = cur;
        heap.push(candidate + heuristic(next), next);
      }
    }
  }

  if (!Number.isFinite(g[goal]!)) {
    return { path: null, cost: Number.POSITIVE_INFINITY, expandedNodes: expanded };
  }
  const path: number[] = [];
  for (let k = goal; k !== -1; k = cameFrom[k]!) path.push(k);
  path.reverse();
  return { path, cost: g[goal]!, expandedNodes: expanded };
}
