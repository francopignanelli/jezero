import { describe, expect, it } from 'vitest';
import { nextLocalTrueSolarTime, solarPosition } from '../time/sun';
import type { RouteResult } from './planner';
import { buildTimeline } from './timeline';

const JEZERO = { lat: 18.44, lon: 77.45 };
const leg = (from: number, to: number, durationS: number) => ({
  fromWaypoint: from,
  toWaypoint: to,
  horizontalDistanceM: durationS,
  elevationGainM: 0,
  elevationLossM: 0,
  maxTerrainSlopeDeg: 0,
  estimatedDurationS: durationS,
});
// Round trip: start(0) → 1 → 2 → back to 0 (the planner numbers the return leg's end as 3).
const route = {
  status: 'ok',
  points: [],
  legStarts: [],
  legs: [leg(0, 1, 3600), leg(1, 2, 1800), leg(2, 3, 3600)],
  metrics: { walkback: { ok: true, worstMarginS: 18_000, firstViolationAtM: null } },
} as unknown as RouteResult;
const tenAm = nextLocalTrueSolarTime(Date.UTC(2026, 9, 1), JEZERO, 10);

describe('EVA timeline', () => {
  it('adds stop time after each intermediate arrival and none at the end', () => {
    const tl = buildTimeline(route, [0, 20, 30], true, tenAm, JEZERO)!;
    const at = tl.events.map((e) => [e.kind, e.waypointIndex, e.elapsedS]);
    expect(at).toEqual([
      ['depart', 0, 0],
      ['arrive', 1, 3600],
      ['leave', 1, 4800],
      ['arrive', 2, 6600],
      ['leave', 2, 8400],
      ['end', 0, 12_000],
    ]);
    expect(tl.walkS).toBe(9000);
    expect(tl.dwellS).toBe(3000);
    expect(tl.endUtcMs - tl.startUtcMs).toBe(12_000_000);
  });

  it('lowers the walk-back margin by the total stop time (conservative bound)', () => {
    expect(buildTimeline(route, [0, 20, 30], true, tenAm, JEZERO)!.walkbackMarginS).toBe(
      18_000 - 3000,
    );
  });

  it('passes a morning EVA and flags one that runs past the daylight threshold', () => {
    const morning = buildTimeline(route, [0, 20, 30], true, tenAm, JEZERO)!;
    expect(morning.sunBelowAtS).toBeNull();
    expect(morning.daylightMarginS).toBeGreaterThan(0);
    // Sun elevation samples match the calculated solar position.
    const s = morning.sun[3]!;
    expect(s.elevationDeg).toBeCloseTo(
      solarPosition(tenAm + s.elapsedS * 1000, JEZERO).elevationDeg,
      9,
    );

    const late = nextLocalTrueSolarTime(Date.UTC(2026, 9, 1), JEZERO, 15.5);
    const evening = buildTimeline(route, [0, 20, 30], true, late, JEZERO)!;
    expect(evening.sunBelowAtS).not.toBeNull();
    expect(evening.daylightMarginS).toBeNull();
  });
});

describe('EVA timeline daylight crossing', () => {
  it('reports the first minute below the threshold, not the sample step', () => {
    const late = nextLocalTrueSolarTime(Date.UTC(2026, 9, 1), JEZERO, 15.5);
    const tl = buildTimeline(route, [0, 20, 30], true, late, JEZERO)!;
    const at = tl.sunBelowAtS!;
    expect(solarPosition(late + at * 1000, JEZERO).elevationDeg).toBeLessThan(10);
    expect(solarPosition(late + (at - 60) * 1000, JEZERO).elevationDeg).toBeGreaterThanOrEqual(10);
  });
});
