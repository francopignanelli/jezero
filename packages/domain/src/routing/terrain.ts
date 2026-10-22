import { cellHeightM, rowWidths, type GridSpec } from '../raster/grid';
import { hornGradient, slopeDegrees, type Gradient } from '../terrain/slope';
import type { EvaParams, SlopeBandKey } from '../traversal/params';

/** Scientific raster layers of an operational region, all on the same grid. */
export interface TerrainLayers {
  spec: GridSpec;
  /** Height above the MOLA areoid (m). NaN = nodata / outside coverage. */
  elevation: Float32Array;
  /** Per-cell median and P90 of the fine-scale (2 m baseline) slope (deg). NaN = unknown. */
  fineSlopeMedianDeg?: Float32Array;
  fineSlopeP90Deg?: Float32Array;
  /** THEMIS-derived thermal inertia (J m⁻² K⁻¹ s⁻½), resampled from 100 m. NaN = unknown. */
  thermalInertia?: Float32Array;
  /** Manual QA exclusion mask (1 = excluded), e.g. DTM areas with documented artifacts. */
  excluded?: Uint8Array;
}

/** Why a cell cannot be walked. Order matters: the first applicable reason is recorded. */
export const BLOCK = { none: 0, nodata: 1, excluded: 2, slope: 3 } as const;
export type BlockReason = (typeof BLOCK)[keyof typeof BLOCK];

/** The 8 grid neighbours (dc, dr): straight steps first, then diagonals. */
export const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/**
 * Index of the cell one step (dc, dr) from (col, row), or -1 when the step leaves the grid, lands on
 * a blocked cell, or cuts diagonally past a blocked corner. The planner and the reachability search
 * share it, so both apply exactly the same hard constraints.
 */
export function stepTarget(
  t: PreparedTerrain,
  cols: number,
  rows: number,
  col: number,
  row: number,
  dc: number,
  dr: number,
): number {
  const nc = col + dc;
  const nr = row + dr;
  if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) return -1;
  const next = nr * cols + nc;
  if (t.block[next] !== BLOCK.none) return -1;
  if (dc !== 0 && dr !== 0) {
    if (t.block[row * cols + nc] !== BLOCK.none || t.block[nr * cols + col] !== BLOCK.none)
      return -1;
  }
  return next;
}

export interface PreparedTerrain {
  layers: TerrainLayers;
  params: EvaParams;
  gradient: Gradient;
  /** Horn slope on the routing grid (baseline 2 cells), deg. */
  slopeDeg: Float32Array;
  /** Slope used for constraints and bands: max(slopeDeg, fine-scale median), deg. */
  constraintSlopeDeg: Float32Array;
  block: Uint8Array;
  /** Per-cell additive risk penalty: slope band + rough terrain + low thermal inertia. */
  staticPenalty: Float32Array;
  rough: Uint8Array;
  lowThermalInertia: Uint8Array;
  rowWidthM: Float64Array;
  cellHeightM: number;
  minCellWidthM: number;
}

export function bandFor(slopeDeg: number, p: EvaParams): SlopeBandKey | null {
  for (const band of p.slopeBands) if (slopeDeg <= band.upToDeg) return band.key;
  return null;
}

function bandPenalty(slopeDeg: number, p: EvaParams): number {
  for (const band of p.slopeBands) if (slopeDeg <= band.upToDeg) return band.penalty;
  return Number.POSITIVE_INFINITY;
}

/** Derives slopes, hard-constraint blocks and static penalties. Deterministic and allocation-bounded. */
export function prepareTerrain(layers: TerrainLayers, params: EvaParams): PreparedTerrain {
  const { spec, elevation } = layers;
  const n = spec.cols * spec.rows;
  if (elevation.length !== n) throw new Error(`elevation length ${elevation.length} ≠ ${n}`);

  const gradient = hornGradient(spec, elevation);
  const slopeDeg = slopeDegrees(gradient);
  const constraintSlopeDeg = new Float32Array(n);
  const block = new Uint8Array(n);
  const staticPenalty = new Float32Array(n);
  const rough = new Uint8Array(n);
  const lowTi = new Uint8Array(n);

  for (let k = 0; k < n; k++) {
    const s = slopeDeg[k]!;
    const fineMedian = layers.fineSlopeMedianDeg?.[k] ?? Number.NaN;
    const constraint = Number.isNaN(fineMedian) ? s : Math.max(s, fineMedian);
    constraintSlopeDeg[k] = constraint;

    if (Number.isNaN(elevation[k]!) || Number.isNaN(s)) block[k] = BLOCK.nodata;
    else if (layers.excluded?.[k] === 1) block[k] = BLOCK.excluded;
    else if (constraint > params.maxSlopeDeg) block[k] = BLOCK.slope;
    if (block[k] !== BLOCK.none) continue;

    let penalty = bandPenalty(constraint, params);
    const p90 = layers.fineSlopeP90Deg?.[k] ?? Number.NaN;
    if (p90 > params.roughP90Deg) {
      rough[k] = 1;
      penalty += params.roughPenalty;
    }
    const ti = layers.thermalInertia?.[k] ?? Number.NaN;
    if (ti < params.lowThermalInertia) {
      lowTi[k] = 1;
      penalty += params.lowThermalInertiaPenalty;
    }
    staticPenalty[k] = penalty;
  }

  const rowWidthM = rowWidths(spec);
  let minCellWidthM = Number.POSITIVE_INFINITY;
  for (const w of rowWidthM) minCellWidthM = Math.min(minCellWidthM, w);

  return {
    layers,
    params,
    gradient,
    slopeDeg,
    constraintSlopeDeg,
    block,
    staticPenalty,
    rough,
    lowThermalInertia: lowTi,
    rowWidthM,
    cellHeightM: cellHeightM(spec),
    minCellWidthM,
  };
}
