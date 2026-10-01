import {
  decodeGridBand,
  terrainLayersFromBands,
  type GridBandName,
  type GridFileHeader,
  type TerrainLayers,
} from '@copernico/domain';

export type GridHeader = GridFileHeader;

/** Fetches the operational grid header and bands and decodes them (runs inside the worker). */
export async function loadTerrainLayers(baseUrl: string): Promise<{ header: GridHeader; layers: TerrainLayers }> {
  const res = await fetch(`${baseUrl}/grid.json`);
  if (!res.ok) throw new Error(`grid.json: HTTP ${res.status}`);
  const header = (await res.json()) as GridHeader;
  const n = header.cols * header.rows;
  const decoded = await Promise.all(
    header.bands.map(async (band) => {
      const r = await fetch(`${baseUrl}/${band.file}`);
      if (!r.ok) throw new Error(`${band.file}: HTTP ${r.status}`);
      return [band.name, decodeGridBand(await r.arrayBuffer(), band, n)] as const;
    }),
  );
  const bands = Object.fromEntries(decoded) as Partial<Record<GridBandName, Float32Array>>;
  return { header, layers: terrainLayersFromBands(header, bands) };
}
