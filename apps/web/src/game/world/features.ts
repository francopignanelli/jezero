import type { HeightLayer } from './heights';

/**
 * Generated terrain features on top of the real 1 m DTM:
 *
 * - Small impact craters (5–80 m, plus two larger landmark craters per area), baked into the
 *   detail heights and the orbital brightness. The renderer, the wheels and the rock placement
 *   therefore all see them. Jezero's floor is peppered with such craters; these ones are placed
 *   procedurally, away from the real sample sites, and are not real ones.
 *   - Fresh craters: about 0.2 D deep, with a raised rim and a bright, bouldery ejecta blanket.
 *   - Degraded ones: shallow, with their floors filled by dark sand.
 *   Profiles follow Pike (1977) for simple craters: a parabolic bowl, a rim of about 0.04 D, and
 *   ejecta thinning as r⁻³.
 * - Micro-relief: a few centimetres of value noise (wavelengths of 1–3 m), so the ground is not
 *   as smooth as a 1 m model interpolated. It uses an integer hash, so this code and the terrain
 *   shader (GLSL_MICRO) compute the same heights.
 */

export interface Crater {
  x: number;
  north: number;
  radiusM: number;
  depthM: number;
  rimM: number;
  /** 1 fresh (sharp rim, boulders, bright ejecta) … 0 degraded (shallow, sand-filled). */
  fresh: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hashString = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** Craters per km² with D ≥ 5 m (the cumulative size distribution then falls as D⁻²). */
const DENSITY_PER_KM2 = 55;
const MIN_D = 5;
const MAX_D = 80;
const SIZE_ALPHA = 2;

/** Height of a crater's profile at distance `r` (m) from its centre, relative to the surroundings. */
export function craterProfile(c: Crater, r: number): number {
  const s = r / c.radiusM;
  if (s >= 3) return 0;
  // Crest rounded a little (more on degraded craters); the outside starts at its height.
  const round = 0.25 * (1 - 0.5 * c.fresh);
  if (s < 1) {
    let h = c.rimM - c.depthM * (1 - s * s);
    // Degraded craters: a flat floor of sand.
    const floor = c.rimM - c.depthM * (0.35 + 0.5 * c.fresh);
    if (h < floor) h = floor + (h - floor) * 0.15;
    if (s > 0.85) h -= c.rimM * round * ((s - 0.85) / 0.15) ** 2;
    return h;
  }
  const t = s - 2;
  const fade = t > 0 ? 1 - t * t * (3 - 2 * t) : 1;
  return c.rimM * (1 - round) * s ** -3 * fade;
}

/** Brightness change (0–255 grey levels) of the orbital image at distance `r`. */
function craterTone(c: Crater, r: number): number {
  const s = r / c.radiusM;
  if (s >= 2.6) return 0;
  if (s < 1) {
    // Floor: dark sand in degraded craters; fresh walls a little brighter.
    const floor = s < 0.65 ? -26 * (1 - c.fresh) : 0;
    return floor + 14 * c.fresh * Math.max(0, s - 0.4);
  }
  return 22 * c.fresh * Math.max(0, 1 - (s - 1) / 1.6);
}

/** Craters of one area, deterministic (seeded by the area id), clear of the given points. */
export function generateCraters(
  areaId: string,
  widthM: number,
  heightM: number,
  keepClear: Array<[number, number]>,
  insetM = 70,
): Crater[] {
  const rand = mulberry32(hashString(areaId) ^ 0x5bd1e995);
  const areaKm2 = (widthM * heightM) / 1e6;
  const out: Crater[] = [];
  const clear = (x: number, n: number, radius: number) => {
    for (const [px, pn] of keepClear)
      if (Math.hypot(px - x, pn - n) < radius * 2.4 + 18) return false;
    for (const c of out)
      if (Math.hypot(c.x - x, c.north - n) < (c.radiusM + radius) * 0.9) return false;
    return true;
  };
  const place = (d: number, fresh: number): boolean => {
    const r = d / 2;
    const margin = insetM + r * 3;
    for (let attempt = 0; attempt < 30; attempt++) {
      const x = (rand() - 0.5) * (widthM - 2 * margin);
      const n = (rand() - 0.5) * (heightM - 2 * margin);
      if (!clear(x, n, r)) continue;
      const depth = d * (0.06 + 0.13 * fresh) * (0.85 + 0.3 * rand());
      out.push({
        x,
        north: n,
        radiusM: r,
        depthM: depth,
        rimM: d * 0.04 * (0.4 + 0.6 * fresh),
        fresh,
      });
      return true;
    }
    return false;
  };
  // Two landmark craters first (they need the most room), then the population, largest first.
  for (let k = 0; k < 2; k++) place(95 + rand() * 50, 0.75 + 0.25 * rand());
  const count = Math.round(DENSITY_PER_KM2 * areaKm2);
  const ratio = (MIN_D / MAX_D) ** SIZE_ALPHA;
  const sizes = Array.from(
    { length: count },
    () => MIN_D * (1 - rand() * (1 - ratio)) ** (-1 / SIZE_ALPHA),
  ).sort((a, b) => b - a);
  for (const d of sizes) place(d, rand() < 0.3 ? 0.7 + 0.3 * rand() : 0.25 * rand());
  return out;
}

/**
 * Adds the craters to the detail heights and to the detail brightness image (in place). The
 * image covers the same extent as the heights at `greyCellM` per pixel.
 */
export function bakeCraters(
  craters: Crater[],
  heights: HeightLayer,
  grey: { data: Uint8Array; width: number; height: number; cellM: number },
): void {
  const { cols, rows, cellM, widthM, heightM, data } = heights;
  for (const c of craters) {
    const reach = c.radiusM * 3;
    const c0 = Math.max(0, Math.floor((c.x - reach + widthM / 2) / cellM));
    const c1 = Math.min(cols - 1, Math.ceil((c.x + reach + widthM / 2) / cellM));
    const r0 = Math.max(0, Math.floor((heightM / 2 - c.north - reach) / cellM));
    const r1 = Math.min(rows - 1, Math.ceil((heightM / 2 - c.north + reach) / cellM));
    for (let r = r0; r <= r1; r++) {
      const n = heightM / 2 - (r + 0.5) * cellM;
      for (let k = c0; k <= c1; k++) {
        const x = (k + 0.5) * cellM - widthM / 2;
        data[r * cols + k]! += craterProfile(c, Math.hypot(x - c.x, n - c.north));
      }
    }
    const g = grey;
    const reachT = c.radiusM * 2.6;
    const gc0 = Math.max(0, Math.floor((c.x - reachT + widthM / 2) / g.cellM));
    const gc1 = Math.min(g.width - 1, Math.ceil((c.x + reachT + widthM / 2) / g.cellM));
    const gr0 = Math.max(0, Math.floor((heightM / 2 - c.north - reachT) / g.cellM));
    const gr1 = Math.min(g.height - 1, Math.ceil((heightM / 2 - c.north + reachT) / g.cellM));
    for (let r = gr0; r <= gr1; r++) {
      const n = heightM / 2 - (r + 0.5) * g.cellM;
      for (let k = gc0; k <= gc1; k++) {
        const x = (k + 0.5) * g.cellM - widthM / 2;
        const t = craterTone(c, Math.hypot(x - c.x, n - c.north));
        if (t !== 0) {
          const i = r * g.width + k;
          g.data[i] = Math.max(0, Math.min(255, g.data[i]! + t));
        }
      }
    }
  }
}

/** Crater lookup by position (for the rock placement: boulders on fresh rims and ejecta). */
export class CraterField {
  private readonly cells = new Map<string, Crater[]>();
  private static readonly CELL_M = 64;

  constructor(readonly craters: Crater[]) {
    const s = CraterField.CELL_M;
    for (const c of craters) {
      const reach = c.radiusM * 3;
      for (let i = Math.floor((c.x - reach) / s); i <= Math.floor((c.x + reach) / s); i++)
        for (
          let j = Math.floor((c.north - reach) / s);
          j <= Math.floor((c.north + reach) / s);
          j++
        ) {
          const key = `${i}:${j}`;
          const list = this.cells.get(key) ?? [];
          list.push(c);
          this.cells.set(key, list);
        }
    }
  }

  /** Extra rock density factor (0 = none): high on fresh rims, falling off over the ejecta. */
  rockiness(x: number, north: number): number {
    const s = CraterField.CELL_M;
    const list = this.cells.get(`${Math.floor(x / s)}:${Math.floor(north / s)}`);
    if (!list) return 0;
    let f = 0;
    for (const c of list) {
      const q = Math.hypot(x - c.x, north - c.north) / c.radiusM;
      if (q > 3) continue;
      const rim = q < 1 ? Math.max(0, (q - 0.45) / 0.55) ** 2 : Math.exp(-(q - 1) * 1.6);
      f = Math.max(f, rim * (0.3 + 3.7 * c.fresh));
    }
    return f;
  }
}

// ---------- micro-relief ----------

/** Integer hash of a lattice point to [0, 1]; same bits as the GLSL below (uint arithmetic). */
export function latticeHash(i: number, j: number): number {
  let h =
    (Math.imul((i + 65536) >>> 0, 1597334677) ^ Math.imul((j + 65536) >>> 0, 3812015801)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 2246822519) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return h / 4294967295;
}

function valueNoise(x: number, y: number): number {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = latticeHash(i, j);
  const b = latticeHash(i + 1, j);
  const c = latticeHash(i, j + 1);
  const d = latticeHash(i + 1, j + 1);
  return (a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy) * 2 - 1;
}

/** Wavelengths (m) and amplitudes (m) of the micro-relief octaves. */
export const MICRO_OCTAVES: Array<[number, number]> = [
  [2.7, 0.055],
  [1.15, 0.022],
];

/** Micro-relief (m) at a local point; the caller weights it by the detail layer's coverage. */
export function microRelief(x: number, north: number): number {
  let h = 0;
  for (const [k, [lambda, amp]] of MICRO_OCTAVES.entries()) {
    // Each octave rotated and offset, so their lattices do not align.
    const a = 0.6 + k * 1.1;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const u = (x * ca - north * sa) / lambda + 17.3 * k;
    const v = (x * sa + north * ca) / lambda - 9.1 * k;
    h += amp * valueNoise(u, v);
  }
  return h;
}

/** The same micro-relief in GLSL (ES 3.0); `microRelief(p, fade)` weights each octave. */
export const GLSL_MICRO = /* glsl */ `
  float latticeHash(ivec2 c) {
    uint h = (uint(c.x + 65536) * 1597334677u) ^ (uint(c.y + 65536) * 3812015801u);
    h = (h ^ (h >> 16u)) * 2246822519u;
    h = h ^ (h >> 13u);
    return float(h) / 4294967295.0;
  }
  float valueNoiseI(vec2 p) {
    vec2 i = floor(p);
    vec2 f = p - i;
    vec2 u = f * f * (3.0 - 2.0 * f);
    ivec2 c = ivec2(i);
    float a = latticeHash(c), b = latticeHash(c + ivec2(1, 0));
    float d = latticeHash(c + ivec2(0, 1)), e = latticeHash(c + ivec2(1, 1));
    return (a + (b - a) * u.x + (d - a) * u.y + (a - b - d + e) * u.x * u.y) * 2.0 - 1.0;
  }
  /** fade: per-octave weights (1 near the camera, 0 where the mesh is too coarse to show it). */
  float microRelief(vec2 p, vec2 fade) {
    float h = 0.0;
    ${MICRO_OCTAVES.map(([lambda, amp], k) => {
      const a = 0.6 + k * 1.1;
      const ca = Math.cos(a).toFixed(6);
      const sa = Math.sin(a).toFixed(6);
      return `if (fade[${k}] > 0.0) {
      vec2 q = vec2(p.x * ${ca} - p.y * ${sa}, p.x * ${sa} + p.y * ${ca}) / ${lambda.toFixed(3)}
             + vec2(${(17.3 * k).toFixed(2)}, ${(-9.1 * k).toFixed(2)});
      h += ${amp.toFixed(4)} * valueNoiseI(q) * fade[${k}];
    }`;
    }).join('\n    ')}
    return h;
  }
`;
