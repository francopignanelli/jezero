import { greatCircleDistance, type ElevationProfile } from '@copernico/domain';

export interface TrackPoint {
  lat: number;
  lon: number;
  heightM: number;
}

/** A drawn path with cumulative ground distance, for distance → position lookups. */
export interface Track {
  points: TrackPoint[];
  cumM: Float64Array;
  totalM: number;
}

export function buildTrack(points: TrackPoint[]): Track {
  const cumM = new Float64Array(points.length);
  for (let i = 1; i < points.length; i++)
    cumM[i] = cumM[i - 1]! + greatCircleDistance(points[i - 1]!, points[i]!);
  return { points, cumM, totalM: cumM[points.length - 1] ?? 0 };
}

/** Index i such that cum[i] ≤ d < cum[i + 1] (clamped). */
function segmentAt(cum: ArrayLike<number>, d: number): number {
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid]! <= d) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Position at ground distance `d` along the track (linear interpolation, clamped to the ends). */
export function pointAt(track: Track, d: number): TrackPoint {
  const { points, cumM } = track;
  if (points.length === 0) throw new Error('empty track');
  if (points.length === 1 || d <= 0) return points[0]!;
  if (d >= track.totalM) return points[points.length - 1]!;
  const i = segmentAt(cumM, d);
  const a = points[i]!;
  const b = points[i + 1]!;
  const span = cumM[i + 1]! - cumM[i]!;
  const f = span > 0 ? (d - cumM[i]!) / span : 0;
  return {
    lat: a.lat + (b.lat - a.lat) * f,
    lon: a.lon + (b.lon - a.lon) * f,
    heightM: a.heightM + (b.heightM - a.heightM) * f,
  };
}

/** Evenly spaced direction markers: position plus a point `lookAheadM` further along. */
export function arrowsAlong(track: Track, spacingM: number, lookAheadM = 8) {
  const out: Array<TrackPoint & { next: TrackPoint }> = [];
  for (let d = spacingM / 2; d < track.totalM - lookAheadM; d += spacingM) {
    out.push({ ...pointAt(track, d), next: pointAt(track, d + lookAheadM) });
  }
  return out;
}

export interface ProfileSample {
  distanceM: number;
  elevationM: number;
  slopeDeg: number;
  elapsedS: number;
}

/** Profile values at distance `d` (nearest sample at or before d; samples are ≤ 1 cell apart). */
export function profileAt(profile: ElevationProfile, d: number): ProfileSample {
  const n = profile.distanceM.length;
  const last = profile.distanceM[n - 1] ?? 0;
  const i = d >= last ? n - 1 : segmentAt(profile.distanceM, Math.max(0, d));
  return {
    distanceM: Math.min(Math.max(0, d), last),
    elevationM: profile.elevationM[i]!,
    slopeDeg: profile.terrainSlopeDeg[i]!,
    elapsedS: profile.elapsedS[i]!,
  };
}

const M_PER_DEG = (Math.PI / 180) * 3_396_190;

/**
 * Shortest ground distance from `p` to a polyline and the index of the nearest segment. Uses a
 * local equirectangular frame at `p` (errors ≪ 1 m over a few km).
 */
export function nearestOnPolyline(
  points: ReadonlyArray<{ lat: number; lon: number }>,
  p: { lat: number; lon: number },
): { distanceM: number; segmentIndex: number } {
  const k = Math.cos((p.lat * Math.PI) / 180) * M_PER_DEG;
  const xy = (q: { lat: number; lon: number }) =>
    [(q.lon - p.lon) * k, (q.lat - p.lat) * M_PER_DEG] as const;
  let best = Number.POSITIVE_INFINITY;
  let bestIndex = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, ay] = xy(points[i]!);
    const [bx, by] = xy(points[i + 1]!);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const f = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const d = Math.hypot(ax + f * dx, ay + f * dy);
    if (d < best) {
      best = d;
      bestIndex = i;
    }
  }
  if (points.length === 1) best = Math.hypot(...xy(points[0]!));
  return { distanceM: best, segmentIndex: bestIndex };
}
