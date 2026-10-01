import { MARS_EQUATORIAL_RADIUS_M, MARS_POLAR_RADIUS_M } from '../constants';
import { DEG_TO_RAD, RAD_TO_DEG } from './angles';

const AXIS_RATIO_SQ = (MARS_EQUATORIAL_RADIUS_M / MARS_POLAR_RADIUS_M) ** 2;

/**
 * Planetocentric → planetographic latitude on the IAU 2015 Mars ellipsoid:
 * tan φg = (a/b)² tan φc. Needed only by Mars24 solar geometry (steps D-5, D-6).
 */
export function planetocentricToPlanetographic(latDeg: number): number {
  if (Math.abs(latDeg) >= 90) return latDeg;
  return Math.atan(AXIS_RATIO_SQ * Math.tan(latDeg * DEG_TO_RAD)) * RAD_TO_DEG;
}

export function planetographicToPlanetocentric(latDeg: number): number {
  if (Math.abs(latDeg) >= 90) return latDeg;
  return Math.atan(Math.tan(latDeg * DEG_TO_RAD) / AXIS_RATIO_SQ) * RAD_TO_DEG;
}
