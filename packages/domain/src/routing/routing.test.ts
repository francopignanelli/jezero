import { describe, expect, it } from 'vitest';
import { cellLatLon, type GridSpec } from '../raster/grid';
import { greatCircleDistance } from '../geo/sphere';
import { elevationFrom, syntheticSpec } from '../testing/synthetic';
import { DEFAULT_EVA_PARAMS, type EvaParams } from '../traversal/params';
import { findPath } from './astar';
import { planAlternatives, planRoute, type RouteRequest } from './planner';
import { pathToPoints, segmentIsTraversable } from './polyline';
import { BLOCK, prepareTerrain, type TerrainLayers } from './terrain';

const d = Math.PI / 180;

function at(spec: GridSpec, col: number, row: number): { lat: number; lon: number } {
  return cellLatLon(spec, col, row);
}

function flatLayers(cols: number, rows: number): TerrainLayers {
  const spec = syntheticSpec(cols, rows);
  return { spec, elevation: elevationFrom(spec, () => -2570) };
}

function withExcluded(layers: TerrainLayers, cells: Array<[number, number]>): TerrainLayers {
  const excluded = new Uint8Array(layers.spec.cols * layers.spec.rows);
  for (const [c, r] of cells) excluded[r * layers.spec.cols + c] = 1;
  return { ...layers, excluded };
}

function plan(layers: TerrainLayers, req: RouteRequest, params: EvaParams = DEFAULT_EVA_PARAMS) {
  return planRoute(prepareTerrain(layers, params), req);
}

describe('route planning on flat terrain', () => {
  const layers = flatLayers(60, 60);

  it('follows a straight line and measures its length to < 0.5 %', () => {
    const a = at(layers.spec, 5, 30);
    const b = at(layers.spec, 54, 30);
    const r = plan(layers, { waypoints: [a, b], profile: 'lower-risk' });
    expect(r.status).toBe('ok');
    expect(r.points).toHaveLength(2);
    const truth = greatCircleDistance(a, b);
    expect(Math.abs(r.metrics!.horizontalDistanceM - truth) / truth).toBeLessThan(0.005);
    expect(r.metrics!.elevationGainM).toBe(0);
    expect(r.metrics!.maxTerrainSlopeDeg).toBe(0);
  });

  it('smooths an oblique grid path to within 0.5 % of the great-circle distance', () => {
    const a = at(layers.spec, 4, 6);
    const b = at(layers.spec, 51, 40);
    const r = plan(layers, { waypoints: [a, b], profile: 'shortest' });
    const truth = greatCircleDistance(a, b);
    expect(r.status).toBe('ok');
    expect(Math.abs(r.metrics!.horizontalDistanceM - truth) / truth).toBeLessThan(0.005);
  });

  it('estimates duration from the documented speed model and timeline factor', () => {
    const a = at(layers.spec, 5, 30);
    const b = at(layers.spec, 54, 30);
    const r = plan(layers, { waypoints: [a, b], profile: 'lower-risk' });
    const m = r.metrics!;
    const expected = (DEFAULT_EVA_PARAMS.timelineFactor * m.distance3dM) / (2 / 3.6);
    expect(m.estimatedDurationS).toBeCloseTo(expected, 6);
    expect(m.durationByModelS['apollo-walkback-constant']).toBeLessThan(m.estimatedDurationS);
  });

  it('is deterministic', () => {
    const a = at(layers.spec, 3, 3);
    const b = at(layers.spec, 55, 50);
    const r1 = plan(layers, { waypoints: [a, b], profile: 'lower-risk' });
    const r2 = plan(layers, { waypoints: [a, b], profile: 'lower-risk' });
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });
});

describe('hard constraints', () => {
  it('detours around a slope barrier and reports the slope limit', () => {
    const spec = syntheticSpec(60, 60);
    // A 30° ridge centred on column 30 for rows 0–44; flat plain on both sides and in rows ≥ 45.
    const elevation = elevationFrom(spec, (_e, _n, c, r) =>
      r >= 45 ? 0 : Math.max(0, 4 - Math.abs(c - 30)) * 5 * Math.tan(30 * d),
    );
    const t = prepareTerrain({ spec, elevation }, DEFAULT_EVA_PARAMS);
    const a = at(spec, 10, 10);
    const b = at(spec, 50, 10);
    const r = planRoute(t, { waypoints: [a, b], profile: 'lower-risk' });
    expect(r.status).toBe('ok');
    expect(r.metrics!.maxTerrainSlopeDeg).toBeLessThanOrEqual(DEFAULT_EVA_PARAMS.maxSlopeDeg);
    expect(r.metrics!.horizontalDistanceM).toBeGreaterThan(1.5 * greatCircleDistance(a, b));
  });

  it('returns a no-route result naming a nodata barrier', () => {
    const spec = syntheticSpec(40, 40);
    const elevation = elevationFrom(spec, (_e, _n, c) => (c >= 18 && c <= 21 ? Number.NaN : -2570));
    const r = plan(
      { spec, elevation },
      { waypoints: [at(spec, 5, 20), at(spec, 35, 20)], profile: 'lower-risk' },
    );
    expect(r.status).toBe('no-route');
    expect(r.explanation[0]).toMatchObject({
      code: 'DISCONNECTED',
      barrier: 'nodata',
      legIndex: 0,
    });
  });

  it('returns a no-route result naming a slope barrier', () => {
    const spec = syntheticSpec(40, 40);
    const elevation = elevationFrom(
      spec,
      (_e, _n, c) => Math.min(Math.max(c - 18, 0), 4) * 5 * Math.tan(35 * d),
    );
    const r = plan(
      { spec, elevation },
      { waypoints: [at(spec, 5, 20), at(spec, 35, 20)], profile: 'shortest' },
    );
    expect(r.status).toBe('no-route');
    expect(r.explanation[0]).toMatchObject({ code: 'DISCONNECTED', barrier: 'slope' });
  });

  it('passes through a one-cell gap in an excluded wall', () => {
    const layers = flatLayers(30, 30);
    const wall: Array<[number, number]> = [];
    for (let r = 0; r < 30; r++) if (r !== 17) wall.push([15, r]);
    const r = plan(withExcluded(layers, wall), {
      waypoints: [at(layers.spec, 3, 5), at(layers.spec, 27, 5)],
      profile: 'shortest',
    });
    expect(r.status).toBe('ok');
  });

  it('never cuts a corner between two diagonally touching blocked cells', () => {
    const layers = flatLayers(30, 30);
    // Staircase wall: blocked cells touch only at corners, so a diagonal step would squeeze through.
    const wall: Array<[number, number]> = [];
    for (let i = 0; i < 30; i++) wall.push([i, 29 - i]);
    const blocked = withExcluded(layers, wall);
    const t = prepareTerrain(blocked, DEFAULT_EVA_PARAMS);
    const start = 2 * 30 + 2;
    const goal = 27 * 30 + 27;
    expect(findPath(t, 'shortest', start, goal).path).toBeNull();
    const r = planRoute(t, {
      waypoints: [at(layers.spec, 2, 2), at(layers.spec, 27, 27)],
      profile: 'shortest',
    });
    expect(r.status).toBe('no-route');
  });

  it('rejects waypoints outside coverage or on blocked cells', () => {
    const layers = withExcluded(flatLayers(20, 20), [[10, 10]]);
    const inside = at(layers.spec, 2, 2);
    const outside = { lat: 0, lon: 0 };
    expect(
      plan(layers, { waypoints: [inside, outside], profile: 'shortest' }).explanation[0],
    ).toMatchObject({
      code: 'OUTSIDE_COVERAGE',
      waypointIndex: 1,
    });
    expect(
      plan(layers, { waypoints: [inside, at(layers.spec, 10, 10)], profile: 'shortest' })
        .explanation[0],
    ).toMatchObject({ code: 'WAYPOINT_NOT_TRAVERSABLE', reason: 'excluded' });
  });

  it('never lets smoothing cross a blocked cell', () => {
    const layers = flatLayers(40, 40);
    const wall: Array<[number, number]> = [];
    for (let r = 5; r < 40; r++) wall.push([20, r]);
    const blocked = withExcluded(layers, wall);
    const t = prepareTerrain(blocked, DEFAULT_EVA_PARAMS);
    const r = planRoute(t, {
      waypoints: [at(layers.spec, 5, 35), at(layers.spec, 35, 35)],
      profile: 'shortest',
    });
    expect(r.status).toBe('ok');
    const spec = layers.spec;
    const xy = r.points.map((p) => {
      const cell = { x: 0, y: 0 };
      const e = (p.lon * Math.PI) / 180;
      cell.x = spec.projection.radiusM * e * Math.cos((spec.projection.latTsDeg * Math.PI) / 180);
      cell.y = (spec.projection.radiusM * p.lat * Math.PI) / 180;
      return cell;
    });
    for (let i = 1; i < xy.length; i++)
      expect(segmentIsTraversable(t, xy[i - 1]!, xy[i]!)).toBe(true);
    expect(t.block[20 * 40 + 20]).toBe(BLOCK.excluded);
  });
});

describe('profiles, explanations and EVA checks', () => {
  // A 14° cone (moderate band) sits on the straight line between the waypoints.
  const spec = syntheticSpec(80, 60);
  const elevation = elevationFrom(
    spec,
    (e, n) => Math.max(0, 60 - Math.hypot(e, n)) * Math.tan(14 * d),
  );
  const t = prepareTerrain({ spec, elevation }, DEFAULT_EVA_PARAMS);
  const req = { waypoints: [at(spec, 8, 30), at(spec, 71, 30)] };

  it('lower-risk route detours around moderate slopes that the shortest route crosses', () => {
    const cmp = planAlternatives(t, req);
    expect(cmp.lowerRisk.status).toBe('ok');
    expect(cmp.shortest.status).toBe('ok');
    const lr = cmp.lowerRisk.metrics!;
    const sh = cmp.shortest.metrics!;
    expect(sh.bandDistanceM.moderate).toBeGreaterThan(50);
    expect(lr.bandDistanceM.moderate).toBeLessThan(sh.bandDistanceM.moderate);
    expect(lr.horizontalDistanceM).toBeGreaterThanOrEqual(sh.horizontalDistanceM);
    expect(cmp.comparison?.code).toBe('DETOUR_AVOIDS_STEEP_TERRAIN');
  });

  it('flags walkback violations with a tightened EVA cap', () => {
    const tight = prepareTerrain({ spec, elevation }, { ...DEFAULT_EVA_PARAMS, evaCapHours: 0.6 });
    const r = planRoute(tight, { ...req, profile: 'lower-risk', returnToStart: true });
    expect(r.status).toBe('ok');
    expect(r.metrics!.walkback.ok).toBe(false);
    expect(r.explanation.some((e) => e.code === 'WALKBACK_EXCEEDED')).toBe(true);
    expect(r.legStarts).toHaveLength(2);
  });

  it('on a loop, walk-back uses the quicker way home (never re-walks the whole loop at the end)', () => {
    // Cap just above the loop duration + ingress: must pass. Backtracking the full loop from the end
    // (the old behaviour) would need twice the loop time and fail.
    const loop = planRoute(t, { ...req, profile: 'shortest', returnToStart: true });
    const loopH = loop.metrics!.estimatedDurationS / 3600;
    const params = {
      ...DEFAULT_EVA_PARAMS,
      evaCapHours: loopH + DEFAULT_EVA_PARAMS.ingressHours + 0.01,
    };
    const r = planRoute(prepareTerrain({ spec, elevation }, params), {
      ...req,
      profile: 'shortest',
      returnToStart: true,
    });
    expect(r.metrics!.walkback.ok).toBe(true);
    expect(r.metrics!.walkback.worstMarginS).toBeGreaterThanOrEqual(0);
  });

  it('elevation gain equals loss on a round trip', () => {
    const r = planRoute(t, { ...req, profile: 'shortest', returnToStart: true });
    expect(r.metrics!.elevationGainM).toBeCloseTo(r.metrics!.elevationLossM, 6);
  });

  it('keeps grid path points at cell centres before smoothing', () => {
    const search = findPath(t, 'shortest', 30 * 80 + 8, 30 * 80 + 71);
    const pts = pathToPoints(spec, search.path!);
    expect(pts[0]!.x).toBeCloseTo(spec.originX + 8.5 * spec.cellSize, 6);
  });
});
