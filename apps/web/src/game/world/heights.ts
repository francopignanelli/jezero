import { DEG_TO_RAD } from '@copernico/domain';
import { DATA_VERSION, dataUrl } from '../../config';
import { M_PER_DEG } from '../../lib/math';

/**
 * The game world's terrain data (data/build/game, scripts/geospatial/copernico_geo/game.py): per
 * mission area, three height layers on local metric grids (x east, y north, metres from the area
 * centre): detail (1 m DTM), mid (8 m, 12 km) and far (100 m, 64 km, out to the crater rim).
 */

export interface HeightsMeta {
  file: string;
  cols: number;
  rows: number;
  cellM: number;
  widthM: number;
  heightM: number;
  baseM: number;
  stepM: number;
  rangeM: number;
}
export interface ImageMeta {
  file: string;
  cols: number;
  rows: number;
  cellM?: number;
}
export interface LayerMeta {
  heights: HeightsMeta;
  albedo: ImageMeta;
}
export interface AreaMeta {
  id: string;
  lat: number;
  lon: number;
  detail: LayerMeta;
  mid: LayerMeta;
  far: LayerMeta;
}
export interface GroundTextureMeta {
  id: 'regolith' | 'gravel' | 'sand' | 'bedrock';
  file: string;
  sizeM: number;
  panorama: string;
  meanRgb: [number, number, number];
}
export interface WorldManifest {
  areas: AreaMeta[];
  ground: GroundTextureMeta[];
}

/** One height layer, in metres above the world base (the detail layer's lowest point). */
export interface HeightLayer {
  cols: number;
  rows: number;
  cellM: number;
  widthM: number;
  heightM: number;
  data: Float32Array;
}

export const loadManifest = (): Promise<WorldManifest> =>
  fetch(dataUrl(`game/areas.json?v=${DATA_VERSION}`)).then((r) => {
    if (!r.ok) throw new Error(`game/areas.json: ${r.status}`);
    return r.json() as Promise<WorldManifest>;
  });

/** Decodes a heights file: gzip, then per-row running sums modulo 2^16 (see game.py). */
export function decodeHeights(
  raw: Uint16Array,
  meta: HeightsMeta,
  worldBaseM: number,
): HeightLayer {
  const { cols, rows } = meta;
  const data = new Float32Array(cols * rows);
  const offset = meta.baseM - worldBaseM;
  for (let r = 0; r < rows; r++) {
    let q = 0;
    const row = r * cols;
    for (let c = 0; c < cols; c++) {
      q = (q + raw[row + c]!) & 0xffff;
      data[row + c] = offset + q * meta.stepM;
    }
  }
  return { cols, rows, cellM: meta.cellM, widthM: meta.widthM, heightM: meta.heightM, data };
}

export async function loadHeights(meta: HeightsMeta, worldBaseM: number): Promise<HeightLayer> {
  const res = await fetch(dataUrl(`${meta.file}?v=${DATA_VERSION}`));
  if (!res.ok || !res.body) throw new Error(`${meta.file}: ${res.status}`);
  const bytes = await new Response(
    res.body.pipeThrough(new DecompressionStream('gzip')),
  ).arrayBuffer();
  return decodeHeights(new Uint16Array(bytes), meta, worldBaseM);
}

/** Grid coordinates (fractional column, row) of a local point; pixel centres are at integers. */
const gridOf = (l: HeightLayer, x: number, north: number): [number, number] => [
  (x + l.widthM / 2) / l.cellM - 0.5,
  (l.heightM / 2 - north) / l.cellM - 0.5,
];

const at = (l: HeightLayer, c: number, r: number) =>
  l.data[Math.min(l.rows - 1, Math.max(0, r)) * l.cols + Math.min(l.cols - 1, Math.max(0, c))]!;

/** Bilinear height (m above the world base), or undefined outside the layer. */
export function sampleBilinear(l: HeightLayer, x: number, north: number): number | undefined {
  const [gc, gr] = gridOf(l, x, north);
  if (gc < 0 || gr < 0 || gc > l.cols - 1 || gr > l.rows - 1) return undefined;
  const c = Math.floor(gc);
  const r = Math.floor(gr);
  const fc = gc - c;
  const fr = gr - r;
  const top = at(l, c, r) * (1 - fc) + at(l, c + 1, r) * fc;
  const bottom = at(l, c, r + 1) * (1 - fc) + at(l, c + 1, r + 1) * fc;
  return top * (1 - fr) + bottom * fr;
}

/** Catmull-Rom weights for the four samples around fraction t. */
function catmull(t: number): [number, number, number, number] {
  const t2 = t * t;
  const t3 = t2 * t;
  return [
    -0.5 * t3 + t2 - 0.5 * t,
    1.5 * t3 - 2.5 * t2 + 1,
    -1.5 * t3 + 2 * t2 + 0.5 * t,
    0.5 * t3 - 0.5 * t2,
  ];
}

/**
 * Bicubic (Catmull-Rom) height: smooth slopes between the 1 m samples, so low sunlight shows no
 * grid creases. The terrain shader evaluates the same formula (terrain.ts), so the wheels touch
 * the drawn ground. Undefined outside the layer.
 */
export function sampleBicubic(l: HeightLayer, x: number, north: number): number | undefined {
  const [gc, gr] = gridOf(l, x, north);
  if (gc < 0 || gr < 0 || gc > l.cols - 1 || gr > l.rows - 1) return undefined;
  const c = Math.floor(gc);
  const r = Math.floor(gr);
  const wc = catmull(gc - c);
  const wr = catmull(gr - r);
  let h = 0;
  for (let j = 0; j < 4; j++) {
    let row = 0;
    for (let i = 0; i < 4; i++) row += wc[i]! * at(l, c - 1 + i, r - 1 + j);
    h += wr[j]! * row;
  }
  return h;
}

/** Weight (0 at the layer edge, 1 from `rampM` inside) for blending layers. */
export function edgeWeight(l: HeightLayer, x: number, north: number, rampM: number): number {
  const dx = l.widthM / 2 - Math.abs(x) - l.cellM;
  const dy = l.heightM / 2 - Math.abs(north) - l.cellM;
  const d = Math.min(dx, dy);
  if (d <= 0) return 0;
  const t = Math.min(1, d / rampM);
  return t * t * (3 - 2 * t);
}

export const DETAIL_RAMP_M = 40;
export const MID_RAMP_M = 600;

/** The three layers combined as the terrain shader combines them: far, then mid, then detail. */
export class Terrain {
  constructor(
    readonly detail: HeightLayer,
    readonly mid: HeightLayer,
    readonly far: HeightLayer,
  ) {}

  heightAt(x: number, north: number): number {
    let h = sampleBilinear(this.far, x, north) ?? 0;
    const wm = edgeWeight(this.mid, x, north, MID_RAMP_M);
    if (wm > 0) h += ((sampleBilinear(this.mid, x, north) ?? h) - h) * wm;
    const wd = edgeWeight(this.detail, x, north, DETAIL_RAMP_M);
    if (wd > 0) h += ((sampleBicubic(this.detail, x, north) ?? h) - h) * wd;
    return h;
  }

  /** Unit normal (x east, y up, z south) from central differences over `d` metres. */
  normalAt(x: number, north: number, d = 1): [number, number, number] {
    const hx = this.heightAt(x + d, north) - this.heightAt(x - d, north);
    const hn = this.heightAt(x, north + d) - this.heightAt(x, north - d);
    const nx = -hx / (2 * d);
    const nz = hn / (2 * d); // z points south
    const len = Math.hypot(nx, 1, nz);
    return [nx / len, 1 / len, nz / len];
  }
}

/** Local metric frame of an area (equirectangular, true scale at the centre). */
export class LocalFrame {
  private readonly cos0: number;
  constructor(
    readonly lat0: number,
    readonly lon0: number,
  ) {
    this.cos0 = Math.cos(lat0 * DEG_TO_RAD);
  }
  /** (x east, north) metres from the centre. */
  toLocal(lat: number, lon: number): [number, number] {
    return [(lon - this.lon0) * this.cos0 * M_PER_DEG, (lat - this.lat0) * M_PER_DEG];
  }
  toLatLon(x: number, north: number): { lat: number; lon: number } {
    return { lat: this.lat0 + north / M_PER_DEG, lon: this.lon0 + x / (this.cos0 * M_PER_DEG) };
  }
}
