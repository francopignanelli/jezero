import { DEG_TO_RAD, MARS_SPHERE_RADIUS_M } from '@copernico/domain';

/** Ground metres per degree of latitude on the Mars reference sphere. */
export const M_PER_DEG = MARS_SPHERE_RADIUS_M * DEG_TO_RAD;

/** Hermite smoothstep: 0 below e0, 1 above e1, an S-curve between. */
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Fraction of the remaining gap to close this frame for a time constant tau (frame-rate free). */
export const follow = (dt: number, tau: number): number => 1 - Math.exp(-dt / tau);

/** Angle wrapped to (−π, π]. */
export const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
