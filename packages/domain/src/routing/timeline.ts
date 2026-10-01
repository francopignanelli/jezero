import type { LatLon } from '../geo/sphere';
import { solarPosition } from '../time/sun';
import type { RouteResult } from './planner';

/** Default time spent working at each stop (an assumption, editable per stop). */
export const DEFAULT_DWELL_MIN = 20;

export type TimelineEventKind = 'depart' | 'arrive' | 'leave' | 'end';

export interface TimelineEvent {
  kind: TimelineEventKind;
  /** Waypoint index in the request order (the return to start reuses index 0). */
  waypointIndex: number;
  utcMs: number;
  /** Seconds since departure. */
  elapsedS: number;
}

/** One block of the EVA: walking a leg or working at a stop. */
export interface TimelineSegment {
  kind: 'walk' | 'dwell';
  /** Leg index for walks, waypoint index for dwells. */
  index: number;
  startS: number;
  endS: number;
}

export interface EvaTimeline {
  startUtcMs: number;
  endUtcMs: number;
  walkS: number;
  dwellS: number;
  totalS: number;
  events: TimelineEvent[];
  segments: TimelineSegment[];
  /** Sun elevation every `stepS` from departure to the end of the EVA (deg). */
  sun: Array<{ elapsedS: number; elevationDeg: number }>;
  minSunElevationDeg: number;
  /** First moment during the EVA with the Sun below the threshold, or null. */
  sunBelowAtS: number | null;
  /** Time from the end of the EVA until the Sun drops below the threshold (s); null if it already is. */
  daylightMarginS: number | null;
  /**
   * Walk-back margin including stop time: conservative lower bound (the walking-only worst margin
   * minus all stop time, as if every stop came before the worst point).
   */
  walkbackMarginS: number;
}

/**
 * EVA timeline: walking legs from the planner plus time at each intermediate stop, placed at the
 * planned start time, with the calculated Sun elevation at Jezero over the whole EVA. Stop time
 * applies after every leg except the last (the EVA ends on arrival). `dwellMin` is indexed by
 * waypoint in request order.
 */
export function buildTimeline(
  route: RouteResult,
  dwellMin: readonly number[],
  returnToStart: boolean,
  startUtcMs: number,
  site: LatLon,
  minSunElevationDeg = 10,
  stepS = 300,
): EvaTimeline | null {
  if (route.status !== 'ok' || !route.metrics) return null;
  const waypointCount = returnToStart ? route.legs.length : route.legs.length + 1;
  const events: TimelineEvent[] = [
    { kind: 'depart', waypointIndex: 0, utcMs: startUtcMs, elapsedS: 0 },
  ];
  const segments: TimelineSegment[] = [];
  let t = 0;
  let walkS = 0;
  let dwellS = 0;
  route.legs.forEach((leg, i) => {
    segments.push({ kind: 'walk', index: i, startS: t, endS: t + leg.estimatedDurationS });
    t += leg.estimatedDurationS;
    walkS += leg.estimatedDurationS;
    const wp = leg.toWaypoint >= waypointCount ? 0 : leg.toWaypoint;
    const last = i === route.legs.length - 1;
    events.push({
      kind: last ? 'end' : 'arrive',
      waypointIndex: wp,
      utcMs: startUtcMs + t * 1000,
      elapsedS: t,
    });
    if (last) return;
    const d = Math.max(0, dwellMin[wp] ?? DEFAULT_DWELL_MIN) * 60;
    if (d === 0) return;
    segments.push({ kind: 'dwell', index: wp, startS: t, endS: t + d });
    t += d;
    dwellS += d;
    events.push({ kind: 'leave', waypointIndex: wp, utcMs: startUtcMs + t * 1000, elapsedS: t });
  });

  const sun: EvaTimeline['sun'] = [];
  let sunBelowAtS: number | null = null;
  for (let s = 0; ; s = Math.min(t, s + stepS)) {
    const elevationDeg = solarPosition(startUtcMs + s * 1000, site).elevationDeg;
    sun.push({ elapsedS: s, elevationDeg });
    if (sunBelowAtS === null && elevationDeg < minSunElevationDeg) {
      // Refine the crossing to the minute between the previous sample and this one.
      let c = s;
      for (let m = Math.max(0, s - stepS); m < s; m += 60) {
        if (solarPosition(startUtcMs + m * 1000, site).elevationDeg < minSunElevationDeg) {
          c = m;
          break;
        }
      }
      sunBelowAtS = c;
    }
    if (s >= t) break;
  }

  let daylightMarginS: number | null = null;
  const endMs = startUtcMs + t * 1000;
  if (solarPosition(endMs, site).elevationDeg >= minSunElevationDeg) {
    // Scan forward (1 min) for the moment the Sun drops below the threshold, up to one sol.
    for (let m = 1; m <= 25 * 60; m++) {
      if (solarPosition(endMs + m * 60_000, site).elevationDeg < minSunElevationDeg) {
        daylightMarginS = m * 60;
        break;
      }
    }
  }

  return {
    startUtcMs,
    endUtcMs: endMs,
    walkS,
    dwellS,
    totalS: t,
    events,
    segments,
    sun,
    minSunElevationDeg,
    sunBelowAtS,
    daylightMarginS,
    walkbackMarginS: route.metrics.walkback.worstMarginS - dwellS,
  };
}
