import * as Astronomy from 'astronomy-engine';
import { DEG_TO_RAD, RAD_TO_DEG } from '../geo/angles';

/** Row-major 3×3 rotation matrix. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];
export type Vec3 = [number, number, number];

/**
 * Rotation from ICRF/J2000 equatorial coordinates to the Mars body-fixed frame at a UTC instant,
 * using the IAU WGCCRE 2015 rotation model for Mars (pole α0, δ0 and prime meridian W, via
 * astronomy-engine's RotationAxis): M = Rz(W) · Rx(90° − δ0) · Rz(90° + α0).
 * Body frame: x → 0°N 0°E, y → 0°N 90°E, z → north pole (the frame of the renderer).
 */
export function icrfToMarsFixed(utcMs: number): Mat3 {
  const axis = Astronomy.RotationAxis(Astronomy.Body.Mars, Astronomy.MakeTime(new Date(utcMs)));
  const a = (axis.ra * 15 + 90) * DEG_TO_RAD;
  const b = (90 - axis.dec) * DEG_TO_RAD;
  const w = axis.spin * DEG_TO_RAD;
  const rz = (t: number): Mat3 => [
    Math.cos(t),
    Math.sin(t),
    0,
    -Math.sin(t),
    Math.cos(t),
    0,
    0,
    0,
    1,
  ];
  const rx = (t: number): Mat3 => [
    1,
    0,
    0,
    0,
    Math.cos(t),
    Math.sin(t),
    0,
    -Math.sin(t),
    Math.cos(t),
  ];
  return mul(rz(w), mul(rx(b), rz(a)));
}

export function mul(p: Mat3, q: Mat3): Mat3 {
  const r = new Array<number>(9).fill(0) as Mat3;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r[i * 3 + j] = p[i * 3]! * q[j]! + p[i * 3 + 1]! * q[3 + j]! + p[i * 3 + 2]! * q[6 + j]!;
    }
  }
  return r;
}

export function apply(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/** Unit vector for right ascension / declination (radians) in ICRF. */
export function raDecToVector(raRad: number, decRad: number): Vec3 {
  return [Math.cos(decRad) * Math.cos(raRad), Math.cos(decRad) * Math.sin(raRad), Math.sin(decRad)];
}

export type SkyBodyId =
  'Sun' | 'Mercury' | 'Venus' | 'Earth' | 'Jupiter' | 'Saturn' | 'Uranus' | 'Neptune';

export interface SkyBody {
  id: SkyBodyId;
  /** Unit direction from Mars's centre, ICRF. */
  directionIcrf: Vec3;
  distanceAu: number;
  /** Apparent angular diameter as seen from Mars (deg). */
  angularDiameterDeg: number;
  /**
   * Approximate apparent visual magnitude from Mars: H + 5 log10(r·Δ) with no phase correction
   * (display only). The Sun uses −26.74 + 5 log10(r).
   */
  magnitude: number;
}

/** Absolute magnitudes H (V, 1 AU from Sun and observer) and mean radii (km). */
const PLANETS: Record<
  Exclude<SkyBodyId, 'Sun'>,
  { body: Astronomy.Body; h: number; radiusKm: number }
> = {
  Mercury: { body: Astronomy.Body.Mercury, h: -0.6, radiusKm: 2439.4 },
  Venus: { body: Astronomy.Body.Venus, h: -4.47, radiusKm: 6051.8 },
  Earth: { body: Astronomy.Body.Earth, h: -3.99, radiusKm: 6371.0 },
  Jupiter: { body: Astronomy.Body.Jupiter, h: -9.4, radiusKm: 69911 },
  Saturn: { body: Astronomy.Body.Saturn, h: -8.88, radiusKm: 58232 },
  Uranus: { body: Astronomy.Body.Uranus, h: -7.19, radiusKm: 25362 },
  Neptune: { body: Astronomy.Body.Neptune, h: -6.87, radiusKm: 24622 },
};
const AU_KM = 149_597_870.7;
const SUN_RADIUS_KM = 695_700;

/**
 * Sun and planets as seen from Mars's centre at a UTC instant (geometric positions; light-time and
 * aberration are below display resolution). Phobos and Deimos are not included.
 */
export function solarSystemFromMars(utcMs: number): SkyBody[] {
  const time = Astronomy.MakeTime(new Date(utcMs));
  const mars = Astronomy.HelioVector(Astronomy.Body.Mars, time);
  const rMars = Math.hypot(mars.x, mars.y, mars.z);
  const out: SkyBody[] = [];
  const sunVec: Vec3 = [-mars.x, -mars.y, -mars.z];
  out.push({
    id: 'Sun',
    directionIcrf: normalize(sunVec),
    distanceAu: rMars,
    angularDiameterDeg: 2 * Math.atan(SUN_RADIUS_KM / (rMars * AU_KM)) * RAD_TO_DEG,
    magnitude: -26.74 + 5 * Math.log10(rMars),
  });
  for (const [id, p] of Object.entries(PLANETS) as Array<
    [Exclude<SkyBodyId, 'Sun'>, (typeof PLANETS)[keyof typeof PLANETS]]
  >) {
    const v = Astronomy.HelioVector(p.body, time);
    const r = Math.hypot(v.x, v.y, v.z);
    const rel: Vec3 = [v.x - mars.x, v.y - mars.y, v.z - mars.z];
    const delta = Math.hypot(...rel);
    out.push({
      id,
      directionIcrf: normalize(rel),
      distanceAu: delta,
      angularDiameterDeg: 2 * Math.atan(p.radiusKm / (delta * AU_KM)) * RAD_TO_DEG,
      magnitude: p.h + 5 * Math.log10(r * delta),
    });
  }
  return out;
}

function normalize(v: Vec3): Vec3 {
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
}
