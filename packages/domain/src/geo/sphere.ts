import { MARS_SPHERE_RADIUS_M } from '../constants';
import { DEG_TO_RAD } from './angles';

/** Planetocentric latitude, east-positive longitude, degrees. */
export interface LatLon {
  lat: number;
  lon: number;
}

/** Great-circle distance (m) on the Mars reference sphere (haversine; exact on a sphere). */
export function greatCircleDistance(a: LatLon, b: LatLon, radiusM = MARS_SPHERE_RADIUS_M): number {
  const φ1 = a.lat * DEG_TO_RAD;
  const φ2 = b.lat * DEG_TO_RAD;
  const dφ = φ2 - φ1;
  const dλ = (b.lon - a.lon) * DEG_TO_RAD;
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * radiusM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial compass bearing (° clockwise from north, 0–360) of the great circle from a to b. */
export function initialBearingDeg(a: LatLon, b: LatLon): number {
  const φ1 = a.lat * DEG_TO_RAD;
  const φ2 = b.lat * DEG_TO_RAD;
  const dλ = (b.lon - a.lon) * DEG_TO_RAD;
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  return (((Math.atan2(y, x) / DEG_TO_RAD) % 360) + 360) % 360;
}

/**
 * Elevation angle (°) at which an observer sees a point on the sphere: exact for heights above the
 * reference sphere and a great-circle separation, so it includes the curvature drop (≈ d²/2R).
 */
export function elevationAngleDeg(
  distanceM: number,
  observerHeightM: number,
  targetHeightM: number,
  radiusM = MARS_SPHERE_RADIUS_M,
): number {
  const δ = distanceM / radiusM;
  const r0 = radiusM + observerHeightM;
  const r = radiusM + targetHeightM;
  return Math.atan2(r * Math.cos(δ) - r0, r * Math.sin(δ)) / DEG_TO_RAD;
}
