import type { SampleSite } from '../data/surfaceData';
import { groundDistanceM, type RoverState } from './roverSim';

/**
 * Missions of the rover game: real Perseverance sample sites (MMGIS positions), driven in any order.
 * All lie on the 1 m terrain model (the route-planning area); the crater-rim samples do not.
 */
export type MissionId = 'floor' | 'delta' | 'margin';

export interface MissionDef {
  id: MissionId;
  start: { lat: number; lon: number };
  /** Entries of samples.json (one site may hold two cores, e.g. "2 & 3"). */
  sampleNumbers: string[];
  /** Finish by leaving the tubes at the Three Forks depot. */
  depot: boolean;
}

export const MISSIONS: MissionDef[] = [
  {
    // Crater floor, from the landing site (sols 164–377 for the real rover).
    id: 'floor',
    start: { lat: 18.44457, lon: 77.45091 },
    sampleNumbers: ['1', '2 & 3', '4 & 5', '6 & 7', '8 & 9'],
    depot: false,
  },
  {
    // Delta front, arriving from the south-east as Perseverance did, then the depot.
    id: 'delta',
    start: { lat: 18.4485, lon: 77.4135 },
    sampleNumbers: ['10 & 11', '12 & 13', '14 & 15', '16', '17 & 18'],
    depot: true,
  },
  {
    // From the climb onto the delta (the rover's sol 713 position) along the margin to Neretva
    // Vallis (sols 749–1215).
    id: 'margin',
    start: { lat: 18.46404, lon: 77.402097 },
    sampleNumbers: ['19', '20', '21', '22', '23', '24', '25'],
    depot: false,
  },
];

/** Three Forks depot: centroid of its MMGIS polygon; the drop zone covers the ~70 m footprint. */
export const DEPOT = { lat: 18.45296, lon: 77.40821, radiusM: 40 };
export const SAMPLE_RADIUS_M = 14;
/** The rover must be (nearly) stopped to core or drop tubes. */
export const STOPPED_MPS = 0.3;
export const CORE_S = 2.5;
export const DEPOSIT_S = 2;
/** Battery used by one coring (drill, percussion and sealing). */
export const CORE_COST_PCT = 4;

export interface Target {
  id: string;
  kind: 'sample' | 'depot';
  name: string;
  lat: number;
  lon: number;
  radiusM: number;
  /** Sample tubes filled here (cores per site). */
  tubes: number;
  site?: SampleSite;
}

export const tubesIn = (sampleNumber: string): number => (sampleNumber.match(/\d+/g) ?? []).length;

export function missionTargets(mission: MissionDef, samples: SampleSite[]): Target[] {
  const out: Target[] = [];
  for (const n of mission.sampleNumbers) {
    const site = samples.find((s) => s.sampleNumber === n);
    if (!site) continue;
    out.push({
      id: `sample-${n}`,
      kind: 'sample',
      name: site.name,
      lat: site.lat,
      lon: site.lon,
      radiusM: SAMPLE_RADIUS_M,
      tubes: tubesIn(n),
      site,
    });
  }
  if (mission.depot)
    out.push({ id: 'depot', kind: 'depot', name: 'Three Forks', ...DEPOT, tubes: 0 });
  return out;
}

/** Sols on which the real rover took the mission's first and last samples. */
export function realSols(targets: Target[]): [number, number] | null {
  const sols = targets.flatMap((t) => (t.site?.sol.match(/\d+/g) ?? []).map(Number));
  return sols.length ? [Math.min(...sols), Math.max(...sols)] : null;
}

export interface Progress {
  collected: string[];
  deposited: boolean;
  /** The coring or tube drop in progress. */
  action: { targetId: string; kind: 'core' | 'deposit'; heldS: number } | null;
}

export const newProgress = (): Progress => ({ collected: [], deposited: false, action: null });

const samplesDone = (targets: Target[], p: Progress) =>
  targets.every((t) => t.kind !== 'sample' || p.collected.includes(t.id));

export function isComplete(targets: Target[], p: Progress): boolean {
  const depot = targets.some((t) => t.kind === 'depot');
  return samplesDone(targets, p) && (!depot || p.deposited);
}

/** Targets still to do; the depot only once every sample is in. */
export function remaining(targets: Target[], p: Progress): Target[] {
  const done = samplesDone(targets, p);
  return targets.filter((t) =>
    t.kind === 'sample' ? !p.collected.includes(t.id) : done && !p.deposited,
  );
}

/** The remaining target whose zone the rover is in (whatever its speed), if any. */
export function targetHere(rover: RoverState, targets: Target[], p: Progress): Target | null {
  let best: Target | null = null;
  let bestD = Infinity;
  for (const t of remaining(targets, p)) {
    const d = groundDistanceM(rover, t);
    if (d <= t.radiusM && d < bestD) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

/** Nearest remaining target (the one the HUD points to). */
export function nearestRemaining(rover: RoverState, targets: Target[], p: Progress): Target | null {
  let best: Target | null = null;
  let bestD = Infinity;
  for (const t of remaining(targets, p)) {
    const d = groundDistanceM(rover, t);
    if (d < bestD) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

export type ProgressEvent = { kind: 'collected'; target: Target } | { kind: 'deposited' } | null;

/**
 * Holding the action key at a target, stopped, cores the sample (or drops the tubes at the depot).
 * Releasing it, moving or leaving the zone cancels the action in progress.
 */
export function stepProgress(
  p: Progress,
  rover: RoverState,
  targets: Target[],
  held: boolean,
  dt: number,
): { progress: Progress; event: ProgressEvent } {
  const here = targetHere(rover, targets, p);
  if (!held || !here || Math.abs(rover.speed) > STOPPED_MPS || rover.recharging) {
    return { progress: p.action ? { ...p, action: null } : p, event: null };
  }
  const kind = here.kind === 'depot' ? 'deposit' : 'core';
  const heldS = (p.action?.targetId === here.id ? p.action.heldS : 0) + dt;
  const needed = kind === 'core' ? CORE_S : DEPOSIT_S;
  if (heldS < needed)
    return { progress: { ...p, action: { targetId: here.id, kind, heldS } }, event: null };
  if (kind === 'deposit')
    return { progress: { ...p, deposited: true, action: null }, event: { kind: 'deposited' } };
  return {
    progress: { ...p, collected: [...p.collected, here.id], action: null },
    event: { kind: 'collected', target: here },
  };
}
