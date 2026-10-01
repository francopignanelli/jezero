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
