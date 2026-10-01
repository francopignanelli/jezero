import type { TerrainLayers } from '../routing/terrain';
import type { GridSpec } from './grid';

/**
 * Operational grid files written by scripts/geospatial/copernico_geo/operational.py:
 * a JSON header plus one little-endian binary file per band. Decoding is pure (no I/O) so the web
 * worker and Node validation scripts share it.
 */
export type GridBandName = 'elevation' | 'fine_slope_median' | 'fine_slope_p90' | 'thermal_inertia';

export interface GridBand {
  name: GridBandName;
  file: string;
  dtype: 'int16' | 'uint8';
  scale: number;
  offset: number;
  nodata: number;
  units: string;
  description: string;
  sha256: string;
}

export interface GridFileHeader {
  schemaVersion: 1;
  region: string;
  cols: number;
  rows: number;
  cellSize: number;
  originX: number;
  originY: number;
  projection: { latTsDeg: number; lon0Deg: number; radiusM: number };
  verticalDatum: string;
  bands: GridBand[];
  statistics: Record<string, unknown>;
  datasets: string[];
}

export function gridSpecFromHeader(h: GridFileHeader): GridSpec {
  return {
    cols: h.cols,
    rows: h.rows,
    cellSize: h.cellSize,
    originX: h.originX,
    originY: h.originY,
    projection: { ...h.projection },
  };
}

/** Decodes one band to physical units; nodata becomes NaN. */
export function decodeGridBand(buffer: ArrayBuffer, band: GridBand, cellCount: number): Float32Array {
  const bytes = band.dtype === 'int16' ? 2 : 1;
  if (buffer.byteLength !== cellCount * bytes) {
    throw new Error(`${band.file}: ${buffer.byteLength} bytes, expected ${cellCount * bytes}`);
  }
  const view = new DataView(buffer);
  const out = new Float32Array(cellCount);
  for (let i = 0; i < cellCount; i++) {
    const raw = band.dtype === 'int16' ? view.getInt16(i * 2, true) : view.getUint8(i);
    out[i] = raw === band.nodata ? Number.NaN : raw * band.scale + band.offset;
  }
  return out;
}

/** Assembles terrain layers from decoded bands. Elevation is required. */
export function terrainLayersFromBands(
  header: GridFileHeader,
  bands: Partial<Record<GridBandName, Float32Array>>,
): TerrainLayers {
  if (header.schemaVersion !== 1) throw new Error(`unsupported grid schema ${String(header.schemaVersion)}`);
  if (!bands.elevation) throw new Error('grid has no elevation band');
  const layers: TerrainLayers = { spec: gridSpecFromHeader(header), elevation: bands.elevation };
  if (bands.fine_slope_median) layers.fineSlopeMedianDeg = bands.fine_slope_median;
  if (bands.fine_slope_p90) layers.fineSlopeP90Deg = bands.fine_slope_p90;
  if (bands.thermal_inertia) layers.thermalInertia = bands.thermal_inertia;
  return layers;
}
