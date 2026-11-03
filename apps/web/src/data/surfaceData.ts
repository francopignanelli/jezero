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

/** One request per file per session: the map, the Science panel and the 360° HUD share it. */
const cache = new Map<string, Promise<unknown>>();

function json<T>(path: string): Promise<T | null> {
  let p = cache.get(path) as Promise<T | null> | undefined;
  if (!p) {
    p = fetch(dataUrl(path))
      .then((res) => (res.ok ? (res.json() as Promise<T>) : null))
      .catch(() => null);
    cache.set(path, p);
    // A failure may be transient: let a later call retry.
    void p.then((v) => v === null && cache.delete(path));
  }
  return p;
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

export type CrismComposite = 'car' | 'maf';

/** CRISM MTRDR browse composites snapshotted by scripts/data/snapshot-crism.ts. */
export interface CrismManifest {
  retrievedUtc: string;
  uncertainty: string;
  observations: Array<{
    id: string;
    startTime: string;
    west: number;
    east: number;
    south: number;
    north: number;
    mPerPixel: number;
    composites: Partial<Record<CrismComposite, { file: string; bands: string[]; description: string }>>;
  }>;
}

export const loadCrism = () => json<CrismManifest>('crism/crism.json');
