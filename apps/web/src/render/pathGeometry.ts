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
