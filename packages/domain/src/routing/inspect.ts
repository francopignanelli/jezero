import { eqcForward } from '../geo/equirectangular';
import { locateCell, sampleBilinear } from '../raster/grid';
import type { SlopeBandKey } from '../traversal/params';
import type { RouteProfile } from './cost';
import { planRoute, type Waypoint } from './planner';
import { BLOCK, bandFor, type PreparedTerrain } from './terrain';

export type BlockKind = 'none' | 'nodata' | 'excluded' | 'slope';
const BLOCK_KIND: Record<number, BlockKind> = {
  [BLOCK.none]: 'none',
  [BLOCK.nodata]: 'nodata',
  [BLOCK.excluded]: 'excluded',
  [BLOCK.slope]: 'slope',
};

/** Everything the planner knows about one location (the point inspector shows this). */
export interface PointInspection {
  inCoverage: boolean;
  /** Height above the MOLA areoid (m), bilinear on the 5 m grid. */
  elevationM: number;
  /** Constraint slope of the cell (deg): the value the planner uses. */
  slopeDeg: number;
  /** Slope band, or 'beyond' when steeper than the hard limit. */
  band: SlopeBandKey | 'beyond' | null;
  blocked: BlockKind;
  /** THEMIS-derived thermal inertia (J m⁻² K⁻¹ s⁻½), null if unknown. */
  thermalInertia: number | null;
  rough: boolean;
  lowThermalInertia: boolean;
}

export function inspectPoint(t: PreparedTerrain, lat: number, lon: number): PointInspection {
  const { spec } = t.layers;
  const cell = locateCell(spec, lat, lon);
  if (!cell) {
    return {
      inCoverage: false,
      elevationM: Number.NaN,
      slopeDeg: Number.NaN,
      band: null,
      blocked: 'nodata',
      thermalInertia: null,
      rough: false,
      lowThermalInertia: false,
    };
  }
  const k = cell.row * spec.cols + cell.col;
  const blocked = BLOCK_KIND[t.block[k]!] ?? 'nodata';
  const slope = t.constraintSlopeDeg[k]!;
  const ti = t.layers.thermalInertia?.[k];
  return {
    inCoverage: blocked !== 'nodata',
    elevationM: sampleBilinear(spec, t.layers.elevation, eqcForward(spec.projection, lat, lon)),
    slopeDeg: slope,
    band: Number.isFinite(slope) ? (bandFor(slope, t.params) ?? 'beyond') : null,
    blocked,
    thermalInertia: ti !== undefined && Number.isFinite(ti) ? ti : null,
    rough: t.rough[k] === 1,
    lowThermalInertia: t.lowThermalInertia[k] === 1,
  };
}

/** Extra cost of visiting `stop` between two consecutive waypoints, with the same planner. */
export interface DetourCost {
  status: 'ok' | 'no-route';
  extraDistanceM: number;
  extraDurationS: number;
  /** Steepest terrain on the detoured leg (deg). */
  maxTerrainSlopeDeg: number;
}

export function detourCost(
  t: PreparedTerrain,
  profile: RouteProfile,
  from: Waypoint,
  to: Waypoint,
  stop: Waypoint,
): DetourCost {
  const base = planRoute(t, { waypoints: [from, to], profile });
  const via = planRoute(t, { waypoints: [from, stop, to], profile });
  if (base.status !== 'ok' || via.status !== 'ok' || !base.metrics || !via.metrics) {
    return {
      status: 'no-route',
      extraDistanceM: Number.NaN,
      extraDurationS: Number.NaN,
      maxTerrainSlopeDeg: Number.NaN,
    };
  }
  return {
    status: 'ok',
    extraDistanceM: via.metrics.horizontalDistanceM - base.metrics.horizontalDistanceM,
    extraDurationS: via.metrics.estimatedDurationS - base.metrics.estimatedDurationS,
    maxTerrainSlopeDeg: via.metrics.maxTerrainSlopeDeg,
  };
}
