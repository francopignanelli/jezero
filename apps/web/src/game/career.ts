import { CHAPTERS, type ExpeditionState } from './expedition';
import type { RockType } from './science';

/**
 * What the player has achieved across missions, kept in the browser (localStorage):
 * - the sample sites ever cored (target ids);
 * - the rock types analysed with the laser, and the rocks already analysed;
 * - the science points.
 * Also here: the expedition in progress (to continue it later), the best time and the options.
 */

export interface Career {
  samples: string[];
  rocks: Partial<Record<RockType, number>>;
  /** Analysed rocks, by area and position key (each rock counts once). */
  analysed: string[];
  science: number;
}

export interface GameOptions {
  hazards: boolean;
  storms: boolean;
}

const CAREER_KEY = 'copernico.game.career.v1';
const OPTIONS_KEY = 'copernico.game.options.v1';
const SAVE_KEY = 'copernico.game.expedition.v1';
const BEST_KEY = 'copernico.game.best.expedition';
const BEST_PREFIX = 'copernico.game.best.';
/** Analysed-rock keys kept (the oldest are dropped). */
const MAX_ANALYSED = 2000;

const EMPTY: Career = { samples: [], rocks: {}, analysed: [], science: 0 };
export const DEFAULT_OPTIONS: GameOptions = { hazards: true, storms: true };

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    // A copy: callers modify what they read.
    if (!raw) return { ...fallback };
    return { ...fallback, ...(JSON.parse(raw) as T) };
  } catch {
    return { ...fallback };
  }
}
function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable: progress is simply not kept
  }
}

export const readCareer = (): Career => read(CAREER_KEY, EMPTY);

export function recordSample(id: string): Career {
  const c = readCareer();
  if (!c.samples.includes(id)) c.samples = [...c.samples, id];
  write(CAREER_KEY, c);
  return c;
}

export const isAnalysed = (key: string): boolean => readCareer().analysed.includes(key);

/** Records an analysis; returns the points it earned and whether the type is a first find. */
export function recordRock(
  type: RockType,
  key: string,
  basePoints: number,
): { points: number; first: boolean } {
  const c = readCareer();
  const first = !c.rocks[type];
  const points = first ? basePoints * 2 : basePoints;
  c.rocks = { ...c.rocks, [type]: (c.rocks[type] ?? 0) + 1 };
  c.analysed = [...c.analysed, key].slice(-MAX_ANALYSED);
  c.science += points;
  write(CAREER_KEY, c);
  return { points, first };
}

export const readOptions = (): GameOptions => read(OPTIONS_KEY, DEFAULT_OPTIONS);
export const writeOptions = (o: GameOptions): void => write(OPTIONS_KEY, o);

// ---------- the expedition in progress ----------

export interface ExpeditionSave {
  state: ExpeditionState;
  rover: {
    lat: number;
    lon: number;
    headingRad: number;
    batteryPct: number;
    wheelsPct: number;
    odometerM: number;
    energyUsedPct: number;
  };
  elapsedS: number;
  savedMs: number;
  /** Where the depot tubes were laid (local x, north, rover heading), once they are. */
  tubesAt?: [number, number, number] | null;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isList = (v: unknown): v is unknown[] => Array.isArray(v);

/** The saved expedition, or null (none, or not readable: a broken save is dropped). */
export function readSave(): ExpeditionSave | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as ExpeditionSave;
    const st = s?.state;
    const r = s?.rover;
    const ok =
      st &&
      isNum(st.chapter) &&
      st.chapter >= 0 &&
      st.chapter < CHAPTERS.length &&
      isList(st.samples) &&
      isList(st.panoramas) &&
      isList(st.reached) &&
      isList(st.flights) &&
      isList(st.finds) &&
      isNum(st.science) &&
      r &&
      [r.lat, r.lon, r.headingRad, r.batteryPct, r.wheelsPct, r.odometerM, r.energyUsedPct].every(
        isNum,
      ) &&
      isNum(s.elapsedS);
    return ok ? { ...s, state: { ...st, deposited: !!st.deposited } } : null;
  } catch {
    return null;
  }
}
export const writeSave = (s: ExpeditionSave): void => write(SAVE_KEY, s);
export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // ignore
  }
}

export function readBest(): number | null {
  try {
    const v = Number(localStorage.getItem(BEST_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}
/** Keeps the time if it is the best; returns whether it was. */
export function recordBest(s: number): boolean {
  const previous = readBest();
  if (previous !== null && previous <= s) return false;
  try {
    localStorage.setItem(BEST_KEY, String(Math.round(s)));
  } catch {
    // ignore
  }
  return true;
}

/** Clears the career, the saved expedition and the best times (the options and photos stay). */
export function resetProgress(): void {
  try {
    localStorage.removeItem(CAREER_KEY);
    localStorage.removeItem(SAVE_KEY);
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(BEST_PREFIX)) localStorage.removeItem(k);
    }
  } catch {
    // ignore
  }
}
