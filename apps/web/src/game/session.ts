import { RAD_TO_DEG } from '@copernico/domain';
import { Vector3 } from 'three';
import { DATA_VERSION, dataUrl } from '../config';
import { loadSamples, type SampleSite } from '../data/surfaceData';
import { wrapAngle } from '../lib/math';
import { prefersReducedMotion } from '../lib/motion';
import { GameAudio } from './audio';
import {
  isAnalysed,
  readOptions,
  recordRock,
  recordSample,
  writeOptions,
  type GameOptions,
} from './career';
import { Controls, type Command } from './controls';
import {
  CORE_COST_PCT,
  CORE_S,
  DEPOSIT_S,
  DEPOT,
  MISSIONS,
  STOPPED_MPS,
  isComplete,
  missionTargets,
  nearestRemaining,
  newProgress,
  stepProgress,
  targetHere,
  type MissionDef,
  type MissionId,
  type Progress,
  type Target,
} from './missions';
import {
  bearingRad,
  groundDistanceM,
  initialRover,
  stepRover,
  type Bounds,
  type GroundProbe,
  type RoverState,
} from './roverSim';
import { photoFileName, savePhoto } from './photos';
import { LASER_COST_PCT, LASER_RANGE_M, LASER_S, POINTS, rockKey, rockType } from './science';
import { EMPTY_HUD, useGame, type MissionResult, type Phase } from './store';
import { loadManifest, type WorldManifest } from './world/heights';
import type { Rock } from './world/rocks';
import { DRILL_PHASE, World, type PhotoFilter, type Quality } from './world/world';

/**
 * Dust storms (seconds of mission time): the first comes 55–115 s in, each is announced, blows
 * for a while and clears; the next comes 90–180 s later.
 */
const STORM = { firstS: 55, firstJitterS: 60, warnS: 8, activeS: 32, gapS: 90, gapJitterS: 90 };

const HUD_EVERY_S = 0.1;
/** Where the rover waits, slowly circled by the camera, while a mission is chosen. */
const SHOWCASE = MISSIONS[0]!.start;
const BEST_KEY = 'copernico.game.best.';
const QUALITY_KEY = 'copernico.game.quality';
/** The rover keeps this far inside the 1 m terrain model (m), on top of roverSim's margin. */
const AREA_MARGIN_M = 40;

const readBest = (id: MissionId): number | null => {
  try {
    const v = Number(localStorage.getItem(BEST_KEY + id));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
};
const writeBest = (id: MissionId, s: number) => {
  try {
    localStorage.setItem(BEST_KEY + id, String(Math.round(s)));
  } catch {
    // storage unavailable: the best time is simply not kept
  }
};
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

/**
 * The rover game: Perseverance in a 3D Jezero rebuilt from real data (World), driven with the
 * keyboard or the touch pad to real sample sites. One instance per page.
 */
export class GameSession {
  readonly controls: Controls;
  readonly audio = new GameAudio();
  private manifest: WorldManifest | null = null;
  private samples: SampleSite[] = [];
  private bounds: Bounds = { west: 0, south: 0, east: 0, north: 0 };
  private mission: MissionDef | null = null;
  private targets: Target[] = [];
  private progress: Progress = newProgress();
  private rover: RoverState = initialRover(SHOWCASE.lat, SHOWCASE.lon, 0);
  private elapsedS = 0;
  private sinceHud = 0;
  private last = 0;
  private raf = 0;
  private destroyed = false;
  private readonly reduced = prefersReducedMotion();
  private labels = new Map<string, HTMLElement>();
  private readonly labelLayer: HTMLElement;
  private readonly onResize = () => this.world.resize();

  options: GameOptions = readOptions();
  private storm = { phase: 'clear' as 'clear' | 'warning' | 'active', t: 0, nextS: 0, level: 0 };
  /** SuperCam: the analysis under way, and the rock the view is centred on. */
  private laser: { rock: Rock; key: string; t: number; at: Vector3; pulses: number } | null = null;
  private laserCandidate: Rock | null = null;
  private science = { points: 0, rocks: 0 };
  private wearShownS = 0;
  private photoFrom: Phase = 'playing';
  private readonly reticle: HTMLElement;

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
      return this.world.rocks?.rockLift(x, n) ?? 0;
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

  /** Loads the world and the rover; resolves false if data is missing or the session was destroyed. */
  async load(): Promise<boolean> {
    try {
      const [manifest, samples] = await Promise.all([
        loadManifest(),
        loadSamples(),
        this.world.loadRover(dataUrl(`models/perseverance.glb?v=${DATA_VERSION}`)),
      ]);
      if (this.destroyed || !samples) return false;
      this.manifest = manifest;
      this.samples = samples.samples;
      await this.useArea('floor');
      if (this.destroyed) return false;
      this.showcase();
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.loop);
      if (import.meta.env.DEV)
        (window as unknown as { __copernicoGame?: unknown }).__copernicoGame = this;
      return true;
    } catch (e) {
      console.error('[Copernico game] load failed', e);
      return false;
    }
  }

  private async useArea(id: string): Promise<void> {
    // Generated craters keep clear of every sample site, mission start and the depot.
    const keepClear = [...this.samples, ...MISSIONS.map((m) => m.start), DEPOT];
    await this.world.loadArea(this.manifest!, id, keepClear);
    const f = this.world.frame!;
    const area = this.manifest!.areas.find((a) => a.id === id)!;
    const w = area.detail.heights.widthM / 2 - AREA_MARGIN_M;
    const h = area.detail.heights.heightM / 2 - AREA_MARGIN_M;
    const sw = f.toLatLon(-w, -h);
    const ne = f.toLatLon(w, h);
    this.bounds = { west: sw.lon, south: sw.lat, east: ne.lon, north: ne.lat };
  }

  /** The rover parked at the landing site, the camera circling it (behind the mission menu). */
  private showcase(): void {
    this.rover = initialRover(SHOWCASE.lat, SHOWCASE.lon, (200 * Math.PI) / 180);
    this.rover = this.settle(this.rover);
    this.world.setCameraMode('far');
    this.world.rig.snap(this.rover.headingRad);
    this.clearLabels();
    useGame.getState().set({ phase: 'briefing', camera: 'chase' });
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

  // ---------- mission flow ----------

  async start(id: MissionId): Promise<void> {
    const mission = MISSIONS.find((m) => m.id === id);
    if (!mission) return;
    this.audio.unlock();
    useGame.getState().set({
      phase: 'loading',
      missionId: id,
      targets: [],
      collected: [],
      deposited: false,
      card: null,
      result: null,
      hud: EMPTY_HUD,
    });
    await this.useArea(mission.id);
    if (this.destroyed) return;
    this.mission = mission;
    this.targets = missionTargets(mission, this.samples);
    this.progress = newProgress();
    this.elapsedS = 0;
    this.science = { points: 0, rocks: 0 };
    this.laser = null;
    this.world.setLaser(null);
    this.storm = {
      phase: 'clear',
      t: 0,
      nextS: STORM.firstS + Math.random() * STORM.firstJitterS,
      level: 0,
    };
    this.world.setStorm(0);
    const start = mission.start;
    const first = nearestRemaining(
      initialRover(start.lat, start.lon, 0),
      this.targets,
      this.progress,
    );
    this.rover = this.settle(
      initialRover(start.lat, start.lon, first ? bearingRad(start, first) : 0),
    );
    this.world.tracks.clear();
    this.world.setTargets(this.targets);
    this.buildLabels();
    this.world.setCameraMode('chase');
    this.world.rig.snap(this.rover.headingRad, !this.reduced);
    useGame.getState().set({ targets: this.targets, camera: 'chase', finding: null });
    this.resume();
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

  /** Back to driving (after the start, a sample card or the pause menu). */
  resume(): void {
    this.controls.clear();
    this.controls.enabled = true;
    useGame.getState().set({ phase: 'playing', card: null });
  }

  pause(): void {
    if (useGame.getState().phase !== 'playing') return;
    this.controls.enabled = false;
    useGame.getState().set({ phase: 'paused' });
  }

  /** Leaves the mission for the mission menu. */
  quit(): void {
    this.controls.enabled = false;
    this.world.clearTargets();
    this.mission = null;
    this.laser = null;
    this.world.setLaser(null);
    this.world.setStorm(0);
    useGame
      .getState()
      .set({ phase: 'loading', missionId: null, card: null, result: null, finding: null });
    void this.useArea('floor').then(() => !this.destroyed && this.showcase());
  }

  private command(c: Command): void {
    const ui = useGame.getState();
    if (c === 'camera') {
      if (ui.phase === 'playing') ui.set({ camera: this.world.rig.cycle() });
    } else if (c === 'map') ui.set({ mapOpen: !ui.mapOpen });
    else if (c === 'pause') {
      if (ui.phase === 'playing') this.pause();
      else if (ui.phase === 'paused') this.resume();
      else if (ui.phase === 'card') this.closeCard();
      else if (ui.phase === 'photo') this.exitPhoto();
    } else if (c === 'laser') this.fireLaser();
    else if (c === 'photo') {
      if (ui.phase === 'photo') this.exitPhoto();
      else this.enterPhoto();
    }
  }

  // ---------- SuperCam laser ----------

  /** Starts an analysis of the rock at the centre of the view (stopped, not coring). */
  fireLaser(): void {
    const ui = useGame.getState();
    const rock = this.laserCandidate;
    if (ui.phase !== 'playing' || !this.mission || this.laser || this.progress.action) return;
    if (!rock || Math.abs(this.rover.speed) > STOPPED_MPS) return;
    const key = `${this.mission.id}:${rockKey(rock.x, rock.north)}`;
    if (isAnalysed(key)) return;
    const at = this.world.rockTop(rock, new Vector3());
    this.laser = { rock, key, t: 0, at, pulses: 0 };
  }

  private stepLaser(dt: number): void {
    const l = this.laser;
    if (!l || !this.mission) return;
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
    const type = rockType(this.mission.id, rockKey(l.rock.x, l.rock.north), l.rock.dark);
    const { points, first } = recordRock(type, l.key, POINTS[type]);
    this.science.points += points;
    this.science.rocks++;
    this.rover = {
      ...this.rover,
      batteryPct: Math.max(0, this.rover.batteryPct - LASER_COST_PCT),
      energyUsedPct: this.rover.energyUsedPct + LASER_COST_PCT,
    };
    this.laser = null;
    this.world.setLaser(null);
    this.audio.chime(false);
    useGame.getState().set({ finding: { type, key: l.key, points, first } });
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
      missionId: this.mission?.id ?? null,
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

  private finish(): void {
    const id = this.mission!.id;
    const previous = readBest(id);
    const newBest = previous === null || this.elapsedS < previous;
    if (newBest) writeBest(id, this.elapsedS);
    const result: MissionResult = {
      missionId: id,
      elapsedS: this.elapsedS,
      odometerM: this.rover.odometerM,
      energyUsedPct: this.rover.energyUsedPct,
      tubes: this.targets.reduce((n, t) => n + t.tubes, 0),
      bestS: newBest ? this.elapsedS : previous,
      newBest,
      science: this.science.points,
      rocks: this.science.rocks,
      wheelsPct: this.rover.wheelsPct,
    };
    this.world.setStorm(0);
    this.controls.enabled = false;
    this.audio.chime(true);
    useGame.getState().set({ phase: 'complete', result });
  }

  /** Card closed: a mission whose last sample it was is then complete. */
  closeCard(): void {
    if (isComplete(this.targets, this.progress)) this.finish();
    else this.resume();
  }

  // ---------- frame loop ----------

  private readonly loop = (ts: number): void => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, Math.max(0, (ts - this.last) / 1000));
    this.last = ts;
    const phase = useGame.getState().phase;
    const prev = this.rover;
    let coring: number | null = null;
    if (phase === 'playing' && this.mission) {
      coring = this.step(dt);
    } else if (phase === 'briefing' && !this.reduced) {
      this.world.rig.orbit(dt * 0.07);
    }
    const r = this.rover;
    const f = this.world.frame;
    if (!f) return;
    const [x, n] = f.toLocal(r.lat, r.lon);
    const yawRate = dt > 0 ? wrapAngle(r.headingRad - prev.headingRad) / dt : 0;
    const distanceM = phase === 'playing' ? r.odometerM - prev.odometerM : 0;
    this.world.frameUpdate(
      dt,
      {
        x,
        y: r.heightM,
        z: -n,
        headingRad: r.headingRad,
        pitchRad: r.pitchRad,
        rollRad: r.rollRad,
      },
      {
        speed: phase === 'playing' ? r.speed : 0,
        yawRate: phase === 'playing' ? yawRate : 0,
        distanceM: Math.sign(r.speed) * distanceM,
        slip: phase === 'playing' ? r.slip : 0,
        sinkage: r.sinkage,
      },
      coring,
    );
    const rough =
      dt > 0 ? (Math.abs(r.pitchRad - prev.pitchRad) + Math.abs(r.rollRad - prev.rollRad)) / dt : 0;
    this.world.render(dt, {
      at: this.world.rover!.root.position,
      headingRad: r.headingRad,
      speed: phase === 'playing' ? r.speed : 0,
      rough: rough * 0.6,
      coring: coring === null ? 0 : Math.min(1, Math.min(coring, 1 - coring) * 5),
    });
    this.audio.update(dt, {
      speed: phase === 'playing' ? Math.abs(r.speed) : 0,
      drilling: coring !== null && coring > DRILL_PHASE[0] && coring < DRILL_PHASE[1],
      wind: phase !== 'loading' ? 1 + 2.5 * this.world.stormLevel : 0,
    });
    this.updateLabels();
    this.updateReticle();
  };

  /** One simulation step while playing; returns the coring progress (0–1) or null. */
  private step(dt: number): number | null {
    const input = this.controls.read();
    const busy = this.progress.action !== null || this.laser !== null;
    this.stepStorm(dt);
    const stuckBefore = this.rover.stuck;
    this.rover = stepRover(
      this.rover,
      busy ? { throttle: 0, steer: 0, boost: false } : input,
      dt,
      this.ground,
      this.bounds,
      // AutoNav slows down when the storm hides the terrain.
      { speedFactor: 1 - 0.45 * this.storm.level },
    );
    if (this.rover.stuck && !stuckBefore) this.audio.warn();
    if (this.rover.wearPct > 0) this.wearShownS = 1.2;
    else this.wearShownS = Math.max(0, this.wearShownS - dt);
    this.stepLaser(dt);
    const { progress, event } = stepProgress(
      this.progress,
      this.rover,
      this.targets,
      input.action && !this.laser,
      dt,
    );
    this.progress = progress;
    this.elapsedS += dt;
    const action = progress.action;
    const fraction = action ? action.heldS / (action.kind === 'core' ? CORE_S : DEPOSIT_S) : null;
    this.sinceHud += dt;
    if (this.sinceHud >= HUD_EVERY_S || event) {
      this.sinceHud = 0;
      this.publish(input.boost && input.throttle > 0, fraction);
    }
    if (event?.kind === 'collected') {
      this.rover = {
        ...this.rover,
        batteryPct: Math.max(0, this.rover.batteryPct - CORE_COST_PCT),
        energyUsedPct: this.rover.energyUsedPct + CORE_COST_PCT,
      };
      this.world.markDone(event.target.id);
      recordSample(event.target.id);
      this.refreshLabels();
      this.controls.enabled = false;
      this.audio.chime(false);
      useGame.getState().set({ collected: progress.collected, card: event.target, phase: 'card' });
    } else if (event?.kind === 'deposited') {
      this.world.markDone('depot');
      this.refreshLabels();
      useGame.getState().set({ deposited: true });
    }
    if (isComplete(this.targets, progress) && useGame.getState().phase !== 'card') this.finish();
    return action?.kind === 'core' ? fraction : null;
  }

  private publish(boosting: boolean, fraction: number | null): void {
    const r = this.rover;
    const next = nearestRemaining(r, this.targets, this.progress);
    const here = targetHere(r, this.targets, this.progress);
    // The rock SuperCam would analyse (stopped, nothing else under way).
    const idle = Math.abs(r.speed) <= STOPPED_MPS && !this.progress.action && !this.laser;
    this.laserCandidate = idle ? this.world.laserTarget(LASER_RANGE_M) : null;
    const cand = this.laserCandidate;
    const laserTarget =
      cand && this.mission
        ? isAnalysed(`${this.mission.id}:${rockKey(cand.x, cand.north)}`)
          ? ('done' as const)
          : ('ready' as const)
        : null;
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
          relDeg: wrapAngle(bearingRad(r, next) - this.world.rig.headingRad) * RAD_TO_DEG,
        },
        here: here && {
          id: here.id,
          name: here.name,
          kind: here.kind,
          stopped: Math.abs(r.speed) <= STOPPED_MPS,
        },
        action:
          this.progress.action && fraction !== null
            ? { kind: this.progress.action.kind, fraction: Math.min(1, fraction) }
            : null,
        sand: r.sand,
        slip: r.slip,
        stuck: r.stuck,
        wheelsPct: r.wheelsPct,
        wearing: this.wearShownS > 0,
        storm:
          this.storm.phase === 'warning' ? 'warning' : this.storm.level > 0.15 ? 'active' : null,
        science: this.science.points,
        laser: this.laser ? { fraction: Math.min(1, this.laser.t / LASER_S) } : null,
        laserTarget,
      },
    });
  }

  // ---------- target labels (DOM, projected each frame) ----------

  private buildLabels(): void {
    this.clearLabels();
    for (const t of this.targets) {
      const el = document.createElement('div');
      el.className = `game-label ${t.kind === 'depot' ? 'is-depot' : ''}`;
      el.textContent = t.name;
      this.labelLayer.appendChild(el);
      this.labels.set(t.id, el);
    }
  }

  private refreshLabels(): void {
    for (const t of this.targets) {
      const el = this.labels.get(t.id);
      const done =
        t.kind === 'depot' ? this.progress.deposited : this.progress.collected.includes(t.id);
      if (el) {
        el.classList.toggle('is-done', done);
        el.textContent = `${done ? '✓ ' : ''}${t.name}`;
      }
    }
  }

  private clearLabels(): void {
    for (const el of this.labels.values()) el.remove();
    this.labels.clear();
  }

  /** Projects the labels above their sites; nearer ones win where two would overlap. */
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

  private updateLabels(): void {
    const f = this.world.frame;
    if (!f || !this.labels.size) return;
    const p = this.world.camera.position;
    const w = this.world.host.clientWidth;
    const h = this.world.host.clientHeight;
    const items = this.targets.map((t) => {
      const [x, n] = f.toLocal(t.lat, t.lon);
      const y = this.world.groundY(x, -n) + 9;
      return { t, x, y, z: -n, d: Math.hypot(x - p.x, y - p.y, -n - p.z) };
    });
    items.sort((a, b) => a.d - b.d);
    const placed: Array<[number, number, number, number]> = [];
    for (const it of items) {
      const el = this.labels.get(it.t.id)!;
      const v = this.world.project(it.x, it.y, it.z);
      let visible = v.z < 1 && it.d > 14 && it.d < 6000;
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

  /** Rover position, heading and camera, for the mini-map (read every animation frame). */
  get roverPose(): { lat: number; lon: number; headingRad: number; cameraRad: number } {
    return {
      lat: this.rover.lat,
      lon: this.rover.lon,
      headingRad: this.rover.headingRad,
      cameraRad: this.world.rig.headingRad,
    };
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
