import { DEG_TO_RAD, eastToWestLon } from '../geo/angles';
import { planetocentricToPlanetographic } from '../geo/latitude';
import type { LatLon } from '../geo/sphere';
import { localMeanSolarTime, localTrueSolarTime, mars24, solarZenithAzimuth } from './mars24';

/**
 * Unit vector from Mars's centre toward the Sun in the Mars body-fixed frame
 * (x → 0°N 0°E, y → 0°N 90°E, z → north pole), computed from the Mars24 subsolar point.
 * The subsolar point is where the surface normal points at the Sun, so its planetographic latitude
 * equals the solar declination. Used for calculated scene lighting.
 */
export function sunDirectionBodyFixed(utcMs: number): [number, number, number] {
  const s = mars24(utcMs);
  const lat = s.solarDeclinationDeg * DEG_TO_RAD;
  const lonEast = -s.subsolarLonWestDeg * DEG_TO_RAD;
  return [Math.cos(lat) * Math.cos(lonEast), Math.cos(lat) * Math.sin(lonEast), Math.sin(lat)];
}

export interface SolarPosition {
  elevationDeg: number;
  /** Clockwise from north (deg). */
  azimuthDeg: number;
  lmstHours: number;
  ltstHours: number;
  lsDeg: number;
}

/** Calculated solar position for a surface site given in planetocentric °N / east-positive °E. */
export function solarPosition(utcMs: number, site: LatLon): SolarPosition {
  const s = mars24(utcMs);
  const west = eastToWestLon(site.lon);
  const { elevationDeg, azimuthDeg } = solarZenithAzimuth(
    s,
    planetocentricToPlanetographic(site.lat),
    west,
  );
  return {
    elevationDeg,
    azimuthDeg,
    lmstHours: localMeanSolarTime(s, west),
    ltstHours: localTrueSolarTime(s, west),
    lsDeg: s.lsDeg,
  };
}

/**
 * Next UTC instant (ms) at or after `fromUtcMs` when the Local True Solar Time at `site` equals
 * `targetHours`. Scans at 60 s, then bisects to 1 s. LTST advances ~24 h per sol, so a match always
 * exists within one sol (+ margin).
 */
export function nextLocalTrueSolarTime(
  fromUtcMs: number,
  site: LatLon,
  targetHours: number,
): number {
  const offset = (t: number): number => {
    const d = solarPosition(t, site).ltstHours - targetHours;
    return ((d % 24) + 24) % 24; // hours until LTST would pass the target, in [0, 24)
  };
  const step = 60_000;
  let prev = fromUtcMs;
  let prevOffset = offset(prev);
  if (prevOffset === 0) return prev;
  for (let t = fromUtcMs + step; t <= fromUtcMs + 90_000_000; t += step) {
    const o = offset(t);
    if (o < prevOffset && prevOffset - o > 12) {
      // wrapped past the target between prev and t
      let lo = prev;
      let hi = t;
      while (hi - lo > 1000) {
        const mid = (lo + hi) / 2;
        if (offset(mid) > 12) lo = mid;
        else hi = mid;
      }
      return hi;
    }
    prev = t;
    prevOffset = o;
  }
  return fromUtcMs;
}

export interface DaylightWindow {
  /** First instant (ms) in the window with solar elevation ≥ threshold. */
  startUtcMs: number;
  /** Last instant (ms) in the window with solar elevation ≥ threshold. */
  endUtcMs: number;
}

/**
 * Interval with solar elevation ≥ `minElevationDeg` within [fromUtcMs, fromUtcMs + durationMs),
 * found by scanning at `stepS` and refining each crossing by bisection to 1 s.
 * Returns null if the Sun never reaches the threshold (e.g. polar night).
 */
export function daylightWindow(
  fromUtcMs: number,
  durationMs: number,
  site: LatLon,
  minElevationDeg: number,
  stepS = 300,
): DaylightWindow | null {
  const above = (t: number): boolean => solarPosition(t, site).elevationDeg >= minElevationDeg;
  const refine = (lo: number, hi: number, loAbove: boolean): number => {
    while (hi - lo > 1000) {
      const mid = (lo + hi) / 2;
      if (above(mid) === loAbove) lo = mid;
      else hi = mid;
    }
    return loAbove ? lo : hi;
  };
  let start: number | null = null;
  let end: number | null = null;
  let prevT = fromUtcMs;
  let prevAbove = above(prevT);
  if (prevAbove) start = prevT;
  for (let t = fromUtcMs + stepS * 1000; t <= fromUtcMs + durationMs; t += stepS * 1000) {
    const nowAbove = above(t);
    if (!prevAbove && nowAbove && start === null) start = refine(prevT, t, false);
    if (prevAbove && !nowAbove && start !== null) {
      end = refine(prevT, t, true);
      break;
    }
    prevT = t;
    prevAbove = nowAbove;
  }
  if (start === null) return null;
  return { startUtcMs: start, endUtcMs: end ?? fromUtcMs + durationMs };
}
