import type { SampleSite } from '../data/surfaceData';
import { groundDistanceM, type RoverState } from './roverSim';
import type { RockType } from './science';

/**
 * The game's missions. Each is one real episode of Perseverance's mission on its own map, played in
 * chapters of objectives that follow what the rover really did there; every place is real.
 * - landing: Octavia E. Butler Landing, 18 Feb 2021, and the landing hardware where HiRISE saw it
 *   the next day (data/catalog/landing-hardware.json). Opens with NASA's landing video.
 * - ingenuity: Wright Brothers Field, March–April 2021: one press there runs the deployment by
 *   itself (debris shield off, helicopter upright, set down, the rover driving clear), then NASA's
 *   video of the first flight from Van Zyl Overlook (data/catalog/ingenuity-deploy.json).
 * - delta: the delta front of Jezero, driven as Perseverance did between sols 408 and 693 (April
 *   2022 – February 2023): arrival at the front, the climb up Hawksbill Gap, back down to Amalik,
 *   Hidden Harbor and Observation Mountain, and the Three Forks sample depot. Sample sites
 *   (MMGIS), the rover's waypoints, the Mastcam-Z panorama spots and Ingenuity's airfields.
 *
 * A progress state names its mission; the rules read the chapters, places and flights from it.
 * Pure: the session feeds it the rover and the player's actions; tested in game.test.ts.
 */

export type MissionId = 'landing' | 'ingenuity' | 'delta';

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

export type TargetKind = 'sample' | 'depot' | 'panorama' | 'reach' | 'station';

/**
 * Steps of a mission, done in order: at a station, a sequence that runs for a time (STEP_S); or a
 * short drive the mission does itself (DRIVE_STEP_M).
 */
export type StepId = 'shield' | 'clear' | 'rotate' | 'drop' | 'away' | 'film';
export type DriveStep = 'clear' | 'away';
export type TimedStep = Exclude<StepId, DriveStep>;
export const isDriveStep = (s: StepId): s is DriveStep => s === 'clear' || s === 'away';
/** Seconds each step's sequence runs (the film: Mastcam-Z turning to the helicopter). */
export const STEP_S: Record<TimedStep, number> = {
  shield: 3,
  rotate: 8,
  drop: 3,
  film: 3,
};
/**
 * The drives (m), from where the shield fell and from where the helicopter was set down: off the
 * shield (about 0.9 m long) so the helicopter does not land on it; and clear of the helicopter, so
 * its solar panel gets the Sun (the rover drove 4.6 m on sol 43).
 */
export const DRIVE_STEP_M: Record<DriveStep, number> = { clear: 1.5, away: 5 };
export const AWAY_M = DRIVE_STEP_M.away;
/** How fast the mission drives the rover (a share of its cruise speed). */
export const DRIVE_STEP_SPEED = 0.15;

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
  /** A station's marker icon. */
  icon?: 'sample' | 'depot' | 'panorama' | 'reach';
}

export const tubesIn = (sampleNumber: string): number => (sampleNumber.match(/\d+/g) ?? []).length;

export interface Spot {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Zone radius (m), when not the kind's default. */
  radiusM?: number;
}

export interface Flight {
  flight: number;
  sol: number;
  date: string;
  lat: number;
  lon: number;
}

export type Objective =
  | { id: string; kind: 'reach'; target: string; optional?: boolean }
  | { id: string; kind: 'sample'; sample: string; optional?: boolean }
  | { id: string; kind: 'panorama'; panorama: string; optional?: boolean }
  | { id: string; kind: 'depot'; optional?: boolean }
  | { id: string; kind: 'laser'; count: number; optional?: boolean }
  | { id: string; kind: 'flight'; count: number; optional?: boolean }
  | StepObjective;

/**
 * A step. `run`: 'chain', it starts by itself once the step before it is done (it is part of that
 * step: not listed, and that step counts as done once its chain is); 'arrive', it starts by
 * itself when the rover stops in the station's zone (the rover brakes there). Otherwise the
 * action key starts it.
 */
export interface StepObjective {
  id: string;
  kind: 'step';
  step: StepId;
  at?: string;
  run?: 'chain' | 'arrive';
  optional?: boolean;
}

export interface Chapter {
  id: string;
  /** Sols of the real mission the chapter follows. */
  sols: [number, number];
  objectives: Objective[];
}

/** Landing hardware lying on the map (drawn by world/landing.ts). */
export interface Hardware {
  id: 'parachute' | 'backshell' | 'descent-stage' | 'heat-shield';
  lat: number;
  lon: number;
}

export interface MissionDef {
  id: MissionId;
  /** Terrain area (data/build/game/areas.json). */
  areaId: string;
  start: { lat: number; lon: number; headingDeg: number };
  chapters: Chapter[];
  reach: Spot[];
  panoramas: Spot[];
  depot: { lat: number; lon: number; radiusM: number } | null;
  flights: Flight[];
  /** Samples already in the rack when the mission starts. */
  earlierSamples: string[];
  /** Sols of Perseverance's real route shown on the map (and kept free of generated ledges). */
  routeSols: [number, number] | null;
  /** NASA video played before the first chapter. */
  intro?: 'landing';
  /** NASA video played when the 'film' step is done (and offered again once seen). */
  film?: 'firstFlight';
  hardware?: Hardware[];
  /** The rover's landing blast: the descent stage's engines scoured the ground under it. */
  blast?: { lat: number; lon: number };
  /** Places where steps are done (by id; the step objectives name them with `at`). */
  stations?: Array<Spot & { icon: 'sample' | 'depot' | 'panorama' | 'reach' }>;
  /** Ingenuity rides under the rover at the start (the deployment mission). */
  stowedHelicopter?: boolean;
}

// ---------- the delta front ----------

/** Ingenuity's flights over the delta (ingenuity.json): each lands at the next airfield. */
export const FLIGHTS: Flight[] = [
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
];
/** The rover must come this close for Ingenuity to fly its next flight. */
export const FLIGHT_TRIGGER_M = 70;

export const DELTA: MissionDef = {
  id: 'delta',
  areaId: 'delta',
  /** Where Perseverance entered the area on sol 408, driving west from the crater floor. */
  start: { lat: 18.453833, lon: 77.414136, headingDeg: 272 },
  chapters: [
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
  ],
  /** The delta front at Enchanted Lake (rover waypoint, sol 422). */
  reach: [{ id: 'enchanted-lake', name: 'Enchanted Lake', lat: 18.4506, lon: 77.4014 }],
  /** Real Mastcam-Z 360° panoramas of the area: where they were taken (panoramas.json). */
  panoramas: [
    { id: 'wildcat-ridge', name: 'Wildcat Ridge', lat: 18.458647, lon: 77.405925 },
    { id: 'enchanted-lake', name: 'Enchanted Lake', lat: 18.450726, lon: 77.40144 },
    { id: 'three-forks', name: 'Three Forks', lat: 18.452813, lon: 77.408244 },
  ],
  /** Three Forks depot: centroid of its MMGIS polygon; the drop zone covers the ~70 m footprint. */
  depot: { lat: 18.45296, lon: 77.40821, radiusM: 40 },
  flights: FLIGHTS,
  /** Samples cored on the crater floor before the rover reached the delta. */
  earlierSamples: ['1', '2 & 3', '4 & 5', '6 & 7', '8 & 9'],
  routeSols: [404, 700],
};

// ---------- the landing ----------

/** Landing hardware where HiRISE saw it on 19 Feb 2021 (data/catalog/landing-hardware.json). */
export const LANDING_HARDWARE: Hardware[] = [
  { id: 'parachute', lat: 18.452209, lon: 77.432098 },
  { id: 'backshell', lat: 18.451776, lon: 77.431713 },
  { id: 'descent-stage', lat: 18.45224, lon: 77.441434 },
  { id: 'heat-shield', lat: 18.455335, lon: 77.474436 },
];

export const LANDING: MissionDef = {
  id: 'landing',
  areaId: 'landing',
  /**
   * Octavia E. Butler Landing: the rover's first logged position (MMGIS, sol 13, before its first
   * drive), facing the way it set off.
   */
  start: { lat: 18.444627, lon: 77.450886, headingDeg: 300 },
  chapters: [
    {
      // Sols 0–14: touchdown, the first look round, SuperCam's first shots, the first drive.
      id: 'touchdown',
      sols: [0, 14],
      objectives: [
        { id: 'landing-laser', kind: 'laser', count: 1 },
        { id: 'descent-stage', kind: 'reach', target: 'descent-stage' },
      ],
    },
    {
      // The hardware that brought the rover down: Ingenuity photographed it on 19 Apr 2022.
      id: 'hardware',
      sols: [15, 420],
      objectives: [
        { id: 'parachute', kind: 'reach', target: 'parachute' },
        { id: 'heat-shield', kind: 'reach', target: 'heat-shield', optional: true },
      ],
    },
  ],
  reach: [
    { id: 'descent-stage', name: 'Descent stage', lat: 18.45224, lon: 77.441434, radiusM: 30 },
    { id: 'parachute', name: 'Parachute and backshell', lat: 18.45199, lon: 77.431905, radiusM: 35 },
    { id: 'heat-shield', name: 'Heat shield', lat: 18.455335, lon: 77.474436, radiusM: 25 },
  ],
  panoramas: [],
  depot: null,
  flights: [],
  earlierSamples: [],
  routeSols: [13, 120],
  intro: 'landing',
  hardware: LANDING_HARDWARE,
  blast: { lat: 18.444627, lon: 77.450886 },
};

// ---------- Ingenuity's deployment and first flight ----------

/**
 * Wright Brothers Field: where Perseverance set Ingenuity down on sol 43 (3 April 2021), the
 * helicopter's first logged position (MMGIS ingenuity.json, "flight 0"); the rover had parked over
 * it on sol 34. Van Zyl Overlook: the rover's position from sol 52 to the first flight (sol 58),
 * 64 m away (NASA: 64.3 m).
 */
export const WRIGHT_FIELD = { lat: 18.444863, lon: 77.451019 };
export const VAN_ZYL = { lat: 18.444752, lon: 77.45214 };

export const INGENUITY_MISSION: MissionDef = {
  id: 'ingenuity',
  areaId: 'landing',
  /** The rover's position on sols 29–30 (21 March 2021), about 90 m from the airfield. */
  start: { lat: 18.445164, lon: 77.451822, headingDeg: 250 },
  chapters: [
    {
      // Sols 30–43 in one press at the airfield: the shield comes off, the helicopter is turned
      // upright with its legs out and released, and the rover drives clear. (The shield really
      // came off on sol 30 where the mission starts; here it falls at the field, and the rover
      // rolls off it before the helicopter is set down.)
      id: 'deploy',
      sols: [30, 43],
      objectives: [
        { id: 'deploy-heli', kind: 'step', step: 'shield', at: 'field' },
        { id: 'clear-shield', kind: 'step', step: 'clear', run: 'chain' },
        { id: 'rotate-heli', kind: 'step', step: 'rotate', at: 'field', run: 'chain' },
        { id: 'drop-heli', kind: 'step', step: 'drop', at: 'field', run: 'chain' },
        { id: 'drive-away', kind: 'step', step: 'away', run: 'chain' },
      ],
    },
    {
      // Sols 44–58: to Van Zyl Overlook, where Mastcam-Z filmed the first flight (NASA's video).
      id: 'firstFlight',
      sols: [44, 58],
      objectives: [{ id: 'film-flight', kind: 'step', step: 'film', at: 'overlook', run: 'arrive' }],
    },
  ],
  reach: [],
  panoramas: [],
  depot: null,
  flights: [],
  earlierSamples: [],
  routeSols: [29, 58],
  film: 'firstFlight',
  stations: [
    // The airfield is about 10 × 10 m: park near its centre.
    { id: 'field', name: 'Wright Brothers Field', ...WRIGHT_FIELD, radiusM: 4, icon: 'depot' },
    { id: 'overlook', name: 'Van Zyl Overlook', ...VAN_ZYL, radiusM: 9, icon: 'panorama' },
  ],
  stowedHelicopter: true,
};

export const MISSIONS: Record<MissionId, MissionDef> = {
  landing: LANDING,
  ingenuity: INGENUITY_MISSION,
  delta: DELTA,
};
export const missionOf = (s: { mission?: MissionId }): MissionDef => MISSIONS[s.mission ?? 'delta'];

/** The delta's definitions under their earlier names (the delta was the game's only map). */
export const AREA_ID = DELTA.areaId;
export const START = DELTA.start;
export const DEPOT = DELTA.depot!;
export const CHAPTERS = DELTA.chapters;
export const PANORAMA_SPOTS = DELTA.panoramas;
export const REACH_SPOTS = DELTA.reach;
export const EARLIER_SAMPLES = DELTA.earlierSamples;

// ---------- progress ----------

/** The player's progress through a mission (saved in the browser). */
export interface ExpeditionState {
  /** Missing in saves from before there were several missions: the delta. */
  mission?: MissionId;
  chapter: number;
  /** Sample sites cored (by sample number entry, e.g. "10 & 11"). */
  samples: string[];
  panoramas: string[];
  reached: string[];
  deposited: boolean;
  /** Ingenuity flights watched (flight numbers); the helicopter is at the last one's airfield. */
  flights: number[];
  /** Rocks analysed with SuperCam during this mission, and the science points earned. */
  finds: Find[];
  science: number;
  /** Steps done (deployment mission); missing in older saves. */
  steps?: StepId[];
  /** Where Ingenuity was set down (the rover's position then). */
  dropAt?: { lat: number; lon: number };
  /** Where the debris shield fell (the rover's position then). */
  shieldAt?: { lat: number; lon: number };
}

export interface Find {
  type: RockType;
  /** Rock key (area and position), for its spectrum. */
  key: string;
  points: number;
  first: boolean;
}

export const newExpedition = (mission: MissionId = 'delta'): ExpeditionState => ({
  mission,
  chapter: 0,
  samples: [],
  panoramas: [],
  reached: [],
  deposited: false,
  flights: [],
  finds: [],
  science: 0,
  steps: [],
});

/** Flights watched within a chapter's sols (flight objectives count only the chapter's own). */
const flightsIn = (s: ExpeditionState, c: Chapter) =>
  s.flights.filter((n) => {
    const f = missionOf(s).flights.find((x) => x.flight === n);
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
    case 'step': {
      const steps = s.steps ?? [];
      if (!steps.includes(o.step)) return false;
      if (o.run === 'chain') return true;
      // A step with a chain after it is done once the chain is.
      const i = c.objectives.indexOf(o);
      for (const n of c.objectives.slice(i + 1)) {
        if (n.kind !== 'step' || n.run !== 'chain') break;
        if (!steps.includes(n.step)) return false;
      }
      return true;
    }
  }
}

/** The objectives a chapter lists (a chain's steps are part of the step before them). */
export const listedObjectives = (c: Chapter): Objective[] =>
  c.objectives.filter((o) => !(o.kind === 'step' && o.run === 'chain'));

/** The current chapter's next step (steps are done in order), or null. */
export function nextStep(s: ExpeditionState): StepObjective | null {
  const c = missionOf(s).chapters[s.chapter];
  const done = s.steps ?? [];
  for (const o of c?.objectives ?? []) if (o.kind === 'step' && !done.includes(o.step)) return o;
  return null;
}

/**
 * The drive under way, when the next step is one: where it is measured from and how far it goes.
 * The mission drives the rover (straight, slowly) until it is done.
 */
export function driveStep(
  s: ExpeditionState,
): { step: DriveStep; from: { lat: number; lon: number }; m: number } | null {
  const o = nextStep(s);
  if (!o || !isDriveStep(o.step)) return null;
  const from = (o.step === 'clear' ? s.shieldAt : s.dropAt) ?? WRIGHT_FIELD;
  return { step: o.step, from, m: DRIVE_STEP_M[o.step] };
}

/** The mission has the wheel: a chain is under way (the player only watches). */
export const chainUnderWay = (s: ExpeditionState): boolean => nextStep(s)?.run === 'chain';

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
  const c = missionOf(s).chapters[i];
  return !!c && c.objectives.every((o) => o.optional || objectiveDone(s, o, c));
};

export const expeditionDone = (s: ExpeditionState): boolean => {
  const n = missionOf(s).chapters.length;
  return s.chapter >= n - 1 && chapterDone(s, n - 1);
};

/** Every place of a mission's map as a target (samples from the catalogue). */
export function allTargets(samples: SampleSite[], m: MissionDef = DELTA): Target[] {
  const out: Target[] = [];
  for (const r of m.reach)
    out.push({
      id: `reach-${r.id}`,
      kind: 'reach',
      name: r.name,
      lat: r.lat,
      lon: r.lon,
      radiusM: r.radiusM ?? REACH_RADIUS_M,
      tubes: 0,
    });
  for (const c of m.chapters)
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
  for (const p of m.panoramas)
    out.push({
      id: `pano-${p.id}`,
      kind: 'panorama',
      name: p.name,
      lat: p.lat,
      lon: p.lon,
      radiusM: p.radiusM ?? PANORAMA_RADIUS_M,
      tubes: 0,
      panoramaId: p.id,
    });
  if (m.depot) out.push({ id: 'depot', kind: 'depot', name: 'Three Forks', ...m.depot, tubes: 0 });
  for (const st of m.stations ?? [])
    out.push({
      id: `station-${st.id}`,
      kind: 'station',
      name: st.name,
      lat: st.lat,
      lon: st.lon,
      radiusM: st.radiusM ?? REACH_RADIUS_M,
      tubes: 0,
      icon: st.icon,
    });
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
          : o.kind === 'step' && o.at
            ? `station-${o.at}`
            : null;

export const targetOf = (o: Objective, targets: Target[]): Target | undefined => {
  const id = targetFor(o);
  return id ? targets.find((t) => t.id === id) : undefined;
};

export function isDone(s: ExpeditionState, t: Target): boolean {
  if (t.kind === 'reach') return s.reached.includes(t.id.slice('reach-'.length));
  if (t.kind === 'sample') return s.samples.includes(t.site?.sampleNumber ?? '');
  if (t.kind === 'panorama') return s.panoramas.includes(t.panoramaId ?? '');
  if (t.kind === 'station') {
    // Done once the chapter has no step left there.
    const c = missionOf(s).chapters[s.chapter];
    const at = t.id.slice('station-'.length);
    return !c?.objectives.some(
      (o) => o.kind === 'step' && o.at === at && !(s.steps ?? []).includes(o.step),
    );
  }
  return s.deposited;
}

/** The step to do at a station now (the chapter's next step, when it is done there), or null. */
export function stationStep(s: ExpeditionState, t: Target): StepObjective | null {
  const o = nextStep(s);
  return o && o.at === t.id.slice('station-'.length) ? o : null;
}

/**
 * Targets open now: the current chapter's (main and optional), plus every panorama spot not yet
 * photographed (a discovery off the main path). Later chapters stay hidden.
 */
export function openTargets(s: ExpeditionState, targets: Target[]): Target[] {
  const c = missionOf(s).chapters[s.chapter];
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
  const c = missionOf(s).chapters[s.chapter];
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
  const rank: Record<TargetKind, number> = { sample: 0, station: 1, depot: 2, panorama: 3, reach: 4 };
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

export type ActionKind = 'core' | 'deposit' | 'panorama' | TimedStep;
export interface Action {
  targetId: string;
  kind: ActionKind;
  heldS: number;
}

export const actionSeconds = (k: ActionKind): number =>
  k === 'core'
    ? CORE_S
    : k === 'panorama'
      ? PANORAMA_S
      : k === 'deposit'
        ? DEPOSIT_S
        : STEP_S[k];

export type ExpeditionEvent =
  | { kind: 'reached'; target: Target }
  | { kind: 'collected'; target: Target }
  | { kind: 'panorama'; target: Target }
  | { kind: 'deposited'; target: Target }
  | { kind: 'step'; step: StepId; target: Target | null }
  | { kind: 'chapter'; chapter: number }
  | { kind: 'complete' };

/**
 * One step: reaching a place is enough for a 'reach' target; elsewhere, pressing the action key
 * stopped in a target's ring starts its sequence (core, panorama, drop), which then runs to its
 * end. Mission steps run in order: a chain's steps start by themselves (its drives end at their
 * distance), an 'arrive' step when the rover stops in its zone. A chapter whose main objectives
 * are all done opens the next one.
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
  // A drive of a chain (off the shield, clear of the helicopter): done at its distance.
  const drive = driveStep(state);
  if (drive && groundDistanceM(rover, drive.from) >= drive.m) {
    state = { ...state, steps: [...(state.steps ?? []), drive.step] };
    events.push({ kind: 'step', step: drive.step, target: null });
  }
  const running = action && targets.find((t) => t.id === action.targetId);
  const stopped = Math.abs(rover.speed) <= STOPPED_MPS && !rover.recharging;
  // A step that starts by itself: the next of a chain, or one the rover has stopped at.
  const due = nextStep(state);
  const dueAt = due?.run && due.at && !isDriveStep(due.step) ? targetOf(due, targets) : undefined;
  const auto =
    !running &&
    stopped &&
    dueAt &&
    (due!.run === 'chain' || groundDistanceM(rover, dueAt) <= dueAt.radiusM)
      ? dueAt
      : null;
  const here =
    running ||
    auto ||
    targetHere(
      rover,
      open.filter((t) => t.kind !== 'reach'),
    );
  let next: Action | null = action;
  if (running || auto || (pressed && here && stopped)) {
    const t = here!;
    const pressStep = t.kind === 'station' ? stationStep(state, t) : null;
    const kind: ActionKind | null = running
      ? action!.kind
      : auto
        ? (due!.step as TimedStep)
        : t.kind === 'depot'
          ? 'deposit'
          : t.kind === 'panorama'
            ? 'panorama'
            : t.kind === 'station'
              ? pressStep && !pressStep.run && !isDriveStep(pressStep.step)
                ? pressStep.step
                : null
              : 'core';
    if (!kind) {
      const adv = advance(state, s, events);
      return { state: adv.state, action: null, events: adv.events };
    }
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
      } else if (t.kind === 'station') {
        const step = kind as StepId;
        const where = { lat: rover.lat, lon: rover.lon };
        state = {
          ...state,
          steps: [...(state.steps ?? []), step],
          // Where the shield fell and the helicopter was set down (under the rover), for the
          // drives off and clear of them.
          ...(step === 'shield' ? { shieldAt: where } : {}),
          ...(step === 'drop' ? { dropAt: where } : {}),
        };
        events.push({ kind: 'step', step, target: t });
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
 * one's main objectives are done, and ends the mission when the last one's are.
 */
export function advance(
  s: ExpeditionState,
  before: ExpeditionState,
  events: ExpeditionEvent[] = [],
): { state: ExpeditionState; events: ExpeditionEvent[] } {
  let state = s;
  const n = missionOf(s).chapters.length;
  while (chapterDone(state) && state.chapter < n - 1) {
    state = { ...state, chapter: state.chapter + 1 };
    events.push({ kind: 'chapter', chapter: state.chapter });
  }
  if (expeditionDone(state) && !expeditionDone(before)) events.push({ kind: 'complete' });
  return { state, events };
}

// ---------- Ingenuity ----------

/**
 * Ingenuity in a chapter: the index (in the mission's flights) of the airfield it sits at, and the
 * flight it flies next (null when it has no more flights in this chapter). Before the chapter's
 * first sol it catches up to where it really was; chapters before its first flight here have no
 * helicopter.
 */
export function ingenuity(s: ExpeditionState): { at: number; next: number | null } | null {
  const m = missionOf(s);
  const c = m.chapters[s.chapter];
  if (!c || m.flights.length === 0) return null;
  const watched = s.flights.length ? Math.max(...s.flights) : 0;
  let at = -1;
  m.flights.forEach((f, i) => {
    if (f.sol <= c.sols[0] || f.flight <= watched) at = i;
  });
  if (at < 0) return null;
  const n = m.flights[at + 1];
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
 * Perseverance's 38 sample tubes: those filled before this mission, the ones cored in it, and the
 * empty ones. At Three Forks one tube of each pair cored there is left behind.
 */
export function tubeRack(s: ExpeditionState): Tube[] {
  const earlier = missionOf(s).earlierSamples;
  const out: Tube[] = [];
  for (const e of [...earlier, ...s.samples]) {
    const numbers = e.match(/\d+/g) ?? [];
    numbers.forEach((n, i) =>
      out.push({
        number: n,
        entry: e,
        earlier: earlier.includes(e),
        depot: s.deposited && !earlier.includes(e) && numbers.length > 1 && i === 1,
      }),
    );
  }
  while (out.length < SAMPLE_TUBES)
    out.push({ number: null, entry: null, earlier: false, depot: false });
  return out;
}
