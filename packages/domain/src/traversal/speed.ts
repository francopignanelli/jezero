import type { EvaParams } from './params';

/**
 * Walking-speed models, all derived from lunar (1/6 g) Apollo experience. None has been validated
 * for suited walking at Mars gravity. The spread between them is shown as an uncertainty indicator.
 */
export type SpeedModelId = 'copernico-default' | 'sextant-apollo14' | 'apollo-walkback-constant';

export const SPEED_MODELS: readonly SpeedModelId[] = [
  'copernico-default',
  'sextant-apollo14',
  'apollo-walkback-constant',
];

/** SEXTANT piecewise model (Johnson et al. 2010, after Márquez, Apollo 14): [grade deg, m/s]. */
const SEXTANT_KNOTS: ReadonlyArray<readonly [number, number]> = [
  [-20, 0.05],
  [-10, 1.0],
  [0, 1.6],
  [6, 0.4],
  [15, 0.05],
  [20, 0.05],
];

/** Apollo walkback planning speed for walks longer than 1 h (Olthoff ICES-2018-259). */
const APOLLO_WALKBACK_MPS = 2.7 / 3.6;

/**
 * Walking speed (m/s) for a signed directional grade (deg; positive = uphill). The timeline factor
 * is not included here; see {@link stepTimeS}.
 */
export function walkingSpeedMps(model: SpeedModelId, gradeDeg: number, p: EvaParams): number {
  switch (model) {
    case 'copernico-default': {
      const factor = Math.max(p.minSpeedFactor, 1 - p.slopeSpeedFactorPerDeg * Math.abs(gradeDeg));
      return (p.levelSpeedKmh / 3.6) * factor;
    }
    case 'sextant-apollo14':
      return interpolateKnots(SEXTANT_KNOTS, gradeDeg);
    case 'apollo-walkback-constant':
      return APOLLO_WALKBACK_MPS;
  }
}

/** Upper bound on walking speed under the default model, used for admissible A* heuristics. */
export function maxDefaultSpeedMps(p: EvaParams): number {
  return p.levelSpeedKmh / 3.6;
}

/** Planned duration (s) of a step of 3D length `length3dM`, including the timeline factor. */
export function stepTimeS(
  model: SpeedModelId,
  length3dM: number,
  gradeDeg: number,
  p: EvaParams,
): number {
  return (p.timelineFactor * length3dM) / walkingSpeedMps(model, gradeDeg, p);
}

function interpolateKnots(knots: ReadonlyArray<readonly [number, number]>, x: number): number {
  const first = knots[0]!;
  const last = knots[knots.length - 1]!;
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < knots.length; i++) {
    const [x1, y1] = knots[i]!;
    const [x0, y0] = knots[i - 1]!;
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return last[1];
}
