import type { BarrierKind } from './reachability';
import type { RouteMetrics } from './metrics';
import type { EvaParams } from '../traversal/params';

/**
 * Structured, language-neutral facts about a route. The UI renders them through localized templates
 * and the assistant receives them verbatim, so explanations never depend on generated text.
 */
export type ExplanationCode =
  | {
      code: 'DETOUR_AVOIDS_STEEP_TERRAIN';
      extraDistanceM: number;
      steepAvoidedM: number;
      moderateAvoidedM: number;
      lowerRiskMaxSlopeDeg: number;
      shortestMaxSlopeDeg: number;
    }
  | { code: 'SAME_AS_SHORTEST' }
  | { code: 'MAX_SLOPE'; slopeDeg: number; limitDeg: number }
  | { code: 'ROUGH_TERRAIN'; distanceM: number }
  | { code: 'LOW_THERMAL_INERTIA'; distanceM: number }
  | { code: 'WALKBACK_EXCEEDED'; atDistanceM: number; marginS: number }
  | { code: 'EVA_NOMINAL_EXCEEDED'; durationS: number; nominalS: number }
  | { code: 'WALK_RADIUS_EXCEEDED'; maxDistanceM: number; limitM: number }
  | { code: 'OUTSIDE_COVERAGE'; waypointIndex: number }
  | { code: 'WAYPOINT_NOT_TRAVERSABLE'; waypointIndex: number; reason: 'slope' | 'nodata' | 'excluded' }
  | {
      code: 'DISCONNECTED';
      legIndex: number;
      barrier: BarrierKind;
      nearestReachable: { lat: number; lon: number };
      gapM: number;
    };

/** Operational warnings derived from a single route's metrics. */
export function explainMetrics(m: RouteMetrics, p: EvaParams): ExplanationCode[] {
  const codes: ExplanationCode[] = [
    { code: 'MAX_SLOPE', slopeDeg: m.maxTerrainSlopeDeg, limitDeg: p.maxSlopeDeg },
  ];
  if (m.roughDistanceM > 0) codes.push({ code: 'ROUGH_TERRAIN', distanceM: m.roughDistanceM });
  if (m.lowThermalInertiaDistanceM > 0) {
    codes.push({ code: 'LOW_THERMAL_INERTIA', distanceM: m.lowThermalInertiaDistanceM });
  }
  if (!m.walkback.ok) {
    codes.push({
      code: 'WALKBACK_EXCEEDED',
      atDistanceM: m.walkback.firstViolationAtM ?? 0,
      marginS: m.walkback.worstMarginS,
    });
  }
  const nominalS = p.evaNominalHours * 3600;
  if (m.estimatedDurationS > nominalS) {
    codes.push({ code: 'EVA_NOMINAL_EXCEEDED', durationS: m.estimatedDurationS, nominalS });
  }
  if (m.maxDistanceFromStartM > p.walkRadiusWarningM) {
    codes.push({ code: 'WALK_RADIUS_EXCEEDED', maxDistanceM: m.maxDistanceFromStartM, limitM: p.walkRadiusWarningM });
  }
  return codes;
}

/** Minimum avoided length (m) for a slope-band difference to be reported (≥ 2 routing cells). */
const MIN_REPORTED_AVOIDANCE_M = 10;

/**
 * Why the lower-risk route differs from the shortest feasible one. A difference is reported when the
 * lower-risk route avoids a meaningful length of steep or moderate slopes, even if it is barely longer.
 */
export function explainComparison(lowerRisk: RouteMetrics, shortest: RouteMetrics): ExplanationCode {
  const extra = lowerRisk.horizontalDistanceM - shortest.horizontalDistanceM;
  const steepAvoidedM = Math.max(0, shortest.bandDistanceM.steep - lowerRisk.bandDistanceM.steep);
  const moderateAvoidedM = Math.max(0, shortest.bandDistanceM.moderate - lowerRisk.bandDistanceM.moderate);
  const longer = extra > Math.max(10, 0.01 * shortest.horizontalDistanceM);
  if (!longer && steepAvoidedM < MIN_REPORTED_AVOIDANCE_M && moderateAvoidedM < MIN_REPORTED_AVOIDANCE_M) {
    return { code: 'SAME_AS_SHORTEST' };
  }
  return {
    code: 'DETOUR_AVOIDS_STEEP_TERRAIN',
    extraDistanceM: Math.max(0, extra),
    steepAvoidedM,
    moderateAvoidedM,
    lowerRiskMaxSlopeDeg: lowerRisk.maxTerrainSlopeDeg,
    shortestMaxSlopeDeg: shortest.maxTerrainSlopeDeg,
  };
}
