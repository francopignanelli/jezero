import type { ExplanationCode } from '@copernico/domain';
import type { TFunction } from 'i18next';
import { formatDegrees, formatDistance, formatDuration } from './format';

/** Renders a structured explanation code with localized templates and data-appropriate precision. */
export function explanationText(e: ExplanationCode, t: TFunction, locale: string): string {
  const d = (m: number) => formatDistance(m, locale);
  switch (e.code) {
    case 'DETOUR_AVOIDS_STEEP_TERRAIN':
      return t('explain.DETOUR_AVOIDS_STEEP_TERRAIN', {
        extra: d(e.extraDistanceM),
        steep: d(e.steepAvoidedM),
        moderate: d(e.moderateAvoidedM),
        lrMax: formatDegrees(e.lowerRiskMaxSlopeDeg, locale),
        shMax: formatDegrees(e.shortestMaxSlopeDeg, locale),
      });
    case 'SAME_AS_SHORTEST':
      return t('explain.SAME_AS_SHORTEST');
    case 'MAX_SLOPE':
      return t('explain.MAX_SLOPE', {
        slope: formatDegrees(e.slopeDeg, locale),
        limit: formatDegrees(e.limitDeg, locale),
      });
    case 'ROUGH_TERRAIN':
      return t('explain.ROUGH_TERRAIN', { distance: d(e.distanceM) });
    case 'LOW_THERMAL_INERTIA':
      return t('explain.LOW_THERMAL_INERTIA', { distance: d(e.distanceM) });
    case 'WALKBACK_EXCEEDED':
      return t('explain.WALKBACK_EXCEEDED', { at: d(e.atDistanceM) });
    case 'EVA_NOMINAL_EXCEEDED':
      return t('explain.EVA_NOMINAL_EXCEEDED', { duration: formatDuration(e.durationS) });
    case 'WALK_RADIUS_EXCEEDED':
      return t('explain.WALK_RADIUS_EXCEEDED', { distance: d(e.maxDistanceM), limit: d(e.limitM) });
    case 'OUTSIDE_COVERAGE':
      return t('explain.OUTSIDE_COVERAGE', { n: e.waypointIndex + 1 });
    case 'WAYPOINT_NOT_TRAVERSABLE':
      return t('explain.WAYPOINT_NOT_TRAVERSABLE', {
        n: e.waypointIndex + 1,
        reason: t(`explain.reason.${e.reason}`),
      });
    case 'DISCONNECTED':
      return t('explain.DISCONNECTED', {
        leg: e.legIndex + 1,
        barrier: t(`explain.barrier.${e.barrier}`),
        gap: d(e.gapM),
      });
  }
}

/** Codes that indicate a warning (rendered with a warning style). */
export function isWarning(e: ExplanationCode): boolean {
  return [
    'WALKBACK_EXCEEDED',
    'EVA_NOMINAL_EXCEEDED',
    'WALK_RADIUS_EXCEEDED',
    'ROUGH_TERRAIN',
    'LOW_THERMAL_INERTIA',
  ].includes(e.code);
}
