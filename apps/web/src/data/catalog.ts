import datasetsJson from '../../../../data/catalog/datasets.json';
import panoramasJson from '../../../../data/catalog/panoramas.json';
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

/** Measured by scripts/geospatial/run.sh panoramas (skyline matched to the terrain horizon). */
export interface PanoramaGeometry {
  /** Compass azimuth (° from north) of the image's left edge, and whether azimuth grows to the right. */
  azimuthAtLeftDeg: number;
  direction: 1 | -1;
  horizonFraction: number;
  elevationDeg: { top: number; bottom: number };
  /** Azimuth covered by the full image width (a few mosaics overlap themselves slightly). */
  spanDeg: number;
  verticalScale: number;
  /** Share of the image the camera did not image (the rover body), filled smoothly by the pipeline. */
  unimagedFraction?: number;
  /** Mast tilt left in the mosaic: photo elevation = true elevation + tilt·cos(azimuth − toward). */
  tiltDeg: number;
  tiltTowardAzimuthDeg: number;
  medianResidualDeg: number;
  inlierFraction: number;
  groundM: number;
}

/** Real Mastcam-Z 360° mosaics, placed where they were taken (data/catalog/panoramas.json). */
export interface Panorama {
  id: string;
  title: string;
  poiId?: string;
  /** Source label, e.g. "PIA26699" or "ASU Mastcam-Z 360° #23". */
  reference: string;
  sourceUrl: string;
  file: string;
  sols: [number, number];
  date: string;
  position: { lat: number; lon: number; basis: string };
  geometry?: PanoramaGeometry;
}
export const PANORAMA_CREDIT = 'NASA/JPL-Caltech/ASU/MSSS';
/** Only panoramas whose viewing geometry was measured reliably are offered in the app. */
export const PANORAMA_MAX_RESIDUAL_DEG = 0.15;
export const PANORAMAS: Panorama[] = (panoramasJson as unknown as { panoramas: Panorama[] }).panoramas.filter(
  (p) => p.geometry && p.geometry.medianResidualDeg <= PANORAMA_MAX_RESIDUAL_DEG,
);
export const panoramaForPoi = (poiId: string): Panorama | undefined =>
  PANORAMAS.find((p) => p.poiId === poiId);
