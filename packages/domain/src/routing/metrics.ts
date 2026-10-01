import { RAD_TO_DEG } from '../geo/angles';
import type { XY } from '../geo/equirectangular';
import { SPEED_MODELS, stepTimeS, type SpeedModelId } from '../traversal/speed';
import type { SlopeBandKey } from '../traversal/params';
import { sampleSteps } from './polyline';
import { bandFor, type PreparedTerrain } from './terrain';

export interface ElevationProfile {
  /** Cumulative horizontal ground distance at each sample (m). */
  distanceM: Float32Array;
  elevationM: Float32Array;
  /** Constraint slope of the terrain cell under each sample (deg). */
  terrainSlopeDeg: Float32Array;
  /** Elapsed walking time at each sample (s, default speed model; excludes stops). */
  elapsedS: Float32Array;
}

export interface WalkbackCheck {
  ok: boolean;
  /** Smallest margin (s) over all vertices: cap − (elapsed + return along path + ingress). */
  worstMarginS: number;
  /** Cumulative distance (m) of the first violating sample, or null. */
  firstViolationAtM: number | null;
}

export interface RouteMetrics {
  horizontalDistanceM: number;
  distance3dM: number;
  elevationGainM: number;
  elevationLossM: number;
  maxTerrainSlopeDeg: number;
  maxAbsGradeDeg: number;
  bandDistanceM: Record<SlopeBandKey, number>;
  roughDistanceM: number;
  lowThermalInertiaDistanceM: number;
  /** Default speed model including the timeline factor (s). */
  estimatedDurationS: number;
  durationByModelS: Record<SpeedModelId, number>;
  maxDistanceFromStartM: number;
  walkback: WalkbackCheck;
  profile: ElevationProfile;
}

/**
 * Metrics are always recomputed on the final polyline sampled at ≤ 1 cell, independent of the
 * search graph, so smoothing cannot hide slope or length.
 */
export function computeMetrics(t: PreparedTerrain, points: readonly XY[]): RouteMetrics {
  const p = t.params;
  const steps = sampleSteps(t, points, 1);
  const n = steps.length + 1;
  const distanceM = new Float32Array(n);
  const elevationM = new Float32Array(n);
  const terrainSlopeDeg = new Float32Array(n);
  const bandDistanceM: Record<SlopeBandKey, number> = { mild: 0, moderate: 0, steep: 0 };
  const durationByModelS = Object.fromEntries(SPEED_MODELS.map((m) => [m, 0])) as Record<
    SpeedModelId,
    number
  >;
  const forwardTimeS = new Float64Array(n);
  const backStepTimeS = new Float64Array(n);

  let horizontal = 0;
  let length3d = 0;
  let maxGrade = 0;
  let maxSlope = 0;
  let rough = 0;
  let lowTi = 0;
  let maxFromStart = 0;
  const start = points[0]!;

  const first = steps[0];
  elevationM[0] = first ? first.zFrom : Number.NaN;
  terrainSlopeDeg[0] = first ? t.constraintSlopeDeg[first.cellFrom]! : Number.NaN;
  maxSlope = Number.isFinite(terrainSlopeDeg[0]!) ? terrainSlopeDeg[0]! : 0;

  steps.forEach((s, i) => {
    const lengthH = Math.hypot(s.dEastM, s.dNorthM);
    const dz = s.zTo - s.zFrom;
    const l3 = Math.hypot(lengthH, dz);
    const grade = lengthH > 0 ? Math.atan2(dz, lengthH) * RAD_TO_DEG : 0;
    horizontal += lengthH;
    length3d += l3;
    maxGrade = Math.max(maxGrade, Math.abs(grade));
    for (const model of SPEED_MODELS) durationByModelS[model] += stepTimeS(model, l3, grade, p);
    forwardTimeS[i + 1] = forwardTimeS[i]! + stepTimeS('copernico-default', l3, grade, p);
    backStepTimeS[i + 1] = stepTimeS('copernico-default', l3, -grade, p);

    const slope = t.constraintSlopeDeg[s.cellTo]!;
    distanceM[i + 1] = horizontal;
    elevationM[i + 1] = s.zTo;
    terrainSlopeDeg[i + 1] = slope;
    if (Number.isFinite(slope)) maxSlope = Math.max(maxSlope, slope);
    const band = bandFor(slope, p);
    if (band) bandDistanceM[band] += lengthH;
    if (t.rough[s.cellTo] === 1) rough += lengthH;
    if (t.lowThermalInertia[s.cellTo] === 1) lowTi += lengthH;
    maxFromStart = Math.max(maxFromStart, groundDistance(t, start, s.to));
  });

  const { gain, loss } = gainLoss(elevationM, p.gainHysteresisM);

  // Walkback: at each sample, elapsed time + time to get back to the start along the planned path
  // + ingress. On a loop (route ends where it started) the crew may either backtrack or continue
  // forward around the loop, whichever is quicker; otherwise it must backtrack.
  const capS = p.evaCapHours * 3600;
  const ingressS = p.ingressHours * 3600;
  const isLoop =
    points.length > 2 &&
    groundDistance(t, start, points[points.length - 1]!) <= t.layers.spec.cellSize;
  const totalForwardS = forwardTimeS[n - 1]!;
  let worstMarginS = Number.POSITIVE_INFINITY;
  let firstViolationAtM: number | null = null;
  const backtrackS = new Float64Array(n);
  for (let i = 1; i < n; i++) backtrackS[i] = backtrackS[i - 1]! + backStepTimeS[i]!;
  for (let i = 0; i < n; i++) {
    const returnS = isLoop
      ? Math.min(backtrackS[i]!, totalForwardS - forwardTimeS[i]!)
      : backtrackS[i]!;
    const margin = capS - (forwardTimeS[i]! + returnS + ingressS);
    if (margin < worstMarginS) worstMarginS = margin;
    if (margin < 0 && firstViolationAtM === null) firstViolationAtM = distanceM[i]!;
  }

  return {
    horizontalDistanceM: horizontal,
    distance3dM: length3d,
    elevationGainM: gain,
    elevationLossM: loss,
    maxTerrainSlopeDeg: maxSlope,
    maxAbsGradeDeg: maxGrade,
    bandDistanceM,
    roughDistanceM: rough,
    lowThermalInertiaDistanceM: lowTi,
    estimatedDurationS: durationByModelS['copernico-default'],
    durationByModelS,
    maxDistanceFromStartM: maxFromStart,
    walkback: { ok: firstViolationAtM === null, worstMarginS, firstViolationAtM },
    profile: { distanceM, elevationM, terrainSlopeDeg, elapsedS: Float32Array.from(forwardTimeS) },
  };
}

/**
 * Cumulative gain and loss with a hysteresis threshold that suppresses DTM noise. The final residual
 * is added so that gain − loss equals the net elevation change exactly.
 */
export function gainLoss(
  elevations: ArrayLike<number>,
  hysteresisM: number,
): { gain: number; loss: number } {
  let gain = 0;
  let loss = 0;
  let ref = Number.NaN;
  let last = Number.NaN;
  for (let i = 0; i < elevations.length; i++) {
    const z = elevations[i]!;
    if (!Number.isFinite(z)) continue;
    last = z;
    if (Number.isNaN(ref)) {
      ref = z;
      continue;
    }
    if (z - ref >= hysteresisM) {
      gain += z - ref;
      ref = z;
    } else if (ref - z >= hysteresisM) {
      loss += ref - z;
      ref = z;
    }
  }
  if (Number.isFinite(last) && Number.isFinite(ref)) {
    if (last > ref) gain += last - ref;
    else loss += ref - last;
  }
  return { gain, loss };
}

function groundDistance(t: PreparedTerrain, a: XY, b: XY): number {
  const spec = t.layers.spec;
  const row = Math.min(
    spec.rows - 1,
    Math.max(0, Math.floor((spec.originY - (a.y + b.y) / 2) / spec.cellSize)),
  );
  const scale = t.rowWidthM[row]! / spec.cellSize;
  return Math.hypot((b.x - a.x) * scale, b.y - a.y);
}
