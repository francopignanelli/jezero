import { describe, expect, it } from 'vitest';
import { cellLatLon } from '../raster/grid';
import { elevationFrom, syntheticSpec } from '../testing/synthetic';
import { DEFAULT_EVA_PARAMS } from '../traversal/params';
import { detourCost, inspectPoint } from './inspect';
import { planRoute } from './planner';
import { prepareTerrain } from './terrain';

describe('point inspection', () => {
  // A plane rising 0.2 m per metre to the east: slope atan(0.2) = 11.31°.
  const spec = syntheticSpec(40, 40);
  const t = prepareTerrain(
    {
      spec,
      elevation: elevationFrom(spec, (east) => -2500 + 0.2 * east),
      thermalInertia: new Float32Array(1600).fill(320),
    },
    DEFAULT_EVA_PARAMS,
  );

  it('reports the planner values for a cell inside coverage', () => {
    const p = cellLatLon(spec, 20, 20);
    const r = inspectPoint(t, p.lat, p.lon);
    expect(r.inCoverage).toBe(true);
    expect(r.slopeDeg).toBeCloseTo(11.31, 1);
    expect(r.band).toBe('moderate');
    expect(r.blocked).toBe('none');
    expect(r.thermalInertia).toBe(320);
    expect(r.elevationM).toBeCloseTo(-2500 + 0.2 * 2.5, 0); // cell 20 centre is 2.5 m east of the grid centre
  });

  it('reports outside coverage', () => {
    const r = inspectPoint(t, 0, 0);
    expect(r.inCoverage).toBe(false);
    expect(r.thermalInertia).toBeNull();
  });
});

describe('detour cost', () => {
  const spec = syntheticSpec(80, 80);
  const t = prepareTerrain(
    { spec, elevation: elevationFrom(spec, () => -2570) },
    DEFAULT_EVA_PARAMS,
  );
  const a = cellLatLon(spec, 10, 40);
  const b = cellLatLon(spec, 70, 40);
  const stop = cellLatLon(spec, 40, 20);

  it('equals the route with the stop minus the route without it', () => {
    const d = detourCost(t, 'lower-risk', a, b, stop);
    const base = planRoute(t, { waypoints: [a, b], profile: 'lower-risk' }).metrics!;
    const via = planRoute(t, { waypoints: [a, stop, b], profile: 'lower-risk' }).metrics!;
    expect(d.status).toBe('ok');
    expect(d.extraDistanceM).toBeCloseTo(via.horizontalDistanceM - base.horizontalDistanceM, 6);
    expect(d.extraDurationS).toBeCloseTo(via.estimatedDurationS - base.estimatedDurationS, 6);
    // Flat ground: the detour is the triangle excess, 2·√(150² + 100²) − 300 m.
    expect(d.extraDistanceM).toBeCloseTo(2 * Math.hypot(150, 100) - 300, -1);
  });

  it('is zero for a stop on the straight path', () => {
    const d = detourCost(t, 'lower-risk', a, b, cellLatLon(spec, 40, 40));
    expect(Math.abs(d.extraDistanceM)).toBeLessThan(1);
  });

  it('reports no-route for a stop outside coverage', () => {
    expect(detourCost(t, 'lower-risk', a, b, { lat: 0, lon: 0 }).status).toBe('no-route');
  });
});
