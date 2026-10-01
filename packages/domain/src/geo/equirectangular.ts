import { M2020_FRAME_LAT_TS_DEG, MARS_SPHERE_RADIUS_M } from '../constants';
import { DEG_TO_RAD, lonDelta, normalizeLon360, RAD_TO_DEG } from './angles';

/**
 * Equidistant cylindrical (equirectangular) projection on a sphere:
 *   x = R (λ − λ0) cos φts,  y = R φ
 * Only meridian distances are true to scale. Along a parallel at latitude φ, one projected metre
 * equals cos φ / cos φts true metres; see {@link eqcEastWestScale}.
 */
export interface EqcParams {
  /** Latitude of true scale φts (deg). */
  latTsDeg: number;
  /** Central meridian λ0 (deg, east-positive). */
  lon0Deg: number;
  /** Sphere radius (m). */
  radiusM: number;
}

/** Mars 2020 rover localization frame (PDS PLACES, MMGIS): the local metric frame for Jezero. */
export const M2020_EQC: EqcParams = {
  latTsDeg: M2020_FRAME_LAT_TS_DEG,
  lon0Deg: 0,
  radiusM: MARS_SPHERE_RADIUS_M,
};

/**
 * Frame of the USGS Mars 2020 TRN products (IAU_2015:49910): true scale only at the equator. Its
 * projected x "metres" are ~5.4 % longer than ground metres at Jezero. Never measure in it directly.
 */
export const IAU2015_49910_EQC: EqcParams = {
  latTsDeg: 0,
  lon0Deg: 0,
  radiusM: MARS_SPHERE_RADIUS_M,
};

export interface XY {
  x: number;
  y: number;
}

export function eqcForward(p: EqcParams, latDeg: number, lonDeg: number): XY {
  return {
    x: p.radiusM * lonDelta(lonDeg, p.lon0Deg) * DEG_TO_RAD * Math.cos(p.latTsDeg * DEG_TO_RAD),
    y: p.radiusM * latDeg * DEG_TO_RAD,
  };
}

export function eqcInverse(p: EqcParams, x: number, y: number): { lat: number; lon: number } {
  return {
    lat: (y / p.radiusM) * RAD_TO_DEG,
    lon: normalizeLon360(
      p.lon0Deg + (x / (p.radiusM * Math.cos(p.latTsDeg * DEG_TO_RAD))) * RAD_TO_DEG,
    ),
  };
}

/** True ground metres per projected metre along a parallel at `latDeg`: cos φ / cos φts. */
export function eqcEastWestScale(p: EqcParams, latDeg: number): number {
  return Math.cos(latDeg * DEG_TO_RAD) / Math.cos(p.latTsDeg * DEG_TO_RAD);
}
