import { cellCenter, sampleBilinear, type GridSpec } from '../raster/grid';
import type { XY } from '../geo/equirectangular';
import { evaluateStep, type RouteProfile } from './cost';
import { BLOCK, type PreparedTerrain } from './terrain';

/** Continuous cell-space coordinates: cell (c, r) spans [c, c+1) × [r, r+1). */
function toCellSpace(spec: GridSpec, p: XY): { u: number; v: number } {
  return { u: (p.x - spec.originX) / spec.cellSize, v: (spec.originY - p.y) / spec.cellSize };
}

export function cellOfPoint(spec: GridSpec, p: XY): number {
  const { u, v } = toCellSpace(spec, p);
  const c = Math.floor(u);
  const r = Math.floor(v);
  if (c < 0 || r < 0 || c >= spec.cols || r >= spec.rows) return -1;
  return r * spec.cols + c;
}

/**
 * Visits every cell the segment p0→p1 touches (supercover, Amanatides & Woo traversal). When the
 * segment passes exactly through a cell corner, both side cells are visited as well, so a segment
 * can never slip diagonally between two blocked cells. Returns false as soon as `visit` does, or if
 * the segment leaves the grid.
 */
export function traverseSupercover(
  spec: GridSpec,
  p0: XY,
  p1: XY,
  visit: (index: number) => boolean,
): boolean {
  const a = toCellSpace(spec, p0);
  const b = toCellSpace(spec, p1);
  let c = Math.floor(a.u);
  let r = Math.floor(a.v);
  const cEnd = Math.floor(b.u);
  const rEnd = Math.floor(b.v);
  const du = b.u - a.u;
  const dv = b.v - a.v;
  const stepC = Math.sign(du);
  const stepR = Math.sign(dv);
  const tDeltaC = stepC !== 0 ? 1 / Math.abs(du) : Number.POSITIVE_INFINITY;
  const tDeltaR = stepR !== 0 ? 1 / Math.abs(dv) : Number.POSITIVE_INFINITY;
  let tMaxC =
    stepC > 0 ? (c + 1 - a.u) / du : stepC < 0 ? (a.u - c) / -du : Number.POSITIVE_INFINITY;
  let tMaxR =
    stepR > 0 ? (r + 1 - a.v) / dv : stepR < 0 ? (a.v - r) / -dv : Number.POSITIVE_INFINITY;

  const check = (cc: number, rr: number): boolean =>
    cc >= 0 && rr >= 0 && cc < spec.cols && rr < spec.rows && visit(rr * spec.cols + cc);

  if (!check(c, r)) return false;
  let guard = 2 * (Math.abs(cEnd - c) + Math.abs(rEnd - r)) + 4;
  while ((c !== cEnd || r !== rEnd) && guard-- > 0) {
    if (Math.abs(tMaxC - tMaxR) < 1e-12) {
      if (!check(c + stepC, r) || !check(c, r + stepR)) return false;
      c += stepC;
      r += stepR;
      tMaxC += tDeltaC;
      tMaxR += tDeltaR;
    } else if (tMaxC < tMaxR) {
      c += stepC;
      tMaxC += tDeltaC;
    } else {
      r += stepR;
      tMaxR += tDeltaR;
    }
    if (!check(c, r)) return false;
  }
  return true;
}

export function segmentIsTraversable(t: PreparedTerrain, p0: XY, p1: XY): boolean {
  return traverseSupercover(t.layers.spec, p0, p1, (k) => t.block[k] === BLOCK.none);
}

export function pathToPoints(spec: GridSpec, path: readonly number[]): XY[] {
  return path.map((k) => cellCenter(spec, k % spec.cols, (k / spec.cols) | 0));
}

export interface SampledStep {
  from: XY;
  to: XY;
  cellFrom: number;
  cellTo: number;
  dEastM: number;
  dNorthM: number;
  zFrom: number;
  zTo: number;
}

/**
 * Splits a polyline into steps no longer than `maxStepCells` cells, reporting ground displacement
 * (with the per-row east-west scale correction) and bilinear elevations at both ends.
 */
export function sampleSteps(t: PreparedTerrain, points: readonly XY[], maxStepCells: number): SampledStep[] {
  const spec = t.layers.spec;
  const steps: SampledStep[] = [];
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1]!;
    const q = points[i]!;
    const lenCells = Math.hypot(q.x - p.x, q.y - p.y) / spec.cellSize;
    const count = Math.max(1, Math.ceil(lenCells / maxStepCells));
    let prev = p;
    let zPrev = sampleBilinear(spec, t.layers.elevation, prev);
    let cellPrev = cellOfPoint(spec, prev);
    for (let s = 1; s <= count; s++) {
      const f = s / count;
      const cur = { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f };
      const cellCur = cellOfPoint(spec, cur);
      const zCur = sampleBilinear(spec, t.layers.elevation, cur);
      const midRow = Math.min(
        spec.rows - 1,
        Math.max(0, Math.floor((spec.originY - (prev.y + cur.y) / 2) / spec.cellSize)),
      );
      const scale = t.rowWidthM[midRow]! / spec.cellSize;
      steps.push({
        from: prev,
        to: cur,
        cellFrom: cellPrev,
        cellTo: cellCur,
        dEastM: (cur.x - prev.x) * scale,
        dNorthM: cur.y - prev.y,
        zFrom: zPrev,
        zTo: zCur,
      });
      prev = cur;
      zPrev = zCur;
      cellPrev = cellCur;
    }
  }
  return steps;
}

/** Cost of a continuous polyline under a profile; +∞ if any part touches a blocked cell. */
export function polylineCost(t: PreparedTerrain, profile: RouteProfile, points: readonly XY[]): number {
  for (let i = 1; i < points.length; i++) {
    if (!segmentIsTraversable(t, points[i - 1]!, points[i]!)) return Number.POSITIVE_INFINITY;
  }
  let total = 0;
  for (const s of sampleSteps(t, points, 0.5)) {
    total += evaluateStep(t, profile, s.cellFrom, s.cellTo, s.dEastM, s.dNorthM, s.zTo - s.zFrom).cost;
  }
  return total;
}

/**
 * Greedy line-of-sight simplification ("string pulling"). A shortcut from vertex i to vertex j is
 * accepted only if its supercover is fully traversable AND its cost does not exceed the cost of the
 * grid path it replaces, so smoothing can neither cross blocked terrain nor worsen the route.
 */
export function smoothPath(
  t: PreparedTerrain,
  profile: RouteProfile,
  points: readonly XY[],
  maxLookahead = 400,
): XY[] {
  if (points.length <= 2) return [...points];
  // Prefix sums of the original per-segment costs: cost(points[i..j]) = prefix[j] − prefix[i].
  const prefix = new Float64Array(points.length);
  for (let i = 1; i < points.length; i++) {
    prefix[i] = prefix[i - 1]! + polylineCost(t, profile, [points[i - 1]!, points[i]!]);
  }
  const out: XY[] = [points[0]!];
  let anchor = 0;
  while (anchor < points.length - 1) {
    let best = anchor + 1;
    const last = Math.min(points.length - 1, anchor + maxLookahead);
    for (let j = anchor + 2; j <= last; j++) {
      const direct = polylineCost(t, profile, [points[anchor]!, points[j]!]);
      if (!(direct <= prefix[j]! - prefix[anchor]! + 1e-9)) break;
      best = j;
    }
    out.push(points[best]!);
    anchor = best;
  }
  return out;
}
