import datasetsJson from '../../../../data/catalog/datasets.json';
import poisJson from '../../../../data/catalog/pois.json';

export interface DatasetEntry {
  id: string;
  title: string;
  mission: string;
  instrument: string;
  productId: string;
  publisher: string;
  landingPage: string;
  accessUrl: string;
  doi?: string;
  published: string;
  resolution: { value: number; unit: string } | null;
  units: string;
  crs: string;
  verticalDatum: string | null;
  uncertainty: string;
  license: string;
  citation: string;
  role: string[];
}

export interface Poi {
  id: string;
  name: string;
  lat: number;
  lon: number;
  basis: string;
  sampleNumbers: string[];
  why: { en: string; es: string };
  investigate: { en: string; es: string };
  sources: string[];
}

export const DATASETS: DatasetEntry[] = (datasetsJson as { datasets: DatasetEntry[] }).datasets;
export const datasetById = (id: string): DatasetEntry | undefined => DATASETS.find((d) => d.id === id);

export const POIS: Poi[] = (poisJson as { pois: Poi[] }).pois;
export const GUIDED_MISSION = (poisJson as { guidedMission: { id: string; waypoints: string[]; returnToStart: boolean } })
  .guidedMission;

/** NASA missions represented in the layers (missions, not instruments). */
export const MISSIONS = [...new Set(DATASETS.filter((d) => !d.role.includes('sky-reference')).map((d) => d.mission))];
