import { DEG_TO_RAD, MARS_SPHERE_RADIUS_M } from '@copernico/domain';

export interface LatLonPoint {
  lat: number;
  lon: number;
}

const M_PER_DEG = MARS_SPHERE_RADIUS_M * DEG_TO_RAD;

/** Local metric offsets (east, north) in metres; adequate for display over a few tens of km. */
function toLocal(p: LatLonPoint, ref: LatLonPoint): [number, number] {
  return [
    (p.lon - ref.lon) * M_PER_DEG * Math.cos(ref.lat * DEG_TO_RAD),
    (p.lat - ref.lat) * M_PER_DEG,
  ];
}

/**
 * Inserts intermediate vertices so no segment is longer than `maxStepM`. Existing vertices are kept
 * exactly, so the geometry of a computed route is unchanged; only its terrain draping improves.
 */
export function densify<T extends LatLonPoint>(
  points: readonly T[],
  maxStepM: number,
): LatLonPoint[] {
  if (points.length < 2) return points.map((p) => ({ lat: p.lat, lon: p.lon }));
  const out: LatLonPoint[] = [{ lat: points[0]!.lat, lon: points[0]!.lon }];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const [dx, dy] = toLocal(b, a);
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / maxStepM));
    for (let k = 1; k <= n; k++) {
      const f = k / n;
      out.push({ lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f });
    }
  }
  return out;
}

/** Douglas–Peucker simplification (display only; never applied to computed routes). */
export function simplify<T extends LatLonPoint>(points: readonly T[], toleranceM: number): T[] {
  if (points.length < 3) return [...points];
  const ref = points[0]!;
  const xy = points.map((p) => toLocal(p, ref));
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const [x1, y1] = xy[s]!;
    const [x2, y2] = xy[e]!;
    const len = Math.hypot(x2 - x1, y2 - y1) || 1e-9;
    let worst = -1;
    let worstD = 0;
    for (let i = s + 1; i < e; i++) {
      const [x, y] = xy[i]!;
      const d = Math.abs((x2 - x1) * (y1 - y) - (x1 - x) * (y2 - y1)) / len;
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst > 0 && worstD > toleranceM) {
      keep[worst] = 1;
      stack.push([s, worst], [worst, e]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/** Closed outline of a lon/lat rectangle, counter-clockwise. */
export function rectangleRing(r: {
  west: number;
  south: number;
  east: number;
  north: number;
}): LatLonPoint[] {
  return [
    { lat: r.south, lon: r.west },
    { lat: r.south, lon: r.east },
    { lat: r.north, lon: r.east },
    { lat: r.north, lon: r.west },
    { lat: r.south, lon: r.west },
  ];
}

/**
 * Removes out-and-back spikes (display only): a vertex whose two neighbours lie within 30° of the
 * same direction (the path turns back on itself) and within `maxSpikeM`, as tactical
 * re-localizations leave in a rover track.
 */
export function removeSpikes<T extends LatLonPoint>(points: readonly T[], maxSpikeM: number): T[] {
  const out = [...points];
  let changed = true;
  while (changed && out.length > 2) {
    changed = false;
    for (let i = 1; i < out.length - 1; i++) {
      const [ax, ay] = toLocal(out[i - 1]!, out[i]!);
      const [bx, by] = toLocal(out[i + 1]!, out[i]!);
      const la = Math.hypot(ax, ay);
      const lb = Math.hypot(bx, by);
      if (la === 0 || lb === 0) {
        out.splice(i, 1); // duplicate vertex
        changed = true;
        break;
      }
      const cos = (ax * bx + ay * by) / (la * lb);
      if (cos < Math.cos((30 * Math.PI) / 180) || Math.max(la, lb) > maxSpikeM) continue;
      out.splice(i, 1);
      changed = true;
      break;
    }
  }
  return out;
}

/**
 * Rounds corners by Chaikin corner cutting with the cut limited to `maxCutM` from each vertex, so the
 * displayed line never departs from the true track by more than about that distance. Display only.
 */
export function roundTrack(
  points: readonly LatLonPoint[],
  maxCutM: number,
  iterations = 3,
): LatLonPoint[] {
  let pts: LatLonPoint[] = points.map((p) => ({ lat: p.lat, lon: p.lon }));
  for (let it = 0; it < iterations && pts.length > 2; it++) {
    const next: LatLonPoint[] = [pts[0]!];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const [dx, dy] = toLocal(b, a);
      const len = Math.hypot(dx, dy);
      if (len === 0) continue;
      const f = Math.min(0.25, maxCutM / len);
      const at = (t: number) => ({
        lat: a.lat + (b.lat - a.lat) * t,
        lon: a.lon + (b.lon - a.lon) * t,
      });
      if (i > 0) next.push(at(f));
      if (i < pts.length - 2) next.push(at(1 - f));
    }
    next.push(pts.at(-1)!);
    pts = next;
    maxCutM /= 2; // later passes refine the curve within the first cut
  }
  return pts;
}
