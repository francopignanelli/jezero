import type { LayerId } from '../app/store';

export type LayerKind = 'tiles' | 'overlay' | 'vector';

export interface LayerDef {
  id: LayerId;
  group: 'imagery' | 'terrain' | 'science' | 'surface';
  kind: LayerKind;
  /** Catalog dataset ids this layer is derived from (provenance). */
  datasets: string[];
  /** For derived layers: short description of the derivation shown in the provenance dialog. */
  derivation?: string;
  swatch: string;
}

export const LAYERS: LayerDef[] = [
  {
    id: 'sky',
    group: 'imagery',
    kind: 'vector',
    datasets: ['bsc5', 'svs-deep-star-maps'],
    derivation:
      'Star, planet, Sun and Milky Way directions are exact (ICRF to Mars body-fixed with the IAU 2015 rotation at the planned EVA time; planets from astronomy-engine). The Sun is drawn at its true angular diameter. Brightness is enhanced compared with a camera exposed for sunlit Mars; the daytime surface sky colour is illustrative. Phobos and Deimos are not shown.',
    swatch: '#8fa3c7',
  },
  { id: 'viking', group: 'imagery', kind: 'tiles', datasets: ['viking-color-925'], swatch: '#b0664a' },
  { id: 'ctx', group: 'imagery', kind: 'tiles', datasets: ['ctx-ortho-jpl'], swatch: '#9a9a9a' },
  { id: 'hirise', group: 'imagery', kind: 'tiles', datasets: ['hirise-ortho-trn'], swatch: '#c9c9c9' },
  {
    id: 'slope',
    group: 'terrain',
    kind: 'overlay',
    datasets: ['hirise-dtm-trn'],
    derivation: 'Horn slope of the 5 m block-mean elevation (10 m baseline), combined with the median 2 m-baseline slope per cell; exactly the slope used by the route planner.',
    swatch: '#fde725',
  },
  {
    id: 'elevation',
    group: 'terrain',
    kind: 'overlay',
    datasets: ['hirise-dtm-trn'],
    derivation:
      '5 m block mean of the 1 m HiRISE DTM, height above the MOLA areoid. Colours stretch over the 2nd–98th percentile of the area; values beyond clamp to the end colours.',
    swatch: '#21918c',
  },
  {
    id: 'thermalInertia',
    group: 'science',
    kind: 'overlay',
    datasets: ['themis-ti-jezero'],
    derivation:
      'Nearest-neighbour resampling of the 100 m product to the 5 m grid (no added detail). Colours stretch over the 2nd–98th percentile.',
    swatch: '#5ec962',
  },
  { id: 'coverage', group: 'terrain', kind: 'vector', datasets: ['hirise-dtm-trn'], swatch: '#6cc6e6' },
  { id: 'pois', group: 'science', kind: 'vector', datasets: ['m2020-mmgis'], swatch: '#b69cff' },
  { id: 'samples', group: 'surface', kind: 'vector', datasets: ['m2020-mmgis'], swatch: '#ff9ad5' },
  { id: 'rover', group: 'surface', kind: 'vector', datasets: ['m2020-mmgis', 'm2020-places'], swatch: '#f2b84b' },
  { id: 'ingenuity', group: 'surface', kind: 'vector', datasets: ['m2020-mmgis'], swatch: '#9fe3ff' },
];
