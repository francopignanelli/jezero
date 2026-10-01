import { RAD_TO_DEG } from '../geo/angles';
import { maxDefaultSpeedMps, stepTimeS } from '../traversal/speed';
import type { PreparedTerrain } from './terrain';

/**
 * - `shortest`: minimise 3D path length, subject only to the hard constraints.
 * - `lower-risk`: minimise estimated time × risk multiplier, where
 *   risk = 1 + max(static penalty of both cells) + w_c · tan(cross-slope).
 */
export type RouteProfile = 'lower-risk' | 'shortest';

export interface StepEvaluation {
  cost: number;
  length3dM: number;
  gradeDeg: number;
  timeS: number;
}

/**
 * Cost of moving between two traversable cells `a` → `b` over ground displacement (dEast, dNorth)
 * in metres, with elevation change `dz`. The caller guarantees both cells are traversable.
 */
export function evaluateStep(
  t: PreparedTerrain,
  profile: RouteProfile,
  a: number,
  b: number,
  dEast: number,
  dNorth: number,
  dz: number,
): StepEvaluation {
  const lengthH = Math.hypot(dEast, dNorth);
  const length3dM = Math.hypot(lengthH, dz);
  const gradeDeg = lengthH > 0 ? Math.atan2(dz, lengthH) * RAD_TO_DEG : 0;
  const timeS = stepTimeS('copernico-default', length3dM, gradeDeg, t.params);
  if (profile === 'shortest') return { cost: length3dM, length3dM, gradeDeg, timeS };

  let crossTan = 0;
  if (lengthH > 0) {
    const gE = meanFinite(t.gradient.dzdEast[a]!, t.gradient.dzdEast[b]!);
    const gN = meanFinite(t.gradient.dzdNorth[a]!, t.gradient.dzdNorth[b]!);
    crossTan = Math.abs(gE * (dNorth / lengthH) - gN * (dEast / lengthH));
  }
  const risk =
    1 + Math.max(t.staticPenalty[a]!, t.staticPenalty[b]!) + t.params.crossSlopeWeight * crossTan;
  return { cost: timeS * risk, length3dM, gradeDeg, timeS };
}

/** Admissible lower bound of the remaining cost for a horizontal ground distance `lengthM`. */
export function costLowerBound(t: PreparedTerrain, profile: RouteProfile, lengthM: number): number {
  if (profile === 'shortest') return lengthM;
  return (t.params.timelineFactor * lengthM) / maxDefaultSpeedMps(t.params);
}

function meanFinite(x: number, y: number): number {
  const fx = Number.isFinite(x);
  const fy = Number.isFinite(y);
  if (fx && fy) return (x + y) / 2;
  if (fx) return x;
  if (fy) return y;
  return 0;
}
