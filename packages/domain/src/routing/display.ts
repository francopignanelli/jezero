import type { XY } from '../geo/equirectangular';
import { segmentIsTraversable } from './polyline';
import type { PreparedTerrain } from './terrain';

/**
 * Display geometry with rounded corners. Each interior vertex is replaced by a quadratic Bézier
 * between points `r` before and after it (r ≤ `maxRadiusM`, ≤ ⅓ of either segment), but only if
 * every piece of the curve stays on traversable cells; otherwise the corner stays sharp. The curve
 * lies inside the corner's triangle, at most r/2 from the vertex. Metrics are never computed on this
 * geometry: it is for drawing only.
 */
export function roundCorners(
  t: PreparedTerrain,
  points: readonly XY[],
  maxRadiusM = 14,
  pieces = 5,
  /** Vertex indices that must stay exact (waypoints). */
  keep: ReadonlySet<number> = new Set(),
): XY[] {
  if (points.length < 3) return [...points];
  const out: XY[] = [points[0]!];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const c = points[i + 1]!;
    const lab = Math.hypot(b.x - a.x, b.y - a.y);
    const lbc = Math.hypot(c.x - b.x, c.y - b.y);
    const r = Math.min(maxRadiusM, lab / 3, lbc / 3);
    if (r < 0.5 || keep.has(i)) {
      out.push(b);
      continue;
    }
    const p = { x: b.x + ((a.x - b.x) * r) / lab, y: b.y + ((a.y - b.y) * r) / lab };
    const q = { x: b.x + ((c.x - b.x) * r) / lbc, y: b.y + ((c.y - b.y) * r) / lbc };
    const curve: XY[] = [p];
    for (let k = 1; k < pieces; k++) {
      const u = k / pieces;
      const w0 = (1 - u) * (1 - u);
      const w1 = 2 * u * (1 - u);
      const w2 = u * u;
      curve.push({ x: w0 * p.x + w1 * b.x + w2 * q.x, y: w0 * p.y + w1 * b.y + w2 * q.y });
    }
    curve.push(q);
    const prev = out[out.length - 1]!;
    const ok = [prev, ...curve].every(
      (pt, k, arr) => k === 0 || segmentIsTraversable(t, arr[k - 1]!, pt),
    );
    if (ok) out.push(...curve);
    else out.push(b);
  }
  out.push(points[points.length - 1]!);
  return out;
}
