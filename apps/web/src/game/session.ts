import { RAD_TO_DEG } from '@copernico/domain';
import i18n from 'i18next';
import { Vector3 } from 'three';
import { DATA_VERSION, dataUrl } from '../config';
import { loadRover, loadSamples, type SampleSite } from '../data/surfaceData';
import { gameAreaAt } from '../data/gameAreas';
import { formatDistance } from '../lib/format';
import { wrapAngle } from '../lib/math';
import { prefersReducedMotion } from '../lib/motion';
import { GameAudio } from './audio';
import {
  clearSave,
  isAnalysed,
  readBest,
  readOptions,
  readSave,
  recordBest,
  recordRock,
  recordSample,
  writeOptions,
  writeSave,
  type ExpeditionSave,
  type GameOptions,
} from './career';
import { Controls, type Command } from './controls';
import {
  CORE_COST_PCT,
  DELTA,
  FLIGHT_26,
  FREE_OF_AREA,
  MOXIE_COST_PCT,
  MOXIE_O2_G,
  airObjectives,
  laserSpotAt,
  newlyDone,
  sampleLockedBy,
  DEPLOY_SLIDES,
  DEPLOY_SLIDE_S,
  DRIVE_STEP_SPEED,
  STEP_S,
  FLIGHT_TRIGGER_M,
  MISSIONS,
  STOPPED_MPS,
  actionSeconds,
  advance,
  aimError,
  allTargets,
  chainUnderWay,
  driveStep,
  expeditionDone,
  ingenuity,
  newExpedition,
  nextStep,
  nextTarget,
  objectiveDone,
  openTargets,
  stationStep,
  stepExpedition,
  targetHere,
  targetOf,
  type Action,
  type DriveStep,
  type ExpeditionEvent,
  type ExpeditionState,
  type MissionDef,
  type MissionId,
  type Target,
} from './expedition';
import { HELI, newHeli, stepHeli, stepPhoto, timeLeftS, type HeliState } from './heli';
import { NavGrid, follow, pathLength, type FollowState, type Point } from './navigation';
import { photoFileName, savePhoto } from './photos';
import {
  bearingRad,
  groundDistanceM,
  initialRover,
  stepRover,
  type Bounds,
  type DriveInput,
  type GroundProbe,
  type RoverState,
} from './roverSim';
import { LASER_COST_PCT, LASER_RANGE_M, LASER_S, POINTS, rockKey, rockType } from './science';
import { EMPTY_HUD, toast, useGame, type ExpeditionResult, type Hud, type Phase } from './store';
import { loadManifest, sampleBilinear, type WorldManifest } from './world/heights';
import type { Rock } from './world/rocks';
import { DRILL_PHASE, World, type PhotoFilter, type Quality } from './world/world';

/**
 * Dust storms (seconds of mission time): the first comes 55–115 s in, each is announced, blows
 * for a while and clears; the next comes 90–180 s later.
 */
const STORM = { firstS: 55, firstJitterS: 60, warnS: 8, activeS: 32, gapS: 90, gapJitterS: 90 };

const HUD_EVERY_S = 0.1;
/** A dust devil can be recorded within this distance (m), for this long (s). */
const DEVIL_RANGE_M = 90;
const DEVIL_RECORD_S = 5;
const SAVE_EVERY_S = 5;
const QUALITY_KEY = 'copernico.game.quality';
/** The rover keeps this far inside the 1 m terrain model (m), on top of roverSim's margin. */
const AREA_MARGIN_M = 40;
/** Simulation speeds offered while AutoNav drives (or the rover waits). */
const WARPS = [1, 2, 4] as const;
/** The mission shown behind the menu: the last one started (kept in the browser). */
const LAST_MISSION_KEY = 'copernico.game.lastMission';
function readLastMission(): MissionId {
  try {
    const m = localStorage.getItem(LAST_MISSION_KEY);
    if (m && m in MISSIONS) return m as MissionId;
  } catch {
    // ignore
  }
  return 'delta';
}
function writeLastMission(m: MissionId): void {
  try {
    localStorage.setItem(LAST_MISSION_KEY, m);
  } catch {
    // ignore
  }
}

/** Each mission's saved chapter (index), for the menu. */
/** Each completed mission's best time (s): the menu marks them done. */
export function bestTimes(): Partial<Record<MissionId, number>> {
  const out: Partial<Record<MissionId, number>> = {};
  for (const id of Object.keys(MISSIONS) as MissionId[]) {
    const b = readBest(id);
    if (b !== null) out[id] = b;
  }
  return out;
}

export function savedChapters(): Partial<Record<MissionId, number>> {
  const out: Partial<Record<MissionId, number>> = {};
  for (const id of Object.keys(MISSIONS) as MissionId[]) {
    const s = readSave(id);
    if (s) out[id] = s.state.chapter;
  }
  return out;
}

export function readQuality(): Quality {
  try {
    const q = localStorage.getItem(QUALITY_KEY);
    if (q === 'high' || q === 'medium' || q === 'low') return q;
  } catch {
    // ignore
  }
  return window.matchMedia('(pointer: coarse)').matches ? 'medium' : 'high';
}
export function writeQuality(q: Quality): void {
  try {
    localStorage.setItem(QUALITY_KEY, q);
  } catch {
    // ignore
  }
}

interface AutoNav {
  goal: { name: string; x: number; north: number; radiusM: number; targetId: string | null };
  path: Point[];
  follow: FollowState;
  /** Progress watch: odometer at the last check and time since. */
  watchOdo: number;
  watchS: number;
  /** Backing away from an obstacle (s left), and how many times it re-planned. */
  backS: number;
  replans: number;
}

/**
 * The rover game: Perseverance on the delta front of Jezero, rebuilt from real data (World), in
 * one expedition of four chapters (expedition.ts). Driven with the keyboard or the touch pad, or
 * by AutoNav. One instance per page.
 */
export class GameSession {
  readonly controls: Controls;
  readonly audio = new GameAudio();
  private manifest: WorldManifest | null = null;
  private samples: SampleSite[] = [];
  private bounds: Bounds = { west: 0, south: 0, east: 0, north: 0 };
  /** Every place of the map, and those open now. */
  private all: Target[] = [];
  private open: Target[] = [];
  private exp: ExpeditionState = newExpedition();
  private action: Action | null = null;
  /** The mission being played (or shown behind the menu), and its area once loaded. */
  private mission: MissionDef = DELTA;
  private areaLoaded: string | null = null;
  private waypoints: Array<[number, number, number, number, number]> = [];
  private rover: RoverState = initialRover(DELTA.start.lat, DELTA.start.lon, 0);
  private elapsedS = 0;
  private running = false;
  private sinceHud = 0;
  private sinceSave = 0;
  private last = 0;
  private raf = 0;
  private destroyed = false;
  private readonly reduced = prefersReducedMotion();
  private labels = new Map<string, HTMLElement>();
  private readonly labelLayer: HTMLElement;
  private readonly onResize = () => this.world.resize();
  /**
   * A chapter opened, or the expedition finished, while a dialog was up: shown after it; and the
   * story cards (NASA's pictures of the moments just done) to show first.
   */
  private pending = { chapter: false, complete: false, stories: [] as string[] };
  /** Ingenuity flown by the player (mission 4), and the camera following it. */
  private pilot: HeliState | null = null;
  private pilotSteer = 0;
  private readonly chase = new Vector3();
  private readonly chaseLook = new Vector3();
  private chaseSet = false;
  /** SuperCam's microphone recording a dust devil (s so far), and when to bring the next one. */
  private recording: number | null = null;
  private devilDueS = 0;
  private panoramaFrom: Phase = 'playing';
  private tubesAt: [number, number, number] | null = null;
  /** Perseverance's real route over this mission's map (lat, lon), for the map. */
  realRoute: Array<[number, number]> = [];

  options: GameOptions = readOptions();
  private storm = { phase: 'clear' as 'clear' | 'warning' | 'active', t: 0, nextS: 0, level: 0 };
  /** SuperCam: the analysis under way, and the rock the view is centred on. */
  private laser: { rock: Rock; key: string; t: number; at: Vector3; pulses: number } | null = null;
  private laserCandidate: Rock | null = null;
  private wearShownS = 0;
  private photoFrom: Phase = 'playing';
  private readonly reticle: HTMLElement;
  private nav: NavGrid | null = null;
  private auto: AutoNav | null = null;
  private warp = 1;
  /** Ingenuity: the airfield it sits at (index in FLIGHTS), the flight under way. */
  private heli: { at: number; next: number | null } | null = null;
  private heliFlying: number | null = null;
  /** Markers: the open places the chapter does not need, and the last look applied. */
  private optionalIds = new Set<string>();
  private lookKey = '';
  private nextId: string | null = null;

  readonly ground: GroundProbe = {
    height: (lat, lon) => {
      const f = this.world.frame;
      if (!f) return undefined;
      const [x, n] = f.toLocal(lat, lon);
      return this.world.surfaceAt(x, n);
    },
    sand: (lat, lon) => {
      const f = this.world.frame;
      if (!f || !this.options.hazards) return 0;
      const [x, n] = f.toLocal(lat, lon);
      return this.world.sandAt(x, n);
    },
    rock: (lat, lon) => {
      const f = this.world.frame;
      if (!f || !this.options.hazards) return 0;
      const [x, n] = f.toLocal(lat, lon);
      return this.world.obstacleLift(x, n);
    },
  };

  private constructor(readonly world: World) {
    this.controls = new Controls((c) => this.command(c));
    this.controls.enabled = false;
    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'game-labels';
    world.host.appendChild(this.labelLayer);
    this.reticle = document.createElement('div');
    this.reticle.className = 'game-reticle';
    this.reticle.style.display = 'none';
    this.labelLayer.appendChild(this.reticle);
    window.addEventListener('resize', this.onResize);
  }

  /** Builds the renderer (synchronously, so a discarded mount can destroy it at once); null without WebGL 2. */
  static open(host: HTMLElement): GameSession | null {
    try {
      return new GameSession(new World(host, readQuality()));
    } catch {
      return null;
    }
  }

  /**
   * The 3D world: the rover and Ingenuity models and the last mission's map, loaded behind the
   * menu (about 11 MB); a mission waits for it. Resolves false if it failed.
   */
  private worldReady: Promise<boolean> = Promise.resolve(false);
  /** A mission was chosen (the menu's scene is then not set up again when the world arrives). */
  private chosen = false;

  /**
   * Loads the small data the menu needs (the places, the samples, the route) and resolves: the menu
   * shows at once. The 3D world then loads behind it (worldReady). Resolves false if data is missing
   * or the session was destroyed.
   */
  async load(): Promise<boolean> {
    try {
      const rovers = Promise.all([
        this.world.loadRover(dataUrl(`models/perseverance.glb?v=${DATA_VERSION}`)),
        this.world.loadIngenuity(dataUrl(`models/ingenuity.glb?v=${DATA_VERSION}`)),
      ]);
      const [manifest, samples, rover] = await Promise.all([
        loadManifest(),
        loadSamples(),
        loadRover(),
      ]);
      if (this.destroyed || !samples) return false;
      this.manifest = manifest;
      this.samples = samples.samples;
      this.waypoints = rover?.waypoints ?? [];
      this.useMission(MISSIONS[readLastMission()]);
      useGame.getState().set({
        phase: 'briefing',
        hasSave: !!readSave('delta'),
        saves: savedChapters(),
        bests: bestTimes(),
        mission: this.mission.id,
      });
      this.worldReady = (async () => {
        await rovers;
        await this.useArea();
        if (this.destroyed) return false;
        if (!this.chosen) this.showcase();
        this.last = performance.now();
        this.raf = requestAnimationFrame(this.loop);
        useGame.getState().set({ worldReady: true });
        return true;
      })().catch((e: unknown) => {
        console.error('[Copernico game] world load failed', e);
        if (!this.destroyed) useGame.getState().set({ phase: 'failed' });
        return false;
      });
      if (import.meta.env.DEV)
        (window as unknown as { __copernicoGame?: unknown }).__copernicoGame = this;
      return true;
    } catch (e) {
      console.error('[Copernico game] load failed', e);
      return false;
    }
  }

  /** Makes a mission current: its places and its part of Perseverance's real route. */
  private useMission(m: MissionDef): void {
    this.mission = m;
    // Place names in the player's language where they are descriptions, not proper names.
    this.all = allTargets(this.samples, m).map((t) => ({
      ...t,
      name: i18n.t(`game.places.${t.id}`, { defaultValue: t.name }),
    }));
    const sols = m.routeSols;
    this.realRoute = sols
      ? this.waypoints.filter((w) => w[0] >= sols[0] && w[0] <= sols[1]).map((w) => [w[1], w[2]])
      : [];
  }

  /** Loads the current mission's area, if it is not the one loaded. */
  private async useArea(): Promise<void> {
    const m = this.mission;
    if (this.areaLoaded === m.areaId) return;
    // Generated craters and ledges keep clear of every place of the map, the start, the airfields
    // and the landing hardware.
    const keepClear = [...this.all, m.start, ...m.flights, ...(m.hardware ?? [])];
    await this.world.loadArea(this.manifest!, m.areaId, keepClear, this.realRoute);
    this.world.setSite(m.hardware ?? null, m.blast ?? null);
    this.areaLoaded = m.areaId;
    this.nav = null;
    const f = this.world.frame!;
    const area = this.manifest!.areas.find((a) => a.id === m.areaId)!;
    const w = area.detail.heights.widthM / 2 - AREA_MARGIN_M;
    const h = area.detail.heights.heightM / 2 - AREA_MARGIN_M;
    const sw = f.toLatLon(-w, -h);
    const ne = f.toLatLon(w, h);
    this.bounds = { west: sw.lon, south: sw.lat, east: ne.lon, north: ne.lat };
  }

  /** The rover parked (where the expedition was left, or at the start), the camera circling it. */
  private showcase(): void {
    const save = readSave(this.mission.id);
    const st = this.mission.start;
    const at = save?.rover ?? { ...st, headingRad: (st.headingDeg * Math.PI) / 180 };
    this.rover = this.settle(initialRover(at.lat, at.lon, at.headingRad));
    this.world.setCameraMode('far');
    this.world.rig.snap(this.rover.headingRad);
    this.world.setWatch(null);
    this.pilot = null;
    this.world.setRoverVisible(!this.mission.pilot);
    this.world.placeIngenuity(null);
    const f = this.world.frame;
    const parked = this.mission.pilot ? { ...st } : this.mission.parkedHelicopter;
    if (f && parked)
      this.world.placeIngenuity(
        f.toLocal(parked.lat, parked.lon),
        (parked.headingDeg * Math.PI) / 180,
      );
    this.world.setRoute(null);
    this.clearLabels();
    useGame.getState().set({
      phase: 'briefing',
      camera: 'chase',
      hasSave: !!readSave('delta'),
      saves: savedChapters(),
      bests: bestTimes(),
      mission: this.mission.id,
      route: null,
    });
  }

  /** Wheels on the ground at once (no easing from height 0). */
  private settle(r: RoverState): RoverState {
    const h = this.ground.height(r.lat, r.lon) ?? 0;
    return stepRover(
      { ...r, heightM: h },
      { throttle: 0, steer: 0, boost: false },
      0.5,
      this.ground,
      this.bounds,
    );
  }

  // ---------- expedition flow ----------

  /** Loads a mission's map (behind a loading screen) when it is not the one shown. */
  private async enterMission(id: MissionId): Promise<boolean> {
    this.chosen = true;
    if (!useGame.getState().worldReady) {
      // Chosen before the world finished loading behind the menu: wait for it.
      useGame.getState().set({ phase: 'loading' });
      if (!(await this.worldReady) || this.destroyed) return false;
    }
    if (this.mission.id === id && this.areaLoaded === this.mission.areaId) return true;
    useGame.getState().set({ phase: 'loading' });
    this.useMission(MISSIONS[id]);
    try {
      await this.useArea();
    } catch (e) {
      console.error('[Copernico game] mission load failed', e);
      useGame.getState().set({ phase: 'failed' });
      return false;
    }
    return !this.destroyed;
  }

  /**
   * Starts a mission at its first chapter (its saved progress is discarded), after NASA's video
   * for the landing.
   */
  async newExpedition(id: MissionId = this.mission.id): Promise<void> {
    if (!(await this.enterMission(id))) return;
    writeLastMission(id);
    clearSave(id);
    this.begin(newExpedition(id), null);
    useGame.getState().set({ phase: this.mission.intro ? 'intro' : 'chapter' });
  }

  /** The landing video ended or was skipped: the first chapter's page. */
  endIntro(): void {
    if (useGame.getState().phase !== 'intro') return;
    useGame.getState().set({ phase: 'chapter' });
  }

  /** NASA's film of the mission (Ingenuity's first flight) ended or was skipped: on to the end. */
  endFilm(): void {
    if (useGame.getState().phase !== 'film') return;
    this.filming = false;
    this.world.setWatch(null);
    this.resume();
  }

  /**
   * Free exploration at a point (a place opened from the planner): on the map that holds it, where
   * it was left if there is a save, the rover set down at the point. False when no map holds it.
   */
  async exploreAt(lat: number, lon: number): Promise<boolean> {
    const area = await gameAreaAt(lat, lon);
    if (!area) return false;
    const id = FREE_OF_AREA[area];
    if (!id) return false;
    if (readSave(id)) await this.continueExpedition(id);
    else await this.newExpedition(id);
    if (this.mission.id !== id || !this.running) return false;
    this.teleport(lat, lon);
    this.save();
    return true;
  }

  /** Continues a mission's saved progress where it was left. */
  async continueExpedition(id: MissionId = this.mission.id): Promise<void> {
    const save = readSave(id);
    if (!save) {
      await this.newExpedition(id);
      return;
    }
    if (!(await this.enterMission(id))) return;
    writeLastMission(id);
    this.begin(save.state, save);
    this.resume();
    toast('game.toast.resumed', { chapter: this.exp.chapter + 1 });
  }

  private begin(state: ExpeditionState, save: ExpeditionSave | null): void {
    this.audio.unlock();
    this.exp = state;
    this.action = null;
    this.pending = { chapter: false, complete: false, stories: [] };
    this.elapsedS = save?.elapsedS ?? 0;
    const st = this.mission.start;
    const at = save?.rover ?? {
      lat: st.lat,
      lon: st.lon,
      headingRad: (st.headingDeg * Math.PI) / 180,
      batteryPct: 100,
      wheelsPct: 100,
      odometerM: 0,
      energyUsedPct: 0,
    };
    this.rover = this.settle({ ...initialRover(at.lat, at.lon, at.headingRad), ...at });
    if (this.pilot)
      this.rover = {
        ...this.rover,
        lat: this.pilot.lat,
        lon: this.pilot.lon,
        headingRad: this.pilot.headingRad,
      };
    this.laser = null;
    this.world.setLaser(null);
    this.stopAutoNav();
    this.warp = 1;
    this.storm = {
      phase: 'clear',
      t: 0,
      // Ingenuity flew in calm air: no storm while it does.
      nextS: this.mission.calm
        ? Infinity
        : this.elapsedS + STORM.firstS + Math.random() * STORM.firstJitterS,
      level: 0,
    };
    this.recording = null;
    this.devilDueS = this.elapsedS + 6;
    // Mission 4: the player flies Ingenuity from its airfield (a flight starts there again).
    this.world.setRoverVisible(!this.mission.pilot);
    this.pilot = this.mission.pilot
      ? newHeli(
          this.mission.start,
          (this.mission.start.headingDeg * Math.PI) / 180,
          FLIGHT_26.seconds,
        )
      : null;
    this.chaseSet = false;
    this.world.setWatch(null);
    this.world.setStorm(0);
    this.world.tracks.clear();
    this.world.depotTubes.clear();
    this.filming = false;
    this.driving = null;
    this.awayShot = false;
    this.world.setWatch(null);
    this.dropHeadingRad = save?.rover.headingRad ?? 0;
    this.tubesAt = save?.tubesAt ?? null;
    if (this.tubesAt && state.deposited) this.world.layTubesAt(...this.tubesAt, this.depotCount());
    this.running = true;
    this.refreshTargets();
    this.world.setCameraMode('chase');
    this.world.rig.snap(this.rover.headingRad, !this.reduced);
    useGame.getState().set({
      expedition: this.exp,
      mission: this.mission.id,
      camera: 'chase',
      finding: null,
      card: null,
      panorama: null,
      result: null,
      toast: null,
      hud: EMPTY_HUD,
    });
  }

  /** The open targets, their markers and labels, and Ingenuity, after any progress. */
  private refreshTargets(): void {
    this.open = openTargets(this.exp, this.all);
    this.world.setTargets(
      this.open.map((t) => ({ ...t, kind: t.kind === 'station' ? (t.icon ?? 'reach') : t.kind })),
    );
    // Quieter markers for what the chapter does not need: optional objectives, and the panorama
    // spots that are not this chapter's.
    const c = this.mission.chapters[this.exp.chapter];
    const main = new Set(
      (c?.objectives ?? [])
        .filter((o) => !o.optional)
        .map((o) => targetOf(o, this.all)?.id)
        .filter((id): id is string => !!id),
    );
    this.optionalIds = new Set(this.open.filter((t) => !main.has(t.id)).map((t) => t.id));
    this.lookKey = '';
    this.refreshHeli();
    this.buildLabels();
    useGame.getState().set({ targets: this.open, expedition: this.exp });
  }

  /** Changes the options (kept in the browser). */
  setOptions(o: GameOptions): void {
    this.options = o;
    writeOptions(o);
    if (!o.storms) {
      this.storm.phase = 'clear';
      this.storm.level = 0;
      this.world.setStorm(0);
    }
  }

  /** Back to driving (after a chapter page, a card, the pause menu…), or to what is pending. */
  resume(): void {
    const story = this.pending.stories.shift();
    if (story) {
      this.controls.enabled = false;
      useGame.getState().set({ phase: 'story', story, card: null, panorama: null });
      return;
    }
    if (this.pending.complete) {
      this.pending.complete = false;
      this.finish();
      return;
    }
    if (this.pending.chapter) {
      this.pending.chapter = false;
      this.controls.enabled = false;
      useGame.getState().set({ phase: 'chapter', card: null, panorama: null });
      return;
    }
    this.controls.clear();
    this.controls.enabled = true;
    useGame.getState().set({ phase: 'playing', card: null, panorama: null });
  }

  pause(): void {
    if (useGame.getState().phase !== 'playing') return;
    this.controls.enabled = false;
    this.save();
    useGame.getState().set({ phase: 'paused' });
  }

  /** Leaves the expedition for the main menu (it is saved, to continue later). */
  quit(): void {
    if (this.running && !expeditionDone(this.exp)) this.save();
    this.running = false;
    this.controls.enabled = false;
    this.world.clearTargets();
    this.world.setWatch(null);
    this.pilot = null;
    this.recording = null;
    this.filming = false;
    this.stopAutoNav();
    this.laser = null;
    this.world.setLaser(null);
    this.world.setStorm(0);
    useGame
      .getState()
      .set({ card: null, result: null, finding: null, panorama: null, toast: null });
    this.showcase();
  }

  openInventory(): void {
    if (useGame.getState().phase !== 'playing') return;
    this.controls.enabled = false;
    useGame.getState().set({ phase: 'inventory' });
  }

  /** Opens a panorama taken earlier (from the inventory). */
  viewPanorama(id: string): void {
    this.panoramaFrom = useGame.getState().phase;
    useGame.getState().set({ phase: 'panorama', panorama: id });
  }

  closePanorama(): void {
    if (this.panoramaFrom === 'inventory') {
      this.panoramaFrom = 'playing';
      useGame.getState().set({ phase: 'inventory', panorama: null });
    } else this.resume();
  }

  private command(c: Command): void {
    const ui = useGame.getState();
    if (c === 'camera') {
      if (ui.phase === 'playing') ui.set({ camera: this.world.rig.cycle() });
    } else if (c === 'map') ui.set({ mapOpen: !ui.mapOpen });
    else if (c === 'pause') {
      if (ui.phase === 'playing') this.pause();
      else if (ui.phase === 'paused' || ui.phase === 'inventory' || ui.phase === 'chapter')
        this.resume();
      else if (ui.phase === 'card') this.closeCard();
      else if (ui.phase === 'story') this.closeStory();
      else if (ui.phase === 'photo') this.exitPhoto();
      else if (ui.phase === 'panorama') this.closePanorama();
    } else if (c === 'laser') this.fireLaser();
    else if (c === 'photo') {
      if (ui.phase === 'photo') this.exitPhoto();
      else this.enterPhoto();
    } else if (c === 'inventory') {
      if (ui.phase === 'playing') this.openInventory();
      else if (ui.phase === 'inventory') this.resume();
    } else if (c === 'autonav') {
      if (ui.phase !== 'playing') return;
      if (this.auto) this.stopAutoNav();
      else this.startAutoNav();
    } else if (c === 'warp') this.cycleWarp();
  }

  // ---------- AutoNav and time ----------

  /** Builds AutoNav's map of the area once: slopes, soft sand and boulders. */
  private navGrid(): NavGrid | null {
    if (this.nav) return this.nav;
    const t = this.world.terrain;
    const rocks = this.world.rocks;
    if (!t) return null;
    const hazards = this.options.hazards;
    this.nav = new NavGrid({
      widthM: t.detail.widthM,
      heightM: t.detail.heightM,
      marginM: AREA_MARGIN_M + 30,
      height: (x, n) => sampleBilinear(t.detail, x, n) ?? 0,
      sand: (x, n) => (hazards ? this.world.sandAt(x, n) : 0),
      obstacles: [
        ...(rocks?.boulders(0.3, t.detail.widthM, t.detail.heightM) ?? []).map((r) => ({
          x: r.x,
          north: r.north,
          radiusM: r.radiusM,
        })),
        ...(this.world.ledges?.obstacles() ?? []),
        ...(this.world.site?.obstacles() ?? []),
      ],
    });
    return this.nav;
  }

  /**
   * AutoNav to a target (by default the next objective) or to a point of the map: plans a path
   * around steep ground, soft sand and boulders, then drives it.
   */
  startAutoNav(to?: Target | { lat: number; lon: number }): boolean {
    if (this.pilot) return false;
    const f = this.world.frame;
    if (!f || !this.running) return false;
    const goalT = to ?? nextTarget(this.exp, this.open, this.rover);
    if (!goalT) {
      toast('game.autonav.noGoal');
      return false;
    }
    const grid = this.navGrid();
    if (!grid) return false;
    const [gx, gn] = f.toLocal(goalT.lat, goalT.lon);
    const isTarget = 'id' in goalT;
    const radiusM = isTarget ? (goalT as Target).radiusM : 6;
    const name = isTarget ? (goalT as Target).name : '';
    const [x, n] = f.toLocal(this.rover.lat, this.rover.lon);
    const path = grid.plan([x, n], [gx, gn], Math.max(2, radiusM - 4));
    if (!path) {
      toast('game.autonav.noPath');
      return false;
    }
    this.auto = {
      goal: { name, x: gx, north: gn, radiusM, targetId: isTarget ? (goalT as Target).id : null },
      path,
      follow: { index: 0 },
      watchOdo: this.rover.odometerM,
      watchS: 0,
      backS: 0,
      replans: 0,
    };
    this.showRoute();
    toast('game.autonav.start', { distance: Math.round(pathLength(path)) });
    return true;
  }

  stopAutoNav(): void {
    if (!this.auto) return;
    this.auto = null;
    this.warp = 1;
    this.world.setRoute(null);
    useGame.getState().set({ route: null });
  }

  private showRoute(): void {
    const f = this.world.frame;
    if (!f || !this.auto) return;
    this.world.setRoute(this.auto.path);
    useGame.getState().set({
      route: this.auto.path.map(([x, n]) => {
        const p = f.toLatLon(x, n);
        return [p.lat, p.lon] as [number, number];
      }),
    });
  }

  /** ×1 → ×2 → ×4 → ×1: allowed while AutoNav drives or the rover is stopped. */
  cycleWarp(): void {
    if (useGame.getState().phase !== 'playing') return;
    const allowed = !!this.auto || Math.abs(this.rover.speed) <= STOPPED_MPS;
    if (!allowed) {
      toast('game.warp.only');
      return;
    }
    const i = WARPS.indexOf(this.warp as (typeof WARPS)[number]);
    this.warp = WARPS[(i + 1) % WARPS.length]!;
  }

  /** AutoNav's drive command for this step (with stall detection and recovery). */
  private autoInput(dt: number): DriveInput {
    const a = this.auto!;
    const f = this.world.frame!;
    const r = this.rover;
    const [x, n] = f.toLocal(r.lat, r.lon);
    if (a.backS > 0) {
      a.backS -= dt;
      if (a.backS <= 0) this.replan();
      return { throttle: -0.6, steer: 0, boost: false };
    }
    const cmd = follow({ x, north: n, headingRad: r.headingRad }, a.path, a.follow, a.goal);
    if (cmd.done) {
      const name = a.goal.name;
      this.stopAutoNav();
      toast(name ? 'game.autonav.arrived' : 'game.autonav.arrivedPoint', { name });
      return { throttle: 0, steer: 0, boost: false };
    }
    // Blocked, stuck, or not getting anywhere: back off, mark the spot, plan again.
    a.watchS += dt;
    const stalled = a.watchS > 3 && r.odometerM - a.watchOdo < 0.6 && cmd.throttle > 0;
    if (a.watchS > 3) {
      a.watchS = 0;
      a.watchOdo = r.odometerM;
    }
    if (r.stuck || (r.blocked && r.blocked !== 'power') || stalled) {
      if (++a.replans > 8) {
        this.stopAutoNav();
        toast('game.autonav.gaveUp');
        return { throttle: 0, steer: 0, boost: false };
      }
      const ahead = 3;
      this.nav?.block(x + Math.sin(r.headingRad) * ahead, n + Math.cos(r.headingRad) * ahead, 1);
      a.backS = r.stuck ? 2.5 : 1.4;
      return { throttle: -0.6, steer: 0, boost: false };
    }
    return { throttle: cmd.throttle, steer: cmd.steer, boost: false };
  }

  private replan(): void {
    const a = this.auto;
    const f = this.world.frame;
    if (!a || !f || !this.nav) return;
    const [x, n] = f.toLocal(this.rover.lat, this.rover.lon);
    const path = this.nav.plan([x, n], [a.goal.x, a.goal.north], Math.max(2, a.goal.radiusM - 4));
    if (!path) {
      this.stopAutoNav();
      toast('game.autonav.noPath');
      return;
    }
    a.path = path;
    a.follow = { index: 0 };
    a.watchS = 0;
    a.watchOdo = this.rover.odometerM;
    this.showRoute();
  }

  // ---------- Ingenuity ----------

  /** Heading of the rover when it set the helicopter down (the helicopter faces the same way). */
  private dropHeadingRad = 0;
  /** The first flight is under way (filmed through Mastcam-Z). */
  private filming = false;

  /**
   * The deployment mission. The deployment itself is not drawn: while it runs (the shield, the
   * helicopter turned upright and set down) the camera stays where the player had it, the rover's
   * body hiding its belly, and a panel shows NASA's images of each stage (GameApp's DeployPanel).
   * Once the helicopter is down: a shot from the ground behind it while the rover turns in place
   * towards the overlook and drives away, leaving it standing there.
   */
  private stepDeploy(): void {
    const drive = driveStep(this.exp);
    const leaving =
      this.mission.stowedHelicopter && (drive?.step === 'aim' || drive?.step === 'away');
    if (this.running && leaving && this.world.ingenuity.root.visible) {
      const hp = this.world.ingenuity.position;
      const p = this.world.rover!.root.position;
      if (!this.awayShot) {
        const to =
          drive.toward ??
          driveStep({ ...this.exp, steps: (this.exp.steps ?? []).filter((x) => x !== 'aim') })
            ?.toward;
        const h = to && this.exp.dropAt ? bearingRad(this.exp.dropAt, to) : this.rover.headingRad;
        const [fx, fz, rx, rz] = [Math.sin(h), -Math.cos(h), Math.cos(h), Math.sin(h)];
        this.shotFrom.set(hp.x - fx * 5 + rx * 2.4, 0, hp.z - fz * 5 + rz * 2.4);
        this.shotFrom.y = this.world.groundY(this.shotFrom.x, this.shotFrom.z) + 1.0;
        this.awayShot = true;
      }
      this.watchAt.set(hp.x * 0.6 + p.x * 0.4, (hp.y + p.y) / 2 + 0.5, hp.z * 0.6 + p.z * 0.4);
      this.world.setWatch(this.watchAt, this.shotFrom, 46);
      this.shooting = true;
      return;
    }
    this.awayShot = false;
    if (this.shooting || (this.filming && useGame.getState().phase === 'playing')) {
      this.shooting = false;
      this.filming = false;
      this.world.setWatch(null);
    }
  }

  /** How far the deployment's slides have got (s) while it runs, or null. */
  private deployClock(): number | null {
    if (!this.mission.stowedHelicopter) return null;
    const steps = this.exp.steps ?? [];
    let t = 0;
    for (const k of ['shield', 'rotate', 'drop'] as const) {
      if (steps.includes(k)) t += STEP_S[k];
      else if (this.action?.kind === k) return t + this.action.heldS;
      // Between two steps (the next one starts once the rover is still), or not begun.
      else return steps.includes('shield') ? t : null;
    }
    return null;
  }

  /** The rest of the deployment's slides skipped: the helicopter is set down at once. */
  skipDeploy(): void {
    if (this.deployClock() === null || useGame.getState().phase !== 'playing') return;
    const before = this.exp;
    const steps = [...(this.exp.steps ?? [])];
    for (const k of ['shield', 'rotate', 'drop'] as const) if (!steps.includes(k)) steps.push(k);
    this.exp = { ...this.exp, steps, dropAt: { lat: this.rover.lat, lon: this.rover.lon } };
    this.action = null;
    this.dropHeadingRad = this.rover.headingRad;
    this.refreshHeli();
    this.afterProgress([], before);
  }

  /** The mission's own drive (off the shield, clear of Ingenuity): straight, reversing if blocked. */
  private driving: { step: DriveStep; dir: 1 | -1; odo: number; t: number } | null = null;
  private driveThrottle(step: DriveStep, dt: number): number {
    if (this.driving?.step !== step)
      this.driving = { step, dir: 1, odo: this.rover.odometerM, t: 0 };
    const d = this.driving;
    d.t += dt;
    if (d.t > 3) {
      if (this.rover.odometerM - d.odo < 0.3) d.dir = d.dir === 1 ? -1 : 1;
      d.t = 0;
      d.odo = this.rover.odometerM;
    }
    return d.dir;
  }

  /** The rover is in the zone of a step that starts once it stops there (it brakes by itself). */
  private arriving(): boolean {
    const o = nextStep(this.exp);
    if (o?.run !== 'arrive' || !o.at) return false;
    const t = this.all.find((x) => x.id === `station-${o.at}`);
    return !!t && groundDistanceM(this.rover, t) <= t.radiusM;
  }

  private awayShot = false;
  private readonly watchAt = new Vector3();
  private readonly shotFrom = new Vector3();
  private shooting = false;

  private refreshHeli(): void {
    const f = this.world.frame;
    if (this.heliFlying !== null) return; // it lands where it was going
    if (this.mission.stowedHelicopter) {
      // The deployment: carried under the rover (World.updateDeploy) until it is set down.
      const at = this.exp.dropAt;
      if (!this.running || !f) this.world.placeIngenuity(null);
      else if (at && !this.world.ingenuity.flying)
        // Set down under the rover, facing the way it does, its blades still locked.
        this.world.placeIngenuity(f.toLocal(at.lat, at.lon), this.dropHeadingRad, 1);
      return;
    }
    if (this.mission.pilot) return; // drawn where the player flies it (drawPilot)
    const parked = this.mission.parkedHelicopter;
    if (parked) {
      if (f)
        this.world.placeIngenuity(
          f.toLocal(parked.lat, parked.lon),
          (parked.headingDeg * Math.PI) / 180,
        );
      return;
    }
    this.heli = this.running ? ingenuity(this.exp) : null;
    if (!f || !this.heli) {
      this.world.placeIngenuity(null);
      return;
    }
    const a = this.mission.flights[this.heli.at]!;
    this.world.placeIngenuity(f.toLocal(a.lat, a.lon));
  }

  private stepHeli(): void {
    const f = this.world.frame;
    const h = this.heli;
    if (!f || !h) return;
    if (this.heliFlying !== null && this.world.ingenuityLanded) {
      this.world.ingenuityLanded = false;
      const flight = this.mission.flights[this.heliFlying]!;
      this.heliFlying = null;
      const before = this.exp;
      this.exp = { ...this.exp, flights: [...this.exp.flights, flight.flight] };
      toast('game.heli.landed', { flight: flight.flight, date: flight.date, sol: flight.sol });
      this.audio.chime(false);
      this.afterProgress([], before);
      return;
    }
    if (this.heliFlying !== null || h.next === null) return;
    const at = this.mission.flights[h.at]!;
    if (groundDistanceM(this.rover, at) > FLIGHT_TRIGGER_M) return;
    const to = this.mission.flights[h.next]!;
    this.heliFlying = h.next;
    this.world.flyIngenuity(f.toLocal(to.lat, to.lon));
    toast('game.heli.takeoff', { flight: to.flight, date: to.date });
  }

  // ---------- SuperCam laser ----------

  /** Starts an analysis of the rock at the centre of the view (stopped, not coring). */
  fireLaser(): void {
    const ui = useGame.getState();
    const rock = this.laserCandidate;
    if (ui.phase !== 'playing' || !this.running || this.laser || this.action || this.pilot) return;
    if (!rock || Math.abs(this.rover.speed) > STOPPED_MPS) return;
    const key = `${this.mission.areaId}:${rockKey(rock.x, rock.north)}`;
    if (isAnalysed(key)) return;
    const at = this.world.rockTop(rock, new Vector3());
    this.laser = { rock, key, t: 0, at, pulses: 0 };
  }

  private stepLaser(dt: number): void {
    const l = this.laser;
    if (!l) return;
    l.t += dt;
    const p = l.t / LASER_S;
    this.world.setLaser(l.at, p);
    // One click per pulse while the beam is on (about 10 a second).
    if (p > 0.25 && p < 0.92) {
      const due = Math.floor((l.t - 0.25 * LASER_S) * 10);
      while (l.pulses < due) {
        l.pulses++;
        this.audio.zap();
      }
    }
    if (p < 1) return;
    const type = rockType(rockKey(l.rock.x, l.rock.north), l.rock.dark);
    const { points, first } = recordRock(type, l.key, POINTS[type]);
    this.rover = {
      ...this.rover,
      batteryPct: Math.max(0, this.rover.batteryPct - LASER_COST_PCT),
      energyUsedPct: this.rover.energyUsedPct + LASER_COST_PCT,
    };
    this.laser = null;
    this.world.setLaser(null);
    this.audio.chime(false);
    const spot = laserSpotAt(this.exp, this.rover);
    const find = { type, key: l.key, points, first, ...(spot ? { at: spot } : {}) };
    const before = this.exp;
    this.exp = {
      ...this.exp,
      finds: [...this.exp.finds, find],
      science: this.exp.science + points,
    };
    useGame.getState().set({ finding: find });
    this.afterProgress([], before);
  }

  // ---------- photo mode ----------

  /** Photo mode: the game stops, the HUD hides, the camera can be turned and brought closer. */
  enterPhoto(): void {
    const phase = useGame.getState().phase;
    if (phase !== 'playing' && phase !== 'briefing') return;
    this.photoFrom = phase;
    this.controls.enabled = false;
    this.world.rig.zoomMin = 0.25;
    this.reticle.style.display = 'none';
    this.labelLayer.style.visibility = 'hidden';
    useGame.getState().set({ phase: 'photo' });
  }

  exitPhoto(): void {
    if (useGame.getState().phase !== 'photo') return;
    this.setPhotoFilter('natural');
    this.world.rig.zoomMin = 0.5;
    this.labelLayer.style.visibility = '';
    if (this.photoFrom === 'playing') this.resume();
    else useGame.getState().set({ phase: this.photoFrom });
  }

  setPhotoFilter(f: PhotoFilter): void {
    this.world.setPhotoFilter(f);
    useGame.getState().set({ photoFilter: f });
  }

  /**
   * Takes the photo: the frame with a caption strip, as JPEG. Kept in the gallery (if the browser
   * allows) and returned for download.
   */
  async takePhoto(caption: string): Promise<{ blob: Blob; name: string; kept: boolean } | null> {
    const shot = this.world.capture();
    this.audio.shutter();
    const ctx = shot.getContext('2d')!;
    const h = Math.round(shot.height * 0.045);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, shot.height - h, shot.width, h);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = `${Math.round(h * 0.45)}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(caption, h * 0.5, shot.height - h / 2);
    const blob = await new Promise<Blob | null>((r) => shot.toBlob(r, 'image/jpeg', 0.9));
    if (!blob) return null;
    const createdMs = Date.now();
    const kept = await savePhoto({
      createdMs,
      missionId: this.mission.areaId,
      filter: useGame.getState().photoFilter,
      blob,
    });
    return { blob, name: photoFileName(createdMs), kept };
  }

  // ---------- dust storms ----------

  private stepStorm(dt: number): void {
    const s = this.storm;
    if (!this.options.storms) return;
    s.t += dt;
    if (s.phase === 'clear' && this.elapsedS >= s.nextS) {
      s.phase = 'warning';
      s.t = 0;
      this.audio.warn();
    } else if (s.phase === 'warning' && s.t >= STORM.warnS) {
      s.phase = 'active';
      s.t = 0;
    } else if (s.phase === 'active' && s.t >= STORM.activeS) {
      s.phase = 'clear';
      s.t = 0;
      s.nextS = this.elapsedS + STORM.gapS + Math.random() * STORM.gapJitterS;
    }
    const target = s.phase === 'active' ? 1 : 0;
    s.level += Math.max(-dt / 9, Math.min(dt / 6, target - s.level));
    this.world.setStorm(s.level);
  }

  cycleCamera(): void {
    this.command('camera');
  }

  /** Tubes left at the depot: one of each pair cored on this map. */
  private depotCount(): number {
    return this.exp.samples.filter((n) => (n.match(/\d+/g) ?? []).length > 1).length;
  }

  private finish(): void {
    const newBest = recordBest(this.elapsedS, this.mission.id);
    const result: ExpeditionResult = {
      elapsedS: this.elapsedS,
      odometerM: this.rover.odometerM,
      energyUsedPct: this.rover.energyUsedPct,
      tubes: this.exp.samples.reduce((k, n) => k + (n.match(/\d+/g) ?? []).length, 0),
      depotTubes: this.depotCount(),
      science: this.exp.science,
      rocks: this.exp.finds.length,
      panoramas: this.exp.panoramas.length,
      flights: this.exp.flights.length,
      wheelsPct: this.rover.wheelsPct,
      bestS: newBest ? this.elapsedS : null,
      newBest,
    };
    clearSave(this.mission.id);
    this.stopAutoNav();
    this.world.setStorm(0);
    this.controls.enabled = false;
    this.audio.chime(true);
    useGame.getState().set({
      phase: 'complete',
      result,
      hasSave: !!readSave('delta'),
      saves: savedChapters(),
      bests: bestTimes(),
    });
  }

  /** After the end: keep driving the map freely (no objectives left). */
  keepExploring(): void {
    this.resume();
  }

  /** Card closed: back to driving, or to the next chapter's page. */
  closeCard(): void {
    this.resume();
  }

  /** Story card closed: the next one, the chapter's page, the end, or back to the game. */
  closeStory(): void {
    useGame.getState().set({ story: null });
    this.resume();
  }

  private save(): void {
    if (!this.running || expeditionDone(this.exp)) return;
    const r = this.rover;
    writeSave({
      state: this.exp,
      rover: {
        lat: r.lat,
        lon: r.lon,
        headingRad: r.headingRad,
        batteryPct: r.batteryPct,
        wheelsPct: r.wheelsPct,
        odometerM: r.odometerM,
        energyUsedPct: r.energyUsedPct,
      },
      elapsedS: this.elapsedS,
      savedMs: Date.now(),
      tubesAt: this.tubesAt,
    });
    this.sinceSave = 0;
  }

  /**
   * State changed (from `before`: an event, a laser find, a flight): next chapter, markers, save.
   * Events of a step (already advanced) come in `events`.
   */
  private afterProgress(
    events: ExpeditionEvent[],
    before: ExpeditionState = this.exp,
    /** The state before the step (when `before` is already past it), for the story cards. */
    storiesFrom: ExpeditionState = before,
  ): void {
    const adv = advance(this.exp, before, events);
    this.exp = adv.state;
    for (const o of newlyDone(storiesFrom, this.exp))
      if (o.story) this.pending.stories.push(o.story);
    for (const e of adv.events) {
      if (e.kind === 'chapter') {
        this.pending.chapter = true;
        this.stopAutoNav();
      } else if (e.kind === 'complete') this.pending.complete = true;
    }
    this.refreshTargets();
    this.save();
    // Nothing else on screen: show the story, the next chapter (or the end) now.
    if (
      useGame.getState().phase === 'playing' &&
      (this.pending.stories.length || this.pending.chapter || this.pending.complete)
    )
      this.resume();
  }

  // ---------- frame loop ----------

  private readonly loop = (ts: number): void => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, Math.max(0, (ts - this.last) / 1000));
    this.last = ts;
    const phase = useGame.getState().phase;
    const prev = this.rover;
    let busy: { kind: 'core' | 'panorama'; p: number } | null = null;
    if (phase === 'playing' && this.running) {
      // Time runs faster when asked (AutoNav or waiting): several steps per frame.
      const steps = this.warp;
      for (let i = 0; i < steps && useGame.getState().phase === 'playing'; i++)
        busy = this.step(dt);
    } else if (phase === 'briefing' && !this.reduced) {
      this.world.rig.orbit(dt * 0.07);
    }
    // A panorama: the camera circles slowly with the mast.
    if (busy?.kind === 'panorama' && !this.reduced) this.world.rig.orbit(dt * 0.35);
    const r = this.rover;
    const f = this.world.frame;
    if (!f) return;
    const [x, n] = f.toLocal(r.lat, r.lon);
    const live = phase === 'playing';
    const yawRate = dt > 0 ? wrapAngle(r.headingRad - prev.headingRad) / dt : 0;
    const distanceM = live ? r.odometerM - prev.odometerM : 0;
    this.world.frameUpdate(
      dt * (live ? this.warp : 1),
      {
        x,
        y: r.heightM,
        z: -n,
        headingRad: r.headingRad,
        pitchRad: r.pitchRad,
        rollRad: r.rollRad,
      },
      {
        speed: live ? r.speed : 0,
        yawRate: live ? yawRate / this.warp : 0,
        distanceM: Math.sign(r.speed) * distanceM,
        slip: live ? r.slip : 0,
        sinkage: r.sinkage,
      },
      busy?.kind === 'core' ? busy.p : null,
      busy?.kind === 'panorama' ? busy.p : null,
    );
    if (this.pilot) this.drawPilot(dt);
    const rough =
      dt > 0 ? (Math.abs(r.pitchRad - prev.pitchRad) + Math.abs(r.rollRad - prev.rollRad)) / dt : 0;
    const coring = busy?.kind === 'core' ? busy.p : null;
    this.world.render(dt, {
      at: this.pilot ? this.world.ingenuity.position : this.world.rover!.root.position,
      headingRad: r.headingRad,
      speed: live ? r.speed : 0,
      rough: rough * 0.6,
      coring: coring === null ? 0 : Math.min(1, Math.min(coring, 1 - coring) * 5),
    });
    const heli = this.world.ingenuity;
    const heliM = heli.root.visible
      ? heli.position.distanceTo(this.world.rover!.root.position)
      : 1e9;
    this.audio.update(dt, {
      speed: live ? Math.abs(r.speed) : 0,
      drilling: coring !== null && coring > DRILL_PHASE[0] && coring < DRILL_PHASE[1],
      wind: phase !== 'loading' ? 1 + 2.5 * this.world.stormLevel : 0,
      rotor: heli.root.visible && heli.flying ? 1 : 0,
      rotorM: heliM,
    });
    this.updateLabels();
    this.updateReticle();
  };

  /** One simulation step while playing; returns the sequence under way (coring, panorama). */
  private step(dt: number): { kind: 'core' | 'panorama'; p: number } | null {
    if (this.pilot) {
      this.stepPilot(dt);
      return null;
    }
    let input = this.controls.read();
    if (this.auto) {
      // Taking the wheel cancels AutoNav.
      if (input.throttle !== 0 || input.steer !== 0) this.stopAutoNav();
      else input = { ...this.autoInput(dt), action: input.action };
    } else if (this.warp > 1 && (input.throttle !== 0 || input.steer !== 0)) this.warp = 1;
    const busy = this.action !== null || this.laser !== null;
    // The mission has the wheel during a chain (the deployment) and when stopping at a station.
    const drive = driveStep(this.exp);
    if (chainUnderWay(this.exp) || this.arriving()) {
      if (this.auto) this.stopAutoNav();
      this.warp = 1;
      const turn = drive?.toward && !busy ? aimError(this.rover, drive.toward) : 0;
      input = {
        ...input,
        throttle: drive && !drive.toward && !busy ? this.driveThrottle(drive.step, dt) : 0,
        steer: Math.max(-0.4, Math.min(0.4, turn / 0.6)),
        boost: false,
        action: false,
      };
    }
    this.stepStorm(dt);
    const stuckBefore = this.rover.stuck;
    this.rover = stepRover(
      this.rover,
      busy ? { throttle: 0, steer: 0, boost: false } : input,
      dt,
      this.ground,
      this.bounds,
      // AutoNav slows down when the storm hides the terrain; the mission's own drives are slow.
      {
        speedFactor:
          drive && !drive.toward ? DRIVE_STEP_SPEED[drive.step] : 1 - 0.45 * this.storm.level,
      },
    );
    if (this.rover.stuck && !stuckBefore) this.audio.warn();
    if (this.rover.wearPct > 0) this.wearShownS = 1.2;
    else this.wearShownS = Math.max(0, this.wearShownS - dt);
    this.stepLaser(dt);
    this.stepHeli();
    // The action key records a dust devil when one is in range (and nothing else is under way).
    const recordNow = this.stepDevil(dt, input.action && !this.laser && !this.action);
    const prevExp = this.exp;
    const res = stepExpedition(
      this.exp,
      this.action,
      this.rover,
      this.all,
      input.action && !this.laser && !recordNow,
      dt,
    );
    this.exp = res.state;
    this.action = res.action;
    this.stepDeploy();
    this.elapsedS += dt;
    this.sinceHud += dt;
    this.sinceSave += dt;
    const fraction = this.action ? this.action.heldS / actionSeconds(this.action.kind) : null;
    if (this.sinceHud >= HUD_EVERY_S || res.events.length) {
      this.sinceHud = 0;
      this.publish(input.boost && input.throttle > 0, fraction);
    }
    if (res.events.length) this.handle(res.events, prevExp);
    else if (this.sinceSave >= SAVE_EVERY_S) this.save();
    if (!this.action) return null;
    if (this.action.kind === 'core') return { kind: 'core', p: fraction! };
    if (this.action.kind === 'panorama') return { kind: 'panorama', p: fraction! };
    return null;
  }

  private handle(events: ExpeditionEvent[], prev: ExpeditionState): void {
    let dialog: Partial<ReturnType<typeof useGame.getState>> | null = null;
    for (const e of events) {
      if (e.kind === 'reached') {
        this.audio.chime(false);
        toast('game.toast.reached', { name: e.target.name });
        if (this.auto?.goal.targetId === e.target.id) this.stopAutoNav();
      } else if (e.kind === 'collected') {
        this.rover = {
          ...this.rover,
          batteryPct: Math.max(0, this.rover.batteryPct - CORE_COST_PCT),
          energyUsedPct: this.rover.energyUsedPct + CORE_COST_PCT,
        };
        recordSample(e.target.id);
        this.audio.chime(false);
        dialog = { card: e.target, phase: 'card' };
      } else if (e.kind === 'panorama') {
        this.audio.shutter();
        this.panoramaFrom = 'playing';
        dialog = { panorama: e.target.panoramaId ?? null, phase: 'panorama' };
      } else if (e.kind === 'deposited') {
        const f = this.world.frame!;
        const [x, n] = f.toLocal(this.rover.lat, this.rover.lon);
        this.tubesAt = [x, n, this.rover.headingRad];
        this.world.layTubesAt(x, n, this.rover.headingRad, this.depotCount());
        this.audio.chime(false);
        toast('game.toast.deposited', { count: this.depotCount() });
      } else if (e.kind === 'step' && e.step === 'film') {
        // NASA's video of the flight; the mission ends when it does.
        this.audio.chime(false);
        dialog = { phase: 'film' };
      } else if (e.kind === 'step') {
        this.audio.chime(false);
        // The deployment's own stages are told by its panel; the drive clear gets a notice.
        if (e.step === 'away') toast('game.toast.step.away');
        // Clear of the helicopter: the rover stops there (the next chapter's page opens).
        if (e.step === 'away') this.rover = { ...this.rover, speed: 0 };
        if (e.step === 'drop') {
          this.dropHeadingRad = this.rover.headingRad;
          this.refreshHeli();
        }
        if (e.step === 'moxie')
          this.rover = {
            ...this.rover,
            batteryPct: Math.max(0, this.rover.batteryPct - MOXIE_COST_PCT),
            energyUsedPct: this.rover.energyUsedPct + MOXIE_COST_PCT,
          };
      }
    }
    if (this.auto && events.some((e) => e.kind !== 'reached')) this.stopAutoNav();
    if (dialog) {
      this.controls.enabled = false;
      useGame.getState().set(dialog);
    }
    this.afterProgress(events, this.exp, prev);
  }

  private publish(boosting: boolean, fraction: number | null): void {
    const r = this.rover;
    const goal = this.auto?.goal.targetId
      ? (this.open.find((t) => t.id === this.auto!.goal.targetId) ?? null)
      : null;
    const next = goal ?? nextTarget(this.exp, this.open, r);
    const here = targetHere(
      r,
      this.open.filter((t) => t.kind !== 'reach'),
    );
    // Markers: the objective the compass points to stands out; the one the rover is in lights up.
    const lookKey = `${next?.id}|${here?.id}`;
    if (lookKey !== this.lookKey) {
      this.lookKey = lookKey;
      this.nextId = next?.id ?? null;
      this.world.setMarkerLooks((id) => ({
        next: id === next?.id,
        optional: this.optionalIds.has(id),
        active: id === here?.id,
      }));
      for (const [id, el] of this.labels) {
        el.classList.toggle('is-next', id === this.nextId);
        el.classList.toggle('is-optional', this.optionalIds.has(id));
      }
    }
    // The rock SuperCam would analyse (stopped, nothing else under way).
    const idle = Math.abs(r.speed) <= STOPPED_MPS && !this.action && !this.laser;
    this.laserCandidate = idle ? this.world.laserTarget(LASER_RANGE_M) : null;
    const cand = this.laserCandidate;
    const laserTarget = cand
      ? isAnalysed(`${this.mission.areaId}:${rockKey(cand.x, cand.north)}`)
        ? ('done' as const)
        : ('ready' as const)
      : null;
    const camRad = this.pilot ? this.pilot.headingRad : this.world.rig.headingRad;
    const heliVisible = this.world.ingenuity.root.visible && this.world.frame && !this.pilot;
    let heliHud: ReturnType<typeof useGame.getState>['hud']['ingenuity'] = null;
    if (heliVisible) {
      const p = this.world.ingenuity.position;
      const at = this.world.frame!.toLatLon(p.x, -p.z);
      heliHud = {
        distanceM: groundDistanceM(r, at),
        relDeg: wrapAngle(bearingRad(r, at) - camRad) * RAD_TO_DEG,
        flying: this.world.ingenuity.flying,
        ready: this.heli?.next !== null && this.heli?.next !== undefined,
      };
    }
    const a = this.auto;
    const f = this.world.frame;
    useGame.getState().set({
      hud: {
        speedMps: r.speed,
        batteryPct: r.batteryPct,
        tiltDeg: r.tiltDeg,
        gradeDeg: r.gradeDeg,
        blocked: r.blocked,
        recharging: r.recharging,
        boosting,
        odometerM: r.odometerM,
        elapsedS: this.elapsedS,
        next: next && {
          id: next.id,
          name: next.name,
          kind: next.kind,
          distanceM: groundDistanceM(r, next),
          relDeg: wrapAngle(bearingRad(r, next) - camRad) * RAD_TO_DEG,
        },
        here: here && {
          id: here.id,
          name: here.name,
          kind: here.kind,
          stopped: Math.abs(r.speed) <= STOPPED_MPS,
          step: here.kind === 'station' ? (stationStep(this.exp, here)?.step ?? null) : null,
          run: here.kind === 'station' ? (stationStep(this.exp, here)?.run ?? null) : null,
          locked:
            here.kind === 'sample' ? sampleLockedBy(this.exp, here.site?.sampleNumber ?? '') : null,
        },
        deploy: ((): Hud['deploy'] => {
          const t = this.deployClock();
          if (t === null) return null;
          const total = DEPLOY_SLIDE_S * DEPLOY_SLIDES.length;
          return {
            slide: Math.min(DEPLOY_SLIDES.length - 1, Math.floor(t / DEPLOY_SLIDE_S)),
            fraction: Math.min(1, t / total),
          };
        })(),
        drive: ((): Hud['drive'] => {
          const d = driveStep(this.exp);
          if (!d) return null;
          const done = d.toward
            ? 1 - Math.abs(aimError(r, d.toward)) / Math.PI
            : groundDistanceM(r, d.from) / d.m;
          return { step: d.step, fraction: Math.min(1, done) };
        })(),
        action:
          this.action && fraction !== null
            ? { kind: this.action.kind, fraction: Math.min(1, fraction) }
            : null,
        sand: r.sand,
        slip: r.slip,
        stuck: r.stuck,
        wheelsPct: r.wheelsPct,
        wearing: this.wearShownS > 0,
        storm:
          this.storm.phase === 'warning' ? 'warning' : this.storm.level > 0.15 ? 'active' : null,
        laser: this.laser ? { fraction: Math.min(1, this.laser.t / LASER_S) } : null,
        laserTarget,
        autonav:
          a && f
            ? {
                goal: a.goal.name,
                distanceM: Math.hypot(
                  ...((): [number, number] => {
                    const [x, n] = f.toLocal(r.lat, r.lon);
                    return [a.goal.x - x, a.goal.north - n];
                  })(),
                ),
                state: a.backS > 0 ? 'recovering' : 'driving',
              }
            : null,
        warp: this.warp,
        ingenuity: heliHud,
        pilot: this.pilotHud(),
        devil: this.devilHud(camRad),
        moxieG:
          this.action?.kind === 'moxie' && fraction !== null
            ? Math.min(1, fraction) * MOXIE_O2_G
            : null,
      },
    });
  }

  // ---------- Ingenuity flown by the player (mission 4) ----------

  /** The places it still has to photograph or land on, and whether it may land where it is. */
  private pilotTargets(h: HeliState) {
    const air = airObjectives(this.exp, this.all);
    const landing = air.find((a) => a.o.by === 'landing') ?? null;
    const photos = air.filter((a) => a.o.by === 'air');
    const inLanding = !!landing && groundDistanceM(h, landing.t) <= landing.t.radiusM;
    return { landing, photos, inLanding, canLand: inLanding && photos.length === 0 };
  }

  private stepPilot(dt: number): void {
    const input = this.controls.read();
    this.pilotSteer += (input.steer - this.pilotSteer) * Math.min(1, dt * 4);
    const before = this.exp;
    const was = this.pilot!;
    const { landing, photos, inLanding, canLand } = this.pilotTargets(was);
    const res = stepHeli(was, input, dt, canLand, this.bounds);
    let h = res.h;
    if (res.event === 'takeoff') toast('game.pilot.takeoff', { s: Math.round(timeLeftS(h)) });
    if (h.phase === 'fly' && input.action && !was.keyWas && inLanding && photos.length)
      toast('game.pilot.photosFirst');
    // Aerial photos: hovering slowly over a place.
    const over = photos.find((a) => groundDistanceM(h, a.t) <= a.t.radiusM)?.t ?? null;
    const shot = stepPhoto(h, over?.id ?? null, dt);
    h = shot.h;
    if (shot.taken) {
      const t = this.all.find((x) => x.id === shot.taken)!;
      this.exp = { ...this.exp, reached: [...this.exp.reached, t.id.slice('reach-'.length)] };
      this.audio.shutter();
      toast('game.pilot.photo', { name: t.name });
    }
    if (res.event === 'down') {
      if (canLand && landing) {
        this.exp = {
          ...this.exp,
          reached: [...this.exp.reached, landing.t.id.slice('reach-'.length)],
        };
        this.audio.chime(false);
        toast('game.pilot.landed', { s: Math.round(h.airS) });
      } else if (h.forced) {
        // Battery spent before the job was done: the team plans the flight again, from the start.
        this.audio.warn();
        toast('game.pilot.empty');
        const st = this.mission.start;
        const flown = this.mission.chapters[this.exp.chapter]!.objectives.flatMap((o) =>
          o.kind === 'reach' && o.by ? [o.target] : [],
        );
        this.exp = { ...this.exp, reached: this.exp.reached.filter((r) => !flown.includes(r)) };
        h = newHeli(st, (st.headingDeg * Math.PI) / 180, FLIGHT_26.seconds);
        this.chaseSet = false;
      }
    }
    if (h.phase === 'fly' && timeLeftS(h) <= 20 && timeLeftS(was) > 20) {
      this.audio.warn();
      toast('game.pilot.low', { s: 20 });
    }
    this.pilot = h;
    // The rover's state follows the helicopter over the ground: compass, map and labels use it.
    this.rover = {
      ...this.rover,
      lat: h.lat,
      lon: h.lon,
      headingRad: h.headingRad,
      speed: h.speed,
    };
    this.elapsedS += dt;
    this.sinceHud += dt;
    this.sinceSave += dt;
    const changed = this.exp !== before;
    if (this.sinceHud >= HUD_EVERY_S || changed) {
      this.sinceHud = 0;
      this.publish(input.boost && input.throttle > 0, null);
    }
    if (changed) this.afterProgress([], before);
    else if (this.sinceSave >= SAVE_EVERY_S) this.save();
  }

  /** The helicopter where the flight has it, and the camera behind and above it. */
  private drawPilot(dt: number): void {
    const h = this.pilot;
    const f = this.world.frame;
    if (!h || !f) return;
    const [x, n] = f.toLocal(h.lat, h.lon);
    const rotors = h.phase !== 'ground' && !(h.phase === 'down' && h.t > HELI.spinDownS);
    // Leaning into its motion: forward with speed, sideways into a turn.
    const pitch = 0.2 * (h.speed / HELI.boostMps);
    const roll = h.phase === 'fly' ? -0.14 * this.pilotSteer : 0;
    this.world.pilotIngenuity([x, n], h.altM, h.headingRad, rotors, pitch, roll);
    const p = this.world.ingenuity.position;
    const fx = Math.sin(h.headingRad);
    const fz = -Math.cos(h.headingRad);
    // Close behind (it is 1.2 m across), a little above; the lag shows its speed.
    const back = 3.4 + 0.25 * Math.abs(h.speed);
    const want = this.chaseLook.set(p.x - fx * back, p.y + 1.25, p.z - fz * back);
    want.y = Math.max(want.y, this.world.groundY(want.x, want.z) + 1.4);
    if (!this.chaseSet) {
      this.chase.copy(want);
      this.chaseSet = true;
    } else this.chase.lerp(want, Math.min(1, dt * 3.5));
    this.chaseLook.set(p.x + fx * 2.5, p.y - 0.35, p.z + fz * 2.5);
    this.world.setWatch(this.chaseLook, this.chase, 46);
  }

  private pilotHud(): Hud['pilot'] {
    const h = this.pilot;
    if (!h) return null;
    const { photos, inLanding, canLand } = this.pilotTargets(h);
    return {
      timeLeftS: timeLeftS(h),
      altM: h.altM,
      speedMps: h.speed,
      phase: h.phase,
      photo: h.photo ? Math.min(1, h.photo.s / HELI.photoHoldS) : null,
      canLand,
      inLanding,
      photosLeft: photos.length,
    };
  }

  // ---------- dust devils and SuperCam's microphone (mission 7) ----------

  /**
   * While a dust devil objective is open: one is brought upwind now and then (they cross Jezero
   * often in spring and summer); stopped within range, the action key records it for a few seconds
   * (SuperCam's microphone heard one pass over the rover on sol 52). Returns true when the key
   * started a recording.
   */
  private stepDevil(dt: number, pressed: boolean): boolean {
    const c = this.mission.chapters[this.exp.chapter];
    const open = c?.objectives.some((o) => o.kind === 'devil' && !objectiveDone(this.exp, o, c));
    if (!open) {
      this.recording = null;
      return false;
    }
    const p = this.world.rover!.root.position;
    const near = this.world.nearestDevil(p.x, p.z);
    if ((!near || near.distanceM > 400) && this.elapsedS >= this.devilDueS) {
      if (this.world.summonDevil(p.x, p.z, 150 + Math.random() * 60))
        this.devilDueS = this.elapsedS + 45;
    }
    const inRange = !!near && near.distanceM <= DEVIL_RANGE_M;
    const still = Math.abs(this.rover.speed) <= STOPPED_MPS;
    if (this.recording !== null) {
      if (!inRange || !still) {
        this.recording = null;
        toast('game.devil.lost');
        return false;
      }
      this.recording += dt;
      // Grains hitting the microphone (and, Chide et al. 2025, the crackle of small discharges).
      if (Math.random() < dt * 6) this.audio.zap();
      if (this.recording >= DEVIL_RECORD_S) {
        this.recording = null;
        const before = this.exp;
        this.exp = { ...this.exp, recordings: (this.exp.recordings ?? 0) + 1 };
        this.audio.chime(false);
        this.afterProgress([], before);
      }
      return false;
    }
    if (pressed && inRange && still) {
      this.recording = 0;
      return true;
    }
    return false;
  }

  private devilHud(camRad: number): Hud['devil'] {
    const c = this.mission.chapters[this.exp.chapter];
    if (!c?.objectives.some((o) => o.kind === 'devil' && !objectiveDone(this.exp, o, c)))
      return null;
    const p = this.world.rover!.root.position;
    const near = this.world.nearestDevil(p.x, p.z);
    const f = this.world.frame;
    if (!near || !f) return null;
    const at = f.toLatLon(near.at.x, -near.at.z);
    return {
      distanceM: near.distanceM,
      relDeg: wrapAngle(bearingRad(this.rover, at) - camRad) * RAD_TO_DEG,
      inRange: near.distanceM <= DEVIL_RANGE_M,
      recording: this.recording === null ? null : Math.min(1, this.recording / DEVIL_RECORD_S),
    };
  }

  // ---------- target labels (DOM, projected each frame) ----------

  private buildLabels(): void {
    this.clearLabels();
    for (const t of this.open) {
      const el = document.createElement('div');
      el.className = `game-label is-${t.kind}`;
      const name = document.createElement('span');
      name.className = 'game-label-name';
      name.textContent = t.name;
      const dist = document.createElement('span');
      dist.className = 'game-label-dist';
      el.append(name, dist);
      this.labelLayer.appendChild(el);
      this.labels.set(t.id, el);
    }
    if (this.heli) {
      const el = document.createElement('div');
      el.className = 'game-label is-heli';
      el.textContent = 'Ingenuity';
      this.labelLayer.appendChild(el);
      this.labels.set('ingenuity', el);
    }
  }

  private clearLabels(): void {
    for (const el of this.labels.values()) el.remove();
    this.labels.clear();
  }

  /** SuperCam's reticle on the rock at the centre of the view (while stopped). */
  private updateReticle(): void {
    const rock = this.laser?.rock ?? this.laserCandidate;
    const ui = useGame.getState();
    if (!rock || ui.phase !== 'playing') {
      this.reticle.style.display = 'none';
      return;
    }
    const top = this.world.rockTop(rock, this.reticleAt);
    const v = this.world.project(top.x, top.y, top.z);
    if (v.z > 1) {
      this.reticle.style.display = 'none';
      return;
    }
    const sx = ((v.x + 1) / 2) * this.world.host.clientWidth;
    const sy = ((1 - v.y) / 2) * this.world.host.clientHeight;
    this.reticle.style.display = '';
    this.reticle.classList.toggle('is-done', !this.laser && ui.hud.laserTarget === 'done');
    this.reticle.classList.toggle('is-firing', !!this.laser);
    this.reticle.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -50%)`;
  }
  private readonly reticleAt = new Vector3();

  /** Projects the labels above their places; nearer ones win where two would overlap. */
  /** Screen boxes of the HUD's panels (labels keep out of them), refreshed every few frames. */
  private hudBoxes: Array<[number, number, number, number]> = [];
  private hudBoxesAge = 0;

  private updateLabels(): void {
    const f = this.world.frame;
    if (!f || !this.labels.size) return;
    // A dialog or a screen over the game: no labels (they would show through it).
    const phase = useGame.getState().phase;
    const shown = phase === 'playing' || phase === 'photo';
    this.labelLayer.style.visibility = shown ? '' : 'hidden';
    if (!shown) return;
    if (--this.hudBoxesAge <= 0) {
      this.hudBoxesAge = 10;
      const host = this.world.host.getBoundingClientRect();
      this.hudBoxes = [
        ...document.querySelectorAll(
          '.game-hud .game-panel, .game-compass, .game-map, .game-prompt > span, .game-toast, .game-deploy',
        ),
      ].map((e) => {
        const r = e.getBoundingClientRect();
        return [
          r.left - host.left - 6,
          r.top - host.top - 6,
          r.right - host.left + 6,
          r.bottom - host.top + 6,
        ];
      });
    }
    const p = this.world.camera.position;
    const w = this.world.host.clientWidth;
    const h = this.world.host.clientHeight;
    const lang = i18n.language;
    const items = this.open.map((t) => {
      // Above the marker's floating badge.
      const a = this.world.markerAnchor(t.id);
      const [x, n] = f.toLocal(t.lat, t.lon);
      const y = a ? a.y : this.world.groundY(x, -n) + 9;
      // Distance from the rover, written only when it changes.
      const el = this.labels.get(t.id);
      const dist = el?.lastElementChild;
      if (dist) {
        const text = formatDistance(groundDistanceM(this.rover, t), lang);
        if (dist.textContent !== text) dist.textContent = text;
      }
      return { id: t.id, x, y, z: -n, d: Math.hypot(x - p.x, y - p.y, -n - p.z) };
    });
    if (this.labels.has('ingenuity')) {
      const q = this.world.ingenuity.position;
      items.push({ id: 'ingenuity', x: q.x, y: q.y + 1.2, z: q.z, d: q.distanceTo(p) });
    }
    items.sort((a, b) => a.d - b.d);
    // The HUD's panels count as already taken: a label never sits behind one.
    const placed: Array<[number, number, number, number]> = [...this.hudBoxes];
    for (const it of items) {
      const el = this.labels.get(it.id);
      if (!el) continue;
      const v = this.world.project(it.x, it.y, it.z);
      let visible = v.z < 1 && it.d > (it.id === 'ingenuity' ? 6 : 18) && it.d < 6000;
      const sx = ((v.x + 1) / 2) * w;
      const sy = ((1 - v.y) / 2) * h;
      const half = (el.textContent?.length ?? 8) * 3.6 + 10;
      if (visible) {
        const box: [number, number, number, number] = [sx - half, sy - 24, sx + half, sy];
        visible = !placed.some(
          (b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1],
        );
        if (visible) placed.push(box);
      }
      el.style.display = visible ? '' : 'none';
      if (visible) el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -100%)`;
    }
  }

  // ---------- accessors ----------

  get sampleSites(): SampleSite[] {
    return this.samples;
  }

  /** The area's 0.5 m HiRISE image (file, metres per pixel), centred on the area: the map's base. */
  get mapImage(): { file: string; cellM: number; widthM: number; heightM: number } | null {
    const a = this.manifest?.areas.find((x) => x.id === this.mission.areaId);
    return a
      ? {
          file: a.detail.albedo.file,
          cellM: a.detail.albedo.cellM ?? 0.5,
          widthM: a.detail.heights.widthM,
          heightM: a.detail.heights.heightM,
        }
      : null;
  }

  /** The mission being played or shown. */
  get missionDef(): MissionDef {
    return this.mission;
  }

  /** Every place of the map (for the map and the inventory). */
  get places(): Target[] {
    return this.all;
  }

  /** Rover position, heading and camera, for the mini-map (read every animation frame). */
  get roverPose(): { lat: number; lon: number; headingRad: number; cameraRad: number } {
    return {
      lat: this.rover.lat,
      lon: this.rover.lon,
      headingRad: this.rover.headingRad,
      cameraRad: this.world.rig.headingRad,
    };
  }

  /** Ingenuity's position (lat, lon) for the mini-map, when it is on the map. */
  get ingenuityPose(): { lat: number; lon: number } | null {
    const f = this.world.frame;
    if (!f || !this.world.ingenuity.root.visible) return null;
    const p = this.world.ingenuity.position;
    return f.toLatLon(p.x, -p.z);
  }

  /** Test hook (development builds): the rover state, and a jump to a position. */
  get state(): RoverState {
    return this.rover;
  }

  teleport(lat: number, lon: number): void {
    this.rover = this.settle({ ...this.rover, lat, lon, speed: 0 });
    this.world.tracks.clear();
    this.world.rig.snap(this.rover.headingRad);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.controls.dispose();
    this.audio.dispose();
    this.labelLayer.remove();
    this.world.dispose();
  }
}
