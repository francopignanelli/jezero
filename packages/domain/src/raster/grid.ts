import { eqcEastWestScale, eqcInverse, eqcForward, type EqcParams, type XY } from '../geo/equirectangular';

/**
 * A north-up raster on an equirectangular projection. Row 0 is the northernmost row; cells are
 * square in projected units. Ground cell width varies (slightly) with latitude and is always
 * obtained from {@link cellWidthM}, never from `cellSize` directly.
 */
export interface GridSpec {
  cols: number;
  rows: number;
  /** Projected x of the west edge of column 0 (m). */
  originX: number;
  /** Projected y of the north edge of row 0 (m). */
  originY: number;
  /** Cell size in projected metres. */
  cellSize: number;
  projection: EqcParams;
}

export function cellIndex(spec: GridSpec, col: number, row: number): number {
  return row * spec.cols + col;
}

export function inBounds(spec: GridSpec, col: number, row: number): boolean {
  return col >= 0 && row >= 0 && col < spec.cols && row < spec.rows;
}

export function cellCenter(spec: GridSpec, col: number, row: number): XY {
  return {
    x: spec.originX + (col + 0.5) * spec.cellSize,
    y: spec.originY - (row + 0.5) * spec.cellSize,
  };
}

export function rowCenterLatDeg(spec: GridSpec, row: number): number {
  return eqcInverse(spec.projection, 0, spec.originY - (row + 0.5) * spec.cellSize).lat;
}

/** Ground east-west width of a cell in `row` (m). */
export function cellWidthM(spec: GridSpec, row: number): number {
  return spec.cellSize * eqcEastWestScale(spec.projection, rowCenterLatDeg(spec, row));
}

/** Ground north-south height of a cell (m). Exact: y = Rφ is true to scale along meridians. */
export function cellHeightM(spec: GridSpec): number {
  return spec.cellSize;
}

/** Fractional (col, row) of a projected point, in cell units where cell centres are integers. */
export function fractionalCell(spec: GridSpec, p: XY): { fc: number; fr: number } {
  return {
    fc: (p.x - spec.originX) / spec.cellSize - 0.5,
    fr: (spec.originY - p.y) / spec.cellSize - 0.5,
  };
}

/** Cell containing a planetocentric lat/lon (east-positive), or null if outside the grid. */
export function locateCell(
  spec: GridSpec,
  latDeg: number,
  lonDeg: number,
): { col: number; row: number } | null {
  const p = eqcForward(spec.projection, latDeg, lonDeg);
  const col = Math.floor((p.x - spec.originX) / spec.cellSize);
  const row = Math.floor((spec.originY - p.y) / spec.cellSize);
  return inBounds(spec, col, row) ? { col, row } : null;
}

export function cellLatLon(spec: GridSpec, col: number, row: number): { lat: number; lon: number } {
  const c = cellCenter(spec, col, row);
  return eqcInverse(spec.projection, c.x, c.y);
}

/** Per-row ground cell widths (m), precomputed for hot loops. */
export function rowWidths(spec: GridSpec): Float64Array {
  const w = new Float64Array(spec.rows);
  for (let r = 0; r < spec.rows; r++) w[r] = cellWidthM(spec, r);
  return w;
}

/**
 * Bilinear interpolation of a NaN-aware field at a projected point. Falls back to the nearest
 * cell when any of the four neighbours is NaN, so values are never invented across nodata.
 */
export function sampleBilinear(spec: GridSpec, field: Float32Array, p: XY): number {
  const { fc, fr } = fractionalCell(spec, p);
  const c0 = Math.floor(fc);
  const r0 = Math.floor(fr);
  const tx = fc - c0;
  const ty = fr - r0;
  const c1 = c0 + 1;
  const r1 = r0 + 1;
  if (c0 >= 0 && r0 >= 0 && c1 < spec.cols && r1 < spec.rows) {
    const z00 = field[r0 * spec.cols + c0]!;
    const z10 = field[r0 * spec.cols + c1]!;
    const z01 = field[r1 * spec.cols + c0]!;
    const z11 = field[r1 * spec.cols + c1]!;
    if (!Number.isNaN(z00 + z10 + z01 + z11)) {
      return (z00 * (1 - tx) + z10 * tx) * (1 - ty) + (z01 * (1 - tx) + z11 * tx) * ty;
    }
  }
  const nc = Math.round(fc);
  const nr = Math.round(fr);
  return inBounds(spec, nc, nr) ? field[nr * spec.cols + nc]! : Number.NaN;
}
