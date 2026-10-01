import { RAD_TO_DEG } from '../geo/angles';
import { cellHeightM, rowWidths, type GridSpec } from '../raster/grid';

/** Surface gradient in ground metres per metre (east and north components). NaN where undefined. */
export interface Gradient {
  dzdEast: Float32Array;
  dzdNorth: Float32Array;
}

/**
 * Horn (1981) 3×3 gradient on a north-up grid. The baseline is two cells in each direction.
 * All eight neighbours must be valid; otherwise the gradient is NaN, which erodes the valid area by
 * one cell instead of extrapolating slope across nodata.
 *
 * Layout (row 0 north):   a b c
 *                         d e f
 *                         g h i
 *   dz/dEast  = ((c + 2f + i) − (a + 2d + g)) / (8 Δx_row)
 *   dz/dNorth = ((a + 2b + c) − (g + 2h + i)) / (8 Δy)
 */
export function hornGradient(spec: GridSpec, elevation: Float32Array): Gradient {
  const { cols, rows } = spec;
  const n = cols * rows;
  const dzdEast = new Float32Array(n).fill(Number.NaN);
  const dzdNorth = new Float32Array(n).fill(Number.NaN);
  const widths = rowWidths(spec);
  const dy = cellHeightM(spec);
  for (let r = 1; r < rows - 1; r++) {
    const dx = widths[r]!;
    const up = (r - 1) * cols;
    const mid = r * cols;
    const dn = (r + 1) * cols;
    for (let c = 1; c < cols - 1; c++) {
      const a = elevation[up + c - 1]!;
      const b = elevation[up + c]!;
      const cc = elevation[up + c + 1]!;
      const d = elevation[mid + c - 1]!;
      const f = elevation[mid + c + 1]!;
      const g = elevation[dn + c - 1]!;
      const h = elevation[dn + c]!;
      const i = elevation[dn + c + 1]!;
      const e = elevation[mid + c]!;
      if (Number.isNaN(a + b + cc + d + e + f + g + h + i)) continue;
      dzdEast[mid + c] = (cc + 2 * f + i - (a + 2 * d + g)) / (8 * dx);
      dzdNorth[mid + c] = (a + 2 * b + cc - (g + 2 * h + i)) / (8 * dy);
    }
  }
  return { dzdEast, dzdNorth };
}

/** Slope magnitude in degrees from a gradient field. NaN where the gradient is undefined. */
export function slopeDegrees(gradient: Gradient): Float32Array {
  const n = gradient.dzdEast.length;
  const out = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    out[k] = Math.atan(Math.hypot(gradient.dzdEast[k]!, gradient.dzdNorth[k]!)) * RAD_TO_DEG;
  }
  return out;
}

/**
 * Standard deviation (m/m) of one Horn gradient component caused by independent vertical errors σz:
 * √12 σz / (8 Δ). This is a conservative bound, because real DTM errors are spatially correlated.
 */
export function hornGradientNoise(sigmaZ: number, cellSizeM: number): number {
  return (Math.sqrt(12) * sigmaZ) / (8 * cellSizeM);
}
