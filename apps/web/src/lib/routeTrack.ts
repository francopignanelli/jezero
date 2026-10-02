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

/** Distance along the profile at a walking time (s), interpolated between samples. */
export function distanceAtElapsed(profile: ElevationProfile, walkS: number): number {
  const e = profile.elapsedS;
  const n = e.length;
  if (n === 0) return 0;
  if (walkS <= 0) return 0;
  if (walkS >= e[n - 1]!) return profile.distanceM[n - 1]!;
  const i = segmentAt(e, walkS);
  const span = e[i + 1]! - e[i]!;
  const f = span > 0 ? (walkS - e[i]!) / span : 0;
  return profile.distanceM[i]! + (profile.distanceM[i + 1]! - profile.distanceM[i]!) * f;
}

export type SlopeBand = 'mild' | 'moderate' | 'steep';

/**
 * Splits the drawn route into runs of one slope band (from the profile, which samples the true
 * path at ≤ 1 cell), as dense point lists along the track. Profile distances are mapped onto the
 * track proportionally (the drawn track and the profile differ by well under 1 %).
 */
export function slopeRuns(
  track: Track,
  profile: ElevationProfile,
  limits: { mild: number; moderate: number },
  stepM = 8,
): Array<{ band: SlopeBand; points: TrackPoint[] }> {
  const n = profile.distanceM.length;
  if (n < 2 || track.totalM === 0) return [];
  const scale = track.totalM / Math.max(1e-9, profile.distanceM[n - 1]!);
  const bandOf = (s: number): SlopeBand =>
    s <= limits.mild ? 'mild' : s <= limits.moderate ? 'moderate' : 'steep';
  const runs: Array<{ band: SlopeBand; from: number; to: number }> = [];
  for (let i = 1; i < n; i++) {
    const band = bandOf(profile.terrainSlopeDeg[i] ?? 0);
    const from = profile.distanceM[i - 1]! * scale;
    const to = profile.distanceM[i]! * scale;
    const last = runs[runs.length - 1];
    if (last && last.band === band) last.to = to;
    else runs.push({ band, from, to });
  }
  return runs.map(({ band, from, to }) => {
    const points: TrackPoint[] = [];
    for (let d = from; d < to; d += stepM) points.push(pointAt(track, d));
    points.push(pointAt(track, to));
    if (points.length === 1) points.unshift(pointAt(track, from));
    return { band, points };
  });
}
