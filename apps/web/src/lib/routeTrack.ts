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
