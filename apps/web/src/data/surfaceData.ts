import { dataUrl } from '../config';

/** Normalized Mars 2020 snapshots written by scripts/data/snapshot-rover.ts. */
export interface RoverSnapshot {
  retrievedUtc: string;
  provenance: string;
  issues: string[];
  sources: Array<{ url: string; lastModified: string | null }>;
  latest: { sol: number; lat: number; lon: number; elevationM: number; distTotalM: number };
  waypoints: Array<[number, number, number, number, number]>;
}

export interface SampleSite {
  sampleNumber: string;
  sol: string;
  earthDate: string;
  name: string;
  outcrop: string;
  location: string;
  sampleType: string;
  rockType: string;
  lat: number;
  lon: number;
  elevationM: number;
  positionCorrectedFromEastingNorthing: boolean;
}

export interface IngenuityFlight {
  flight: number;
  sol: number;
  earthDate: string;
  lat: number;
  lon: number;
}

export interface TraverseCollection {
  type: 'FeatureCollection';
  features: Array<{ properties: { sol: number }; geometry: { type: 'LineString'; coordinates: Array<[number, number]> } }>;
}

async function json<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(dataUrl(path));
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export const loadRover = () => json<RoverSnapshot>('rover/rover.json');
export const loadTraverse = () => json<TraverseCollection>('rover/traverse.geojson');
export const loadSamples = () => json<{ samples: SampleSite[]; retrievedUtc: string }>('rover/samples.json');
export const loadIngenuity = () => json<{ flights: IngenuityFlight[] }>('rover/ingenuity.json');
export const loadCoverage = () =>
  json<{ features: Array<{ geometry: { type: 'Polygon'; coordinates: Array<Array<[number, number]>> } }> }>(
    'regions/jezero/coverage.geojson',
  );
export const loadImageryLayer = (id: string) =>
  json<{ id: string; rectangle: { west: number; south: number; east: number; north: number }; minLevel: number; maxLevel: number; tiles: number }>(
    `tiles/imagery/${id}/layer.json`,
  );
