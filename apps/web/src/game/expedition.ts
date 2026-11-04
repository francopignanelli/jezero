import type { SampleSite } from '../data/surfaceData';
import { groundDistanceM, type RoverState } from './roverSim';
import type { RockType } from './science';

/**
 * The game's one map: the delta front of Jezero, driven as Perseverance did between sols 408 and
 * 693 (April 2022 – February 2023). Four chapters follow the real campaign: arrival at the front,
 * the climb up Hawksbill Gap, back down to Amalik, Hidden Harbor and Observation Mountain, and the
 * Three Forks sample depot. Every place is real: sample sites (MMGIS), the rover's waypoints, the
 * Mastcam-Z panorama spots and Ingenuity's airfields.
 *
 * Pure: the session feeds it the rover and the player's actions; tested in game.test.ts.
 */

export const AREA_ID = 'delta';

/** Where Perseverance entered the area on sol 408, driving west from the crater floor. */
export const START = { lat: 18.453833, lon: 77.414136, headingDeg: 272 };

/** Three Forks depot: centroid of its MMGIS polygon; the drop zone covers the ~70 m footprint. */
export const DEPOT = { lat: 18.45296, lon: 77.40821, radiusM: 40 };
export const SAMPLE_RADIUS_M = 14;
export const PANORAMA_RADIUS_M = 12;
export const REACH_RADIUS_M = 25;
/** The rover must be (nearly) stopped to core, take a panorama or drop tubes. */
export const STOPPED_MPS = 0.3;
/**
 * One press of the action key runs the whole sequence (seconds): the arm unfolds, the drill cores,
 * the arm folds back; the mast turns full circle for a panorama.
 */
export const CORE_S = 6;
export const PANORAMA_S = 7;
export const DEPOSIT_S = 2.5;
/** Battery used by one coring (drill, percussion and sealing). */
export const CORE_COST_PCT = 4;
/** Perseverance carries 43 tubes: 38 for samples and 5 witness tubes. */
export const SAMPLE_TUBES = 38;
export const WITNESS_TUBES = 5;
/** Samples cored on the crater floor before the rover reached the delta (already in the rack). */
export const EARLIER_SAMPLES = ['1', '2 & 3', '4 & 5', '6 & 7', '8 & 9'];

export type TargetKind = 'sample' | 'depot' | 'panorama' | 'reach';

export interface Target {
  id: string;
  kind: TargetKind;
  name: string;
  lat: number;
  lon: number;
  radiusM: number;
  /** Sample tubes filled here (cores per site). */
  tubes: number;
  site?: SampleSite;
  /** Panorama id (data/catalog/panoramas.json). */
  panoramaId?: string;
}

export const tubesIn = (sampleNumber: string): number => (sampleNumber.match(/\d+/g) ?? []).length;

/** Real Mastcam-Z 360° panoramas of the area: where they were taken (panoramas.json). */
export const PANORAMA_SPOTS = [
  { id: 'wildcat-ridge', name: 'Wildcat Ridge', lat: 18.458647, lon: 77.405925 },
  { id: 'enchanted-lake', name: 'Enchanted Lake', lat: 18.450726, lon: 77.40144 },
  { id: 'three-forks', name: 'Three Forks', lat: 18.452813, lon: 77.408244 },
] as const;

/** Places to reach: the delta front at Enchanted Lake (rover waypoint, sol 422). */
export const REACH_SPOTS = [
  { id: 'enchanted-lake', name: 'Enchanted Lake', lat: 18.4506, lon: 77.4014 },
] as const;

/**
 * Ingenuity's flights over the area (ingenuity.json): each lands at the next airfield. The
 * helicopter flies the next one when the rover comes close, in the chapter it belongs to.
 */
export const FLIGHTS = [
  { flight: 30, sol: 533, date: '2022-08-20', lat: 18.455974, lon: 77.417643 },
  { flight: 31, sol: 550, date: '2022-09-06', lat: 18.455825, lon: 77.415908 },
  { flight: 32, sol: 561, date: '2022-09-17', lat: 18.455925, lon: 77.414231 },
  { flight: 33, sol: 567, date: '2022-09-24', lat: 18.455623, lon: 77.412264 },
  { flight: 34, sol: 625, date: '2022-11-22', lat: 18.455621, lon: 77.412266 },
  { flight: 35, sol: 635, date: '2022-12-03', lat: 18.455814, lon: 77.412093 },
  { flight: 36, sol: 642, date: '2022-12-10', lat: 18.455805, lon: 77.412086 },
  { flight: 37, sol: 649, date: '2022-12-17', lat: 18.456524, lon: 77.411524 },
  { flight: 38, sol: 667, date: '2023-01-05', lat: 18.457283, lon: 77.409895 },
  { flight: 39, sol: 673, date: '2023-01-11', lat: 18.457264, lon: 77.409884 },
  { flight: 40, sol: 681, date: '2023-01-19', lat: 18.458712, lon: 77.407133 },
  { flight: 41, sol: 689, date: '2023-01-27', lat: 18.459032, lon: 77.407096 },
] as const;
/** The rover must come this close for Ingenuity to fly its next flight. */
export const FLIGHT_TRIGGER_M = 70;

export type Objective =
  | { id: string; kind: 'reach'; target: string; optional?: boolean }
  | { id: string; kind: 'sample'; sample: string; optional?: boolean }
  | { id: string; kind: 'panorama'; panorama: string; optional?: boolean }
  | { id: string; kind: 'depot'; optional?: boolean }
  | { id: string; kind: 'laser'; count: number; optional?: boolean }
  | { id: string; kind: 'flight'; count: number; optional?: boolean };

export type ChapterId = 'arrival' | 'hawksbill' | 'amalik' | 'depot';

export interface Chapter {
  id: ChapterId;
  /** Sols of the real campaign the chapter follows. */
  sols: [number, number];
  objectives: Objective[];
}

export const CHAPTERS: Chapter[] = [
  {
    // Sols 408–436: from the crater floor to the foot of the delta front.
    id: 'arrival',
    sols: [408, 436],
    objectives: [
      { id: 'reach-front', kind: 'reach', target: 'enchanted-lake' },
      { id: 'first-laser', kind: 'laser', count: 1 },
      { id: 'three-lasers', kind: 'laser', count: 3, optional: true },
    ],
  },
  {
    // Sols 436–534: up Hawksbill Gap to Skinner Ridge and Wildcat Ridge (organic molecules).
    id: 'hawksbill',
    sols: [436, 534],
    objectives: [
      { id: 'skinner', kind: 'sample', sample: '10 & 11' },
      { id: 'wildcat', kind: 'sample', sample: '12 & 13' },
      { id: 'pano-wildcat', kind: 'panorama', panorama: 'wildcat-ridge' },
    ],
  },
  {
    // Sols 535–639: back down the front to Amalik, Hidden Harbor and Observation Mountain.
    id: 'amalik',
    sols: [535, 639],
    objectives: [
      { id: 'amalik', kind: 'sample', sample: '14 & 15' },
      { id: 'hidden-harbor', kind: 'sample', sample: '16' },
      { id: 'observation', kind: 'sample', sample: '17 & 18' },
      { id: 'pano-enchanted', kind: 'panorama', panorama: 'enchanted-lake', optional: true },
      { id: 'flight-3', kind: 'flight', count: 1, optional: true },
    ],
  },
  {
    // Sols 648–693: the first sample depot on another planet, at Three Forks.
    id: 'depot',
    sols: [648, 693],
    objectives: [
      { id: 'depot', kind: 'depot' },
      { id: 'pano-forks', kind: 'panorama', panorama: 'three-forks' },
      { id: 'flight-4', kind: 'flight', count: 3, optional: true },
    ],
  },
];

/** The player's progress through the expedition (saved in the browser). */
export interface ExpeditionState {
  chapter: number;
  /** Sample sites cored (by sample number entry, e.g. "10 & 11"). */
  samples: string[];
  panoramas: string[];
  reached: string[];
  deposited: boolean;
  /** Ingenuity flights watched (flight numbers); the helicopter is at the last one's airfield. */
  flights: number[];
  /** Rocks analysed with SuperCam during this expedition, and the science points earned. */
  finds: Find[];
  science: number;
}

export interface Find {
  type: RockType;
  /** Rock key (area and position), for its spectrum. */
  key: string;
  points: number;
  first: boolean;
}

export const newExpedition = (): ExpeditionState => ({
  chapter: 0,
  samples: [],
  panoramas: [],
  reached: [],
  deposited: false,
  flights: [],
  finds: [],
  science: 0,
});

/** Flights watched within a chapter's sols (flight objectives count only the chapter's own). */
const flightsIn = (s: ExpeditionState, c: Chapter) =>
  s.flights.filter((n) => {
    const f = FLIGHTS.find((x) => x.flight === n);
    return !!f && f.sol >= c.sols[0] && f.sol <= c.sols[1];
  }).length;

export function objectiveDone(s: ExpeditionState, o: Objective, c: Chapter): boolean {
  switch (o.kind) {
    case 'reach':
      return s.reached.includes(o.target);
    case 'sample':
      return s.samples.includes(o.sample);
    case 'panorama':
      return s.panoramas.includes(o.panorama);
    case 'depot':
      return s.deposited;
    case 'laser':
      return s.finds.length >= o.count;
    case 'flight':
      return flightsIn(s, c) >= o.count;
  }
}

/** Progress of a counted objective (laser analyses, flights), for the HUD. */
export function objectiveCount(
  s: ExpeditionState,
  o: Objective,
  c: Chapter,
): [number, number] | null {
  if (o.kind === 'laser') return [Math.min(s.finds.length, o.count), o.count];
  if (o.kind === 'flight') return [Math.min(flightsIn(s, c), o.count), o.count];
  return null;
}

export const chapterDone = (s: ExpeditionState, i = s.chapter): boolean => {
  const c = CHAPTERS[i];
  return !!c && c.objectives.every((o) => o.optional || objectiveDone(s, o, c));
};

export const expeditionDone = (s: ExpeditionState): boolean =>
  s.chapter >= CHAPTERS.length - 1 && chapterDone(s, CHAPTERS.length - 1);

/** Every place of the map as a target (samples from the catalogue). */
export function allTargets(samples: SampleSite[]): Target[] {
  const out: Target[] = [];
  for (const r of REACH_SPOTS)
    out.push({
      id: `reach-${r.id}`,
      kind: 'reach',
      name: r.name,
      lat: r.lat,
      lon: r.lon,
      radiusM: REACH_RADIUS_M,
      tubes: 0,
    });
  for (const c of CHAPTERS)
    for (const o of c.objectives) {
      if (o.kind !== 'sample') continue;
      const site = samples.find((x) => x.sampleNumber === o.sample);
      if (!site) continue;
      out.push({
        id: `sample-${o.sample}`,
        kind: 'sample',
        name: site.name,
        lat: site.lat,
        lon: site.lon,
        radiusM: SAMPLE_RADIUS_M,
        tubes: tubesIn(o.sample),
        site,
      });
    }
  for (const p of PANORAMA_SPOTS)
    out.push({
      id: `pano-${p.id}`,
      kind: 'panorama',
      name: p.name,
      lat: p.lat,
      lon: p.lon,
      radiusM: PANORAMA_RADIUS_M,
      tubes: 0,
      panoramaId: p.id,
    });
  out.push({ id: 'depot', kind: 'depot', name: 'Three Forks', ...DEPOT, tubes: 0 });
  return out;
}

const targetFor = (o: Objective): string | null =>
  o.kind === 'reach'
    ? `reach-${o.target}`
    : o.kind === 'sample'
      ? `sample-${o.sample}`
      : o.kind === 'panorama'
        ? `pano-${o.panorama}`
        : o.kind === 'depot'
          ? 'depot'
          : null;

export const targetOf = (o: Objective, targets: Target[]): Target | undefined => {
  const id = targetFor(o);
  return id ? targets.find((t) => t.id === id) : undefined;
};

export function isDone(s: ExpeditionState, t: Target): boolean {
  if (t.kind === 'reach') return s.reached.includes(t.id.slice('reach-'.length));
  if (t.kind === 'sample') return s.samples.includes(t.site?.sampleNumber ?? '');
  if (t.kind === 'panorama') return s.panoramas.includes(t.panoramaId ?? '');
  return s.deposited;
}

/**
 * Targets open now: the current chapter's (main and optional), plus every panorama spot not yet
 * photographed (a discovery off the main path). Later chapters stay hidden.
 */
export function openTargets(s: ExpeditionState, targets: Target[]): Target[] {
  const c = CHAPTERS[s.chapter];
  if (!c) return [];
  const ids = new Set(c.objectives.map(targetFor).filter((x): x is string => !!x));
  return targets.filter((t) => !isDone(s, t) && (ids.has(t.id) || t.kind === 'panorama'));
}

/** The current chapter's first main objective still to do with a place, else an optional one. */
export function nextTarget(
  s: ExpeditionState,
  targets: Target[],
  rover?: RoverState,
): Target | null {
  const c = CHAPTERS[s.chapter];
  if (!c) return null;
  const todo = c.objectives.filter((o) => !objectiveDone(s, o, c));
  const pick = (list: Objective[]) => {
    const places = list.map((o) => targetOf(o, targets)).filter((t): t is Target => !!t);
    if (!rover || places.length < 2) return places[0] ?? null;
    // Nearest first among the open places of the chapter.
    return places.reduce((a, b) =>
      groundDistanceM(rover, a) <= groundDistanceM(rover, b) ? a : b,
    );
  };
  return pick(todo.filter((o) => !o.optional)) ?? pick(todo.filter((o) => o.optional));
}

/**
 * The open target whose zone the rover is in, if any. Where zones overlap (the panoramas were
 * taken where the rover cored, at Wildcat Ridge and Amalik), a sample comes first, then the
 * depot, then a panorama; among equals, the nearest.
 */
export function targetHere(rover: RoverState, open: Target[]): Target | null {
  const rank: Record<TargetKind, number> = { sample: 0, depot: 1, panorama: 2, reach: 3 };
  let best: Target | null = null;
  let bestKey = Infinity;
  for (const t of open) {
    const d = groundDistanceM(rover, t);
    if (d > t.radiusM) continue;
    const key = rank[t.kind] * 1e6 + d;
    if (key < bestKey) {
      best = t;
      bestKey = key;
    }
  }
  return best;
}

export type ActionKind = 'core' | 'deposit' | 'panorama';
export interface Action {
  targetId: string;
  kind: ActionKind;
  heldS: number;
}

export const actionSeconds = (k: ActionKind): number =>
  k === 'core' ? CORE_S : k === 'panorama' ? PANORAMA_S : DEPOSIT_S;

export type ExpeditionEvent =
  | { kind: 'reached'; target: Target }
  | { kind: 'collected'; target: Target }
  | { kind: 'panorama'; target: Target }
  | { kind: 'deposited'; target: Target }
  | { kind: 'chapter'; chapter: number }
  | { kind: 'complete' };

/**
 * One step: reaching a place is enough for a 'reach' target; elsewhere, pressing the action key
 * stopped in a target's ring starts its sequence (core, panorama, drop), which then runs to its
 * end. A chapter whose main objectives are all done opens the next one.
 */
export function stepExpedition(
  s: ExpeditionState,
  action: Action | null,
  rover: RoverState,
  targets: Target[],
  pressed: boolean,
  dt: number,
): { state: ExpeditionState; action: Action | null; events: ExpeditionEvent[] } {
  const events: ExpeditionEvent[] = [];
  const open = openTargets(s, targets);
  let state = s;
  for (const t of open)
    if (t.kind === 'reach' && groundDistanceM(rover, t) <= t.radiusM) {
      state = { ...state, reached: [...state.reached, t.id.slice('reach-'.length)] };
      events.push({ kind: 'reached', target: t });
    }
  const running = action && targets.find((t) => t.id === action.targetId);
  const here =
    running ||
    targetHere(
      rover,
      open.filter((t) => t.kind !== 'reach'),
    );
  let next: Action | null = action;
  if (running || (pressed && here && Math.abs(rover.speed) <= STOPPED_MPS && !rover.recharging)) {
    const t = here!;
    const kind: ActionKind =
      t.kind === 'depot' ? 'deposit' : t.kind === 'panorama' ? 'panorama' : 'core';
    const heldS = (action?.heldS ?? 0) + dt;
    if (heldS < actionSeconds(kind)) next = { targetId: t.id, kind, heldS };
    else {
      next = null;
      if (kind === 'core') {
        state = { ...state, samples: [...state.samples, t.site!.sampleNumber] };
        events.push({ kind: 'collected', target: t });
      } else if (kind === 'panorama') {
        state = { ...state, panoramas: [...state.panoramas, t.panoramaId!] };
        events.push({ kind: 'panorama', target: t });
      } else {
        state = { ...state, deposited: true };
        events.push({ kind: 'deposited', target: t });
      }
    }
  }
  const adv = advance(state, s, events);
  return { state: adv.state, action: next, events: adv.events };
}

/**
 * After a change of progress (from `before` to `s`): opens the next chapter when the current
 * one's main objectives are done, and ends the expedition when the last one's are.
 */
export function advance(
  s: ExpeditionState,
  before: ExpeditionState,
  events: ExpeditionEvent[] = [],
): { state: ExpeditionState; events: ExpeditionEvent[] } {
  let state = s;
  while (chapterDone(state) && state.chapter < CHAPTERS.length - 1) {
    state = { ...state, chapter: state.chapter + 1 };
    events.push({ kind: 'chapter', chapter: state.chapter });
  }
  if (expeditionDone(state) && !expeditionDone(before)) events.push({ kind: 'complete' });
  return { state, events };
}

// ---------- Ingenuity ----------

/**
 * Ingenuity in a chapter: the index (in FLIGHTS) of the airfield it sits at, and the flight it
 * flies next (null when it has no more flights in this chapter). Before the chapter's first sol it
 * catches up to where it really was; chapters before its first flight here have no helicopter.
 */
export function ingenuity(s: ExpeditionState): { at: number; next: number | null } | null {
  const c = CHAPTERS[s.chapter];
  if (!c) return null;
  const watched = s.flights.length ? Math.max(...s.flights) : 0;
  let at = -1;
  FLIGHTS.forEach((f, i) => {
    if (f.sol <= c.sols[0] || f.flight <= watched) at = i;
  });
  if (at < 0) return null;
  const n = FLIGHTS[at + 1];
  return { at, next: n && n.sol <= c.sols[1] ? at + 1 : null };
}

// ---------- the tube rack ----------

export interface Tube {
  /** Sample number (e.g. "12"), or null for an empty tube. */
  number: string | null;
  /** The site's catalogue entry (e.g. "12 & 13"). */
  entry: string | null;
  earlier: boolean;
  /** Left at Three Forks (one tube of each pair). */
  depot: boolean;
}

/**
 * Perseverance's 38 sample tubes: those filled on the crater floor before this map, the ones cored
 * here, and the empty ones. At Three Forks one tube of each pair cored here is left behind.
 */
export function tubeRack(s: ExpeditionState): Tube[] {
  const out: Tube[] = [];
  for (const e of [...EARLIER_SAMPLES, ...s.samples]) {
    const numbers = e.match(/\d+/g) ?? [];
    numbers.forEach((n, i) =>
      out.push({
        number: n,
        entry: e,
        earlier: EARLIER_SAMPLES.includes(e),
        depot: s.deposited && !EARLIER_SAMPLES.includes(e) && numbers.length > 1 && i === 1,
      }),
    );
  }
  while (out.length < SAMPLE_TUBES)
    out.push({ number: null, entry: null, earlier: false, depot: false });
  return out;
}
