import { eqcForward, M2020_EQC } from '../geo/equirectangular';
import { cellWidthM, type GridSpec } from '../raster/grid';

/** Test-only helpers building synthetic terrain near Jezero on the Mars 2020 local frame. */

export const JEZERO_TEST_CENTER = { lat: 18.45, lon: 77.4 };

export function syntheticSpec(cols: number, rows: number, cellSize = 5): GridSpec {
  const c = eqcForward(M2020_EQC, JEZERO_TEST_CENTER.lat, JEZERO_TEST_CENTER.lon);
  return {
    cols,
    rows,
    cellSize,
    originX: c.x - (cols / 2) * cellSize,
    originY: c.y + (rows / 2) * cellSize,
    projection: M2020_EQC,
  };
}

/**
 * Fills an elevation grid from a function of ground metres east/north of the grid centre, using the
 * true per-row cell width so analytic surfaces are reproduced exactly on the sphere.
 */
export function elevationFrom(
  spec: GridSpec,
  z: (eastM: number, northM: number, col: number, row: number) => number,
): Float32Array {
  const out = new Float32Array(spec.cols * spec.rows);
  for (let r = 0; r < spec.rows; r++) {
    const w = cellWidthM(spec, r);
    const north = (spec.rows / 2 - (r + 0.5)) * spec.cellSize;
    for (let c = 0; c < spec.cols; c++) {
      const east = (c + 0.5 - spec.cols / 2) * w;
      out[r * spec.cols + c] = z(east, north, c, r);
    }
  }
  return out;
}
