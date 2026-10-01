import { describe, expect, it } from 'vitest';
import { elevationFrom, syntheticSpec } from '../testing/synthetic';
import { DEFAULT_EVA_PARAMS } from '../traversal/params';
import { stepTimeS } from '../traversal/speed';
import { roundTripTimes, travelTimes } from './isochrone';
import { prepareTerrain } from './terrain';

const p = DEFAULT_EVA_PARAMS;
const levelTime = (m: number) => stepTimeS('copernico-default', m, 0, p);

describe('travel-time isochrones', () => {
  it('matches the level-ground walking time along a grid axis and is symmetric on flat ground', () => {
    const spec = syntheticSpec(61, 61);
    const t = prepareTerrain({ spec, elevation: elevationFrom(spec, () => -2570) }, p);
    const start = 30 * 61 + 30;
    const rt = roundTripTimes(t, start, 1e9);
    const east20 = 30 * 61 + 50; // 20 cells × 5 m east (cell width shrinks ~0 at this latitude span)
    const expected = 2 * levelTime(20 * t.rowWidthM[30]!);
    expect(rt[east20]!).toBeCloseTo(expected, 0);
    expect(rt[start]).toBe(0);
  });

  it('prices the slope on both legs and sums them for the round trip', () => {
    // 10 % slope rising to the east.
    const spec = syntheticSpec(41, 41);
    const t = prepareTerrain(
      { spec, elevation: elevationFrom(spec, (east) => -2500 + 0.1 * east) },
      p,
    );
    const start = 20 * 41 + 5;
    const target = 20 * 41 + 35;
    const out = travelTimes(t, start, 1e9, 'out')[target]!; // uphill
    const back = travelTimes(t, start, 1e9, 'back')[target]!; // downhill to the start
    // The default speed model depends on |grade| (lunar-derived, symmetric), so both legs cost the
    // same here, and more than the same distance on level ground.
    expect(out).toBeCloseTo(back, 3);
    expect(out).toBeGreaterThan(levelTime(30 * t.rowWidthM[20]!));
    expect(roundTripTimes(t, start, 1e9)[target]!).toBeCloseTo(out + back, 3);
  });

  it('stops at blocked terrain and at the time budget', () => {
    const spec = syntheticSpec(41, 41);
    const excluded = new Uint8Array(41 * 41);
    for (let r = 0; r < 41; r++) excluded[r * 41 + 20] = 1; // a wall down column 20
    const t = prepareTerrain({ spec, elevation: elevationFrom(spec, () => -2570), excluded }, p);
    const start = 20 * 41 + 5;
    const rt = roundTripTimes(t, start, 1e9);
    expect(rt[20 * 41 + 30]).toBe(Number.POSITIVE_INFINITY); // behind the wall
    const budget = 2 * levelTime(50); // ~10 cells each way
    const limited = roundTripTimes(t, start, budget);
    expect(limited[20 * 41 + 13]).toBeLessThanOrEqual(budget);
    expect(limited[20 * 41 + 18]).toBe(Number.POSITIVE_INFINITY);
  });
});
