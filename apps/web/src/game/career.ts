import type { RockType } from './science';

/**
 * What the player has achieved across missions, kept in the browser (localStorage):
 * - the sample sites ever cored (target ids);
 * - the rock types analysed with the laser, and the rocks already analysed;
 * - the science points.
 * Best times stay under their own keys (session.ts). Also here: the game's options.
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

/** Clears the career and the best times (the options and photos stay). */
export function resetProgress(): void {
  try {
    localStorage.removeItem(CAREER_KEY);
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(BEST_PREFIX)) localStorage.removeItem(k);
    }
  } catch {
    // ignore
  }
}
