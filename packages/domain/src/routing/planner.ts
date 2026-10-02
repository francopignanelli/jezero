import { eqcForward, eqcInverse, type XY } from '../geo/equirectangular';
import { cellLatLon, locateCell, sampleBilinear } from '../raster/grid';
import { EVA_PARAMS_ID, fingerprint } from '../traversal/params';
import { findPath } from './astar';
import type { RouteProfile } from './cost';
import { explainComparison, explainMetrics, type ExplanationCode } from './explain';
import { computeMetrics, type RouteMetrics } from './metrics';
import { pathToPoints, smoothPath } from './polyline';
import { diagnoseDisconnection } from './reachability';
import { roundCorners } from './display';
import { BLOCK, type PreparedTerrain } from './terrain';

/** Bumped whenever routing behaviour changes; stored with every saved mission. */
export const ROUTING_ALGORITHM_VERSION = 'route@0.1.0';

export interface Waypoint {
  /** Planetocentric latitude (deg). */
  lat: number;
  /** East-positive longitude (deg). */
  lon: number;
}

export interface RouteRequest {
  waypoints: readonly Waypoint[];
  profile: RouteProfile;
  /** Append a return leg to the first waypoint (typical habitat → sites → habitat Marswalk). */
  returnToStart?: boolean;
}

export interface RoutePoint {
  lat: number;
  lon: number;
  elevationM: number;
}

export interface LegSummary {
  fromWaypoint: number;
  toWaypoint: number;
  horizontalDistanceM: number;
  elevationGainM: number;
  elevationLossM: number;
  maxTerrainSlopeDeg: number;
  estimatedDurationS: number;
}

export interface RouteResult {
  status: 'ok' | 'no-route';
  profile: RouteProfile;
  points: RoutePoint[];
  /**
   * Drawing geometry: `points` with corners rounded where the curve stays on traversable cells
   * (waypoints stay exact). Metrics always come from `points`.
   */
  displayPoints?: RoutePoint[];
  /** Index into `points` where each leg starts. */
  legStarts: number[];
  legs: LegSummary[];
  metrics: RouteMetrics | null;
  explanation: ExplanationCode[];
  algorithmVersion: string;
  parameterSet: string;
  expandedNodes: number;
}

export function planRoute(t: PreparedTerrain, request: RouteRequest): RouteResult {
  const spec = t.layers.spec;
  const base = {
    profile: request.profile,
    algorithmVersion: ROUTING_ALGORITHM_VERSION,
    parameterSet: `${EVA_PARAMS_ID}#${fingerprint(t.params)}`,
  };
  const failure = (explanation: ExplanationCode[], expandedNodes: number): RouteResult => ({
    ...base,
    status: 'no-route',
    points: [],
    legStarts: [],
    legs: [],
    metrics: null,
    explanation,
    expandedNodes,
  });

  const waypoints = [...request.waypoints];
  if (waypoints.length < 2) throw new Error('A route needs at least two waypoints');
  if (request.returnToStart) waypoints.push(waypoints[0]!);

  const cells: number[] = [];
  for (const [i, w] of waypoints.entries()) {
    const cell = locateCell(spec, w.lat, w.lon);
    const idx = cell ? cell.row * spec.cols + cell.col : -1;
    if (idx < 0 || t.block[idx] === BLOCK.nodata) {
      return failure([{ code: 'OUTSIDE_COVERAGE', waypointIndex: i }], 0);
    }
    if (t.block[idx] !== BLOCK.none) {
      const reason = t.block[idx] === BLOCK.slope ? 'slope' : 'excluded';
      return failure([{ code: 'WAYPOINT_NOT_TRAVERSABLE', waypointIndex: i, reason }], 0);
    }
    cells.push(idx);
  }

  const points: XY[] = [];
  const legStarts: number[] = [];
  const legs: LegSummary[] = [];
  let expanded = 0;
  for (let leg = 0; leg < cells.length - 1; leg++) {
    const from = cells[leg]!;
    const to = cells[leg + 1]!;
    const search = findPath(t, request.profile, from, to);
    expanded += search.expandedNodes;
    if (!search.path) {
      const d = diagnoseDisconnection(t, from, to);
      const near = cellLatLon(
        spec,
        d.nearestReachable % spec.cols,
        (d.nearestReachable / spec.cols) | 0,
      );
      return failure(
        [
          {
            code: 'DISCONNECTED',
            legIndex: leg,
            barrier: d.barrier,
            nearestReachable: near,
            gapM: d.gapM,
          },
        ],
        expanded,
      );
    }
    const raw = pathToPoints(spec, search.path);
    // Use the exact waypoint positions; they lie inside the first/last traversable cells.
    raw[0] = eqcForward(spec.projection, waypoints[leg]!.lat, waypoints[leg]!.lon);
    raw[raw.length - 1] = eqcForward(
      spec.projection,
      waypoints[leg + 1]!.lat,
      waypoints[leg + 1]!.lon,
    );
    const smooth = smoothPath(t, request.profile, raw);
    legStarts.push(points.length === 0 ? 0 : points.length - 1);
    points.push(...(points.length === 0 ? smooth : smooth.slice(1)));
    const lm = computeMetrics(t, smooth);
    legs.push({
      fromWaypoint: leg,
      toWaypoint: leg + 1,
      horizontalDistanceM: lm.horizontalDistanceM,
      elevationGainM: lm.elevationGainM,
      elevationLossM: lm.elevationLossM,
      maxTerrainSlopeDeg: lm.maxTerrainSlopeDeg,
      estimatedDurationS: lm.estimatedDurationS,
    });
  }

  const metrics = computeMetrics(t, points);
  const toRoutePoint = (p: XY): RoutePoint => {
    const ll = eqcInverse(spec.projection, p.x, p.y);
    return { lat: ll.lat, lon: ll.lon, elevationM: sampleBilinear(spec, t.layers.elevation, p) };
  };
  return {
    ...base,
    status: 'ok',
    points: points.map(toRoutePoint),
    displayPoints: roundCorners(t, points, 14, 5, new Set(legStarts)).map(toRoutePoint),
    legStarts,
    legs,
    metrics,
    explanation: explainMetrics(metrics, t.params),
    expandedNodes: expanded,
  };
}

export interface RouteComparison {
  lowerRisk: RouteResult;
  shortest: RouteResult;
  /** Present when both routes exist. */
  comparison: ExplanationCode | null;
}

/** Computes the lower-risk and shortest-feasible alternatives for the same waypoints. */
export function planAlternatives(
  t: PreparedTerrain,
  request: Omit<RouteRequest, 'profile'>,
): RouteComparison {
  const lowerRisk = planRoute(t, { ...request, profile: 'lower-risk' });
  const shortest = planRoute(t, { ...request, profile: 'shortest' });
  const comparison =
    lowerRisk.metrics && shortest.metrics
      ? explainComparison(lowerRisk.metrics, shortest.metrics)
      : null;
  return { lowerRisk, shortest, comparison };
}
