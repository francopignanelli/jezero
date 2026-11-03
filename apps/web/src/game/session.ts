import { RAD_TO_DEG, nextLocalTrueSolarTime } from '@copernico/domain';
import { DATA_VERSION, JEZERO, dataUrl } from '../config';
import { loadCoverage, loadSamples, type SampleSite } from '../data/surfaceData';
import { wrapAngle } from '../lib/math';
import { frameTime, prefersReducedMotion } from '../lib/motion';
import type { Annotation } from '../render/annotations';
import { addImageryTiers } from '../render/imageryTiers';
import { MarsScene } from '../render/marsScene';
import { Controls, type Command } from './controls';
import { GameView } from './gameView';
import {
  CORE_COST_PCT,
  CORE_S,
  DEPOSIT_S,
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
  type RoverState,
} from './roverSim';
import { EMPTY_HUD, useGame, type MissionResult } from './store';

const HUD_EVERY_S = 0.1;
/** Where the rover waits, slowly circled by the camera, while a mission is chosen. */
const SHOWCASE = MISSIONS[0]!.start;
const BEST_KEY = 'copernico.game.best.';

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

/**
 * The rover game: Perseverance on the real Jezero terrain (the planner's own scene, imagery and
 * sky), driven with the keyboard or the touch pad to real sample sites. One instance per page.
 */
export class GameSession {
  readonly view: GameView;
  readonly controls: Controls;
  private samples: SampleSite[] = [];
  private bounds: Bounds = { west: 77.28, south: 18.4, east: 77.48, north: 18.52 };
  private mission: MissionDef | null = null;
  private targets: Target[] = [];
  private progress: Progress = newProgress();
  private rover: RoverState = initialRover(SHOWCASE.lat, SHOWCASE.lon, 0);
  private elapsedS = 0;
  private sinceHud = 0;
  private last = frameTime();
  private readonly reduced = prefersReducedMotion();
  private readonly removeTick: () => void;

  private constructor(readonly scene: MarsScene) {
    this.view = new GameView(scene);
    this.controls = new Controls((c) => this.command(c));
    this.controls.enabled = false;
    this.removeTick = scene.widget.scene.preRender.addEventListener(() => this.tick());
  }

  /** Builds the scene (synchronously, so a discarded mount can destroy it at once); null without WebGL. */
  static open(host: HTMLElement): GameSession | null {
    try {
      return new GameSession(new MarsScene(host));
    } catch {
      return null;
    }
  }

  /** Loads everything the game needs; resolves false if data is missing or the session was destroyed. */
  async load(): Promise<boolean> {
    const { scene } = this;
    scene.setReducedMotion(this.reduced);
    scene.setSunTime(nextLocalTrueSolarTime(Date.now(), JEZERO, 10.5));
    scene.takeCamera(true);
    scene.setView(SHOWCASE.lat - 0.0003, SHOWCASE.lon, -2_520, 0, -20);
    const [terrainOk, , samples, coverage, model] = await Promise.all([
      scene.loadTerrain(dataUrl('tiles/terrain'), DATA_VERSION),
      addImageryTiers(scene),
      loadSamples(),
      loadCoverage(),
      this.view.loadRover(dataUrl(`models/perseverance.glb?v=${DATA_VERSION}`)),
      // Daytime surface sky; the 8K Milky Way is never needed down here (no upgrade).
      scene.loadSky(
        dataUrl(`sky/stars.json?v=${DATA_VERSION}`),
        {
          hd: dataUrl(`sky/milkyway_8k.webp?v=${DATA_VERSION}`),
          sd: dataUrl(`sky/milkyway_4k.webp?v=${DATA_VERSION}`),
        },
        undefined,
        new Promise(() => {}),
      ),
    ]);
    if (!terrainOk || !samples || !model || scene.isDestroyed()) return false;
    this.samples = samples.samples;
    const ring = coverage?.features[0]?.geometry.coordinates[0];
    if (ring) {
      const lons = ring.map((p) => p[0]);
      const lats = ring.map((p) => p[1]);
      this.bounds = {
        west: Math.min(...lons),
        east: Math.max(...lons),
        south: Math.min(...lats),
        north: Math.max(...lats),
      };
    }
    await this.showcase();
    if (scene.isDestroyed()) return false;
    if (import.meta.env.DEV)
      (window as unknown as { __copernicoGame?: unknown }).__copernicoGame = this;
    return true;
  }

  /** The rover parked at the landing site, the camera circling it (behind the mission menu). */
  private async showcase(): Promise<void> {
    const [h] = await this.scene.sampleTerrain([SHOWCASE]);
    if (this.scene.isDestroyed()) return;
    this.rover = initialRover(SHOWCASE.lat, SHOWCASE.lon, (200 * Math.PI) / 180, h ?? -2_570);
    this.rover = stepRover(
      this.rover,
      { throttle: 0, steer: 0, boost: false },
      0.5,
      this.view.ground,
      this.bounds,
    );
    this.view.mode = 'far';
    this.view.snapCamera(this.rover);
    this.view.placeRover(this.rover, null, 0);
    await this.scene.whenTilesLoaded(15_000);
    if (this.scene.isDestroyed()) return;
    this.view.placeRover(this.rover, null, 0);
    useGame.getState().set({ phase: 'briefing', camera: 'chase' });
    this.scene.requestRender();
  }

  // ---------- mission flow ----------

  async start(id: MissionId): Promise<void> {
    const mission = MISSIONS.find((m) => m.id === id);
    if (!mission) return;
    this.mission = mission;
    this.targets = missionTargets(mission, this.samples);
    this.progress = newProgress();
    this.elapsedS = 0;
    useGame.getState().set({
      phase: 'loading',
      missionId: id,
      targets: this.targets,
      collected: [],
      deposited: false,
      card: null,
      result: null,
      hud: EMPTY_HUD,
    });
    const heights = await this.scene.sampleTerrain([mission.start, ...this.targets]);
    const start = { ...mission.start, heightM: heights[0] ?? 0 };
    const first = nearestRemaining(
      initialRover(start.lat, start.lon, 0),
      this.targets,
      this.progress,
    );
    const heading = first ? bearingRad(start, first) : 0;
    this.rover = initialRover(start.lat, start.lon, heading, start.heightM);
    const placed = this.targets.map((t, i) => ({ ...t, heightM: heights[i + 1] ?? start.heightM }));
    await this.view.setTargets(placed);
    this.setTargetLabels(placed);
    this.view.mode = 'chase';
    this.view.snapCamera(this.rover);
    // Ground-level tiles around the start, then settle the wheels on them.
    await this.scene.whenTilesLoaded(12_000);
    this.rover = stepRover(
      this.rover,
      { throttle: 0, steer: 0, boost: false },
      0.5,
      this.view.ground,
      this.bounds,
    );
    this.view.snapCamera(this.rover);
    this.resume();
  }

  private setTargetLabels(targets: Array<Target & { heightM: number }>): void {
    const done = new Set(this.progress.collected);
    const labels: Annotation[] = targets.map((t) => ({
      id: `game:${t.id}`,
      lat: t.lat,
      lon: t.lon,
      heightM: t.heightM + 2,
      text: `${done.has(t.id) || (t.kind === 'depot' && this.progress.deposited) ? '✓ ' : ''}${t.name}`,
      kind: 'poi',
      priority: t.kind === 'depot' ? 60 : 80,
      maxCameraDistanceM: 30_000,
      minCameraDistanceM: 25,
    }));
    this.scene.setAnnotations('game-targets', labels);
    this.labelled = targets;
  }
  private labelled: Array<Target & { heightM: number }> = [];

  /** Back to driving (after the start, a sample card or the pause menu). */
  resume(): void {
    this.controls.clear();
    this.controls.enabled = true;
    this.last = frameTime();
    useGame.getState().set({ phase: 'playing', card: null });
    this.scene.requestRender();
  }

  pause(): void {
    if (useGame.getState().phase !== 'playing') return;
    this.controls.enabled = false;
    useGame.getState().set({ phase: 'paused' });
  }

  /** Leaves the mission for the mission menu. */
  quit(): void {
    this.controls.enabled = false;
    this.view.clearTargets();
    this.scene.setAnnotations('game-targets', []);
    this.mission = null;
    useGame.getState().set({ phase: 'loading', missionId: null, card: null, result: null });
    void this.showcase();
  }

  private command(c: Command): void {
    const ui = useGame.getState();
    if (c === 'camera') ui.set({ camera: this.view.cycleCamera() });
    else if (c === 'map') ui.set({ mapOpen: !ui.mapOpen });
    else if (c === 'pause') {
      if (ui.phase === 'playing') this.pause();
      else if (ui.phase === 'paused') this.resume();
      else if (ui.phase === 'card') this.closeCard();
    }
    this.scene.requestRender();
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
    };
    this.controls.enabled = false;
    useGame.getState().set({ phase: 'complete', result });
  }

  // ---------- frame loop ----------

  private tick(): void {
    const now = frameTime();
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const phase = useGame.getState().phase;
    if (phase === 'briefing') {
      // Slow orbit around the parked rover.
      if (!this.reduced) this.view.orbit(dt * 0.07);
      this.view.updateCamera(this.rover, dt);
      if (!this.reduced) this.scene.requestRender();
      return;
    }
    if (phase !== 'playing' || !this.mission) return;

    const input = this.controls.read();
    const busy = this.progress.action !== null;
    this.rover = stepRover(
      this.rover,
      busy ? { throttle: 0, steer: 0, boost: false } : input,
      dt,
      this.view.ground,
      this.bounds,
    );
    const { progress, event } = stepProgress(
      this.progress,
      this.rover,
      this.targets,
      input.action,
      dt,
    );
    this.progress = progress;
    this.elapsedS += dt;
    const action = progress.action;
    const fraction = action ? action.heldS / (action.kind === 'core' ? CORE_S : DEPOSIT_S) : null;
    this.view.placeRover(this.rover, action?.kind === 'core' ? fraction : null, this.elapsedS);
    this.view.updateCamera(this.rover, dt);

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
      this.view.markDone(event.target.id);
      this.setTargetLabels(this.labelled);
      this.controls.enabled = false;
      useGame.getState().set({ collected: progress.collected, card: event.target, phase: 'card' });
    } else if (event?.kind === 'deposited') {
      this.view.markDone('depot');
      this.setTargetLabels(this.labelled);
      useGame.getState().set({ deposited: true });
    }
    if (isComplete(this.targets, progress) && useGame.getState().phase !== 'card') this.finish();
    this.scene.requestRender(); // keep rendering: the next frame runs this again
  }

  private publish(boosting: boolean, fraction: number | null): void {
    const r = this.rover;
    const next = nearestRemaining(r, this.targets, this.progress);
    const here = targetHere(r, this.targets, this.progress);
    const ui = useGame.getState();
    ui.set({
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
          relDeg: wrapAngle(bearingRad(r, next) - this.view.cameraHeadingRad) * RAD_TO_DEG,
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
      },
    });
  }

  get sampleSites(): SampleSite[] {
    return this.samples;
  }

  cycleCamera(): void {
    this.command('camera');
  }

  /** Card closed: a mission whose last sample it was is then complete. */
  closeCard(): void {
    if (isComplete(this.targets, this.progress)) this.finish();
    else this.resume();
  }

  /** Rover position, heading and camera, for the mini-map (read every animation frame). */
  get roverPose(): { lat: number; lon: number; headingRad: number; cameraRad: number } {
    return {
      lat: this.rover.lat,
      lon: this.rover.lon,
      headingRad: this.rover.headingRad,
      cameraRad: this.view.cameraHeadingRad,
    };
  }

  /** Test hook (development builds): the rover state, and a jump to a position. */
  get state(): RoverState {
    return this.rover;
  }

  teleport(lat: number, lon: number): void {
    const h = this.view.ground.height(lat, lon) ?? this.rover.heightM;
    this.rover = { ...this.rover, lat, lon, heightM: h, speed: 0 };
    this.view.snapCamera(this.rover);
  }

  destroy(): void {
    if (this.scene.isDestroyed()) return;
    this.removeTick();
    this.controls.dispose();
    this.scene.destroy();
  }
}
