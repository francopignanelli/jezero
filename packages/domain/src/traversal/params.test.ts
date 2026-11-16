import { describe, expect, it } from 'vitest';
import { cellLatLon } from '../raster/grid';
import { planRoute } from '../routing/planner';
import { prepareTerrain } from '../routing/terrain';
import { elevationFrom, syntheticSpec } from '../testing/synthetic';
import { DEFAULT_EVA_PARAMS, SLOPE_SCENARIOS_DEG, fingerprint, withMaxSlope } from './params';

describe('slope-limit scenarios', () => {
  it('change only the maximum slope, with the steepest band reaching up to it', () => {
    const p25 = withMaxSlope(DEFAULT_EVA_PARAMS, 25);
    expect(p25.maxSlopeDeg).toBe(25);
    expect(p25.slopeBands.at(-1)!.upToDeg).toBe(25);
    expect(p25.slopeBands.slice(0, -1)).toEqual(DEFAULT_EVA_PARAMS.slopeBands.slice(0, -1));
    // A lower limit keeps the bands (slopes above it are blocked anyway).
    expect(withMaxSlope(DEFAULT_EVA_PARAMS, 15).slopeBands).toEqual(DEFAULT_EVA_PARAMS.slopeBands);
    expect(fingerprint(p25)).not.toBe(fingerprint(DEFAULT_EVA_PARAMS));
    expect(SLOPE_SCENARIOS_DEG).toEqual([15, 25]);
  });

  it('a ridge of 18° across the way: no route at 15°, a route at 20° and 25°', () => {
    // A north–south ridge rising at 18° on both sides blocks the whole width of the grid.
    const spec = syntheticSpec(60, 40);
    const k = Math.tan((18 * Math.PI) / 180);
    const layers = {
      spec,
      elevation: elevationFrom(spec, (east) => -2570 + Math.max(0, 40 - Math.abs(east)) * k),
    };
    const req = {
      waypoints: [cellLatLon(spec, 3, 20), cellLatLon(spec, 56, 20)],
      profile: 'lower-risk' as const,
    };
    const at = (deg: number) =>
      planRoute(prepareTerrain(layers, withMaxSlope(DEFAULT_EVA_PARAMS, deg)), req);
    expect(at(15).status).toBe('no-route');
    expect(at(20).status).toBe('ok');
    const r25 = at(25);
    expect(r25.status).toBe('ok');
    expect(r25.metrics!.maxTerrainSlopeDeg).toBeGreaterThan(15);
    expect(r25.metrics!.maxTerrainSlopeDeg).toBeLessThan(20);
  });
});
