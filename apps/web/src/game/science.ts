import type { MissionId } from './missions';

/**
 * SuperCam laser analyses (LIBS: laser-induced breakdown spectroscopy).
 *
 * Perseverance's SuperCam fires an infrared laser at rocks up to about 7 m away. Each pulse turns
 * a speck of rock into a glowing plasma, and the light of that plasma (its emission lines) gives
 * the elements present. In the game, every rock can be analysed once.
 *
 * Its type is drawn deterministically from where it lies, following what Perseverance found in
 * each part of Jezero:
 * - The crater floor: basalt-like Máaz and olivine-rich Séítah rocks, with salts in places.
 * - The delta front: sediments (clays, sulfates, carbonates).
 * - The delta top and margin: carbonates and silica.
 * Iron–nickel meteorites are rare (both rovers have found some).
 */

export type RockType =
  'basalt' | 'olivine' | 'sulfate' | 'clay' | 'carbonate' | 'silica' | 'meteorite';

export const ROCK_TYPES: RockType[] = [
  'basalt',
  'olivine',
  'sulfate',
  'clay',
  'carbonate',
  'silica',
  'meteorite',
];

/** Laser range (m), as SuperCam's LIBS. */
export const LASER_RANGE_M = 7;
/** Duration of one analysis in the game (s): aim, pulse train, read-out. */
export const LASER_S = 2.6;
export const LASER_COST_PCT = 0.6;

/** Science points per analysis (rarer types are worth more; a first find counts double). */
export const POINTS: Record<RockType, number> = {
  basalt: 10,
  olivine: 15,
  sulfate: 20,
  clay: 25,
  carbonate: 30,
  silica: 40,
  meteorite: 100,
};

/** Odds per area (normalised), for dark and for light-toned rocks. */
const ODDS: Record<
  MissionId,
  { dark: Partial<Record<RockType, number>>; light: Partial<Record<RockType, number>> }
> = {
  floor: {
    dark: { basalt: 0.62, olivine: 0.3, sulfate: 0.05 },
    light: { basalt: 0.35, olivine: 0.25, sulfate: 0.28, clay: 0.1 },
  },
  delta: {
    dark: { basalt: 0.45, olivine: 0.2, clay: 0.2, sulfate: 0.1 },
    light: { clay: 0.35, carbonate: 0.25, sulfate: 0.25, silica: 0.05, basalt: 0.08 },
  },
  margin: {
    dark: { olivine: 0.4, basalt: 0.25, carbonate: 0.25 },
    light: { carbonate: 0.45, silica: 0.18, clay: 0.15, olivine: 0.12 },
  },
};
const METEORITE_ODDS = 0.012;

/** Hash of a rock's position (its identity: rocks are placed deterministically). */
export const rockKey = (x: number, north: number): string =>
  `${Math.round(x * 20)}:${Math.round(north * 20)}`;

function hash01(key: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** The type of the rock at a position, in an area; `dark` is its tone. */
export function rockType(area: MissionId, key: string, dark: boolean): RockType {
  if (hash01(key, 7) < METEORITE_ODDS) return 'meteorite';
  const odds = ODDS[area][dark ? 'dark' : 'light'];
  const entries = Object.entries(odds) as Array<[RockType, number]>;
  const total = entries.reduce((s, [, p]) => s + p, 0);
  let u = hash01(key, 1) * total;
  for (const [type, p] of entries) {
    if (u < p) return type;
    u -= p;
  }
  return entries[0]![0];
}

/**
 * LIBS emission lines (nm) of the elements SuperCam reads most often: the strongest lines in the
 * 240–800 nm range.
 */
export const LINES: Array<{ el: string; nm: number }> = [
  { el: 'C', nm: 247.9 },
  { el: 'Fe', nm: 259.9 },
  { el: 'Mg', nm: 279.6 },
  { el: 'Si', nm: 288.2 },
  { el: 'Al', nm: 309.3 },
  { el: 'Ti', nm: 334.9 },
  { el: 'Ni', nm: 341.5 },
  { el: 'Ca', nm: 393.4 },
  { el: 'Fe', nm: 404.6 },
  { el: 'Ca', nm: 422.7 },
  { el: 'S', nm: 545.4 },
  { el: 'Na', nm: 589.0 },
  { el: 'H', nm: 656.3 },
  { el: 'K', nm: 766.5 },
  { el: 'O', nm: 777.4 },
];

/** Relative line strengths (0–1) by element for each type (illustrative, not measurements). */
const ELEMENTS: Record<RockType, Record<string, number>> = {
  basalt: { Si: 0.85, Fe: 0.6, Mg: 0.4, Ca: 0.7, Al: 0.55, Na: 0.5, Ti: 0.25, K: 0.15, O: 0.5 },
  olivine: { Mg: 0.95, Fe: 0.7, Si: 0.6, Ca: 0.15, Al: 0.1, Na: 0.1, O: 0.5 },
  sulfate: { Ca: 0.95, S: 0.35, H: 0.45, O: 0.6, Mg: 0.3, Si: 0.2 },
  clay: { Si: 0.75, Al: 0.7, Fe: 0.45, H: 0.6, K: 0.3, Mg: 0.35, O: 0.55 },
  carbonate: { Mg: 0.85, Fe: 0.5, C: 0.45, Ca: 0.35, O: 0.65, Si: 0.25 },
  silica: { Si: 1, H: 0.5, O: 0.6, Al: 0.1 },
  meteorite: { Fe: 1, Ni: 0.75, Si: 0.08, O: 0.2 },
};

/** Main elements of a type, strongest first (for the read-out). */
export function mainElements(type: RockType, n = 4): string[] {
  return Object.entries(ELEMENTS[type])
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([el]) => el);
}

/**
 * A spectrum for display: intensities on a wavelength grid (240–800 nm). It shows Gaussian lines
 * at the elements' wavelengths, a little noise varied per rock, and the plasma's continuum.
 */
export function spectrum(type: RockType, key: string, points = 280): number[] {
  const out = new Array<number>(points).fill(0);
  const els = ELEMENTS[type];
  for (let i = 0; i < points; i++) {
    const nm = 240 + (560 * i) / (points - 1);
    let v = 0.04 + 0.03 * Math.exp(-((nm - 420) ** 2) / 2e4);
    for (const line of LINES) {
      const a = els[line.el] ?? 0;
      if (a > 0) v += a * Math.exp(-((nm - line.nm) ** 2) / (2 * 1.6 ** 2));
    }
    v += 0.025 * (hash01(`${key}:${i}`, 3) - 0.5);
    out[i] = Math.max(0, v);
  }
  return out;
}
