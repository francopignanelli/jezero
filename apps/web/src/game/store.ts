import { create } from 'zustand';
import type { CameraMode } from './world/cameraRig';
import type { PhotoFilter } from './world/world';
import type { VideoId } from '../ui/VideoPlayer';
import type { DeployStage } from './world/deploy';
import {
  newExpedition,
  type ActionKind,
  type ExpeditionState,
  type Find,
  type MissionId,
  type DriveStep,
  type StepId,
  type Target,
  type TargetKind,
} from './expedition';
import type { Blocked } from './roverSim';

export type Phase =
  | 'loading'
  | 'briefing'
  /** NASA's landing video, before the landing mission's first chapter. */
  | 'intro'
  /** NASA's video at a mission's 'film' step (Ingenuity's first flight). */
  | 'film'
  | 'chapter'
  | 'playing'
  | 'paused'
  | 'card'
  | 'panorama'
  | 'inventory'
  | 'complete'
  | 'photo'
  | 'failed';

/** What the HUD shows, published by the game loop ~10 times a second. */
export interface Hud {
  speedMps: number;
  batteryPct: number;
  tiltDeg: number;
  gradeDeg: number;
  blocked: Blocked;
  recharging: boolean;
  boosting: boolean;
  odometerM: number;
  elapsedS: number;
  /** The objective the compass points to: distance and bearing relative to the camera (°, clockwise). */
  next: { id: string; name: string; kind: TargetKind; distanceM: number; relDeg: number } | null;
  /** Target whose zone the rover is in. */
  here: {
    id: string;
    name: string;
    kind: TargetKind;
    stopped: boolean;
    /** At a station: the step done there now, and whether it starts by itself. */
    step?: StepId | null;
    run?: 'chain' | 'arrive' | null;
  } | null;
  /** The sequence under way; `detail`: the stage of a mechanical one (the deployment's). */
  action: { kind: ActionKind; fraction: number; detail?: DeployStage | null } | null;
  /** A drive the mission does itself (off the shield, clear of Ingenuity): how far along (0–1). */
  drive: { step: DriveStep; fraction: number } | null;
  /** Hazards: sand under the rover (0–1), slip (0–1), stuck; wheel health (%), wearing now. */
  sand: number;
  slip: number;
  stuck: boolean;
  wheelsPct: number;
  wearing: boolean;
  /** Dust storm: announced, or blowing. */
  storm: 'warning' | 'active' | null;
  /** The laser's state, and a rock in its range at the centre of the view: new, or done. */
  laser: { fraction: number } | null;
  laserTarget: 'ready' | 'done' | null;
  /** AutoNav driving to a goal; simulation speed (×1, ×2, ×4). */
  autonav: { goal: string; distanceM: number; state: 'driving' | 'recovering' } | null;
  warp: number;
  /** Ingenuity, when it is on the map: distance, and whether it is flying or about to. */
  ingenuity: { distanceM: number; relDeg: number; flying: boolean; ready: boolean } | null;
}

export interface ExpeditionResult {
  elapsedS: number;
  odometerM: number;
  energyUsedPct: number;
  tubes: number;
  depotTubes: number;
  science: number;
  rocks: number;
  panoramas: number;
  flights: number;
  wheelsPct: number;
  bestS: number | null;
  newBest: boolean;
}

/** A short notice (a place reached, Ingenuity flew, tubes left…): an i18n key and its values. */
export interface Toast {
  id: number;
  key: string;
  params?: Record<string, string | number> | undefined;
}

interface GameUi {
  phase: Phase;
  expedition: ExpeditionState;
  /** The delta expedition has saved progress. */
  hasSave: boolean;
  /** Each mission's saved chapter (index), for the menu. */
  saves: Partial<Record<MissionId, number>>;
  /** The mission being played (or shown behind the menu). */
  mission: MissionId;
  /** A NASA video being watched again (over the menu or the pause menu). */
  video: VideoId | null;
  /** Targets open now (current chapter, panorama spots). */
  targets: Target[];
  camera: CameraMode;
  mapOpen: boolean;
  hud: Hud;
  /** Sample just collected (its card is open). */
  card: Target | null;
  /** Panorama shown in the viewer (just taken, or opened from the inventory). */
  panorama: string | null;
  result: ExpeditionResult | null;
  /** The last laser analysis (a panel for a few seconds). */
  finding: Find | null;
  toast: Toast | null;
  photoFilter: PhotoFilter;
  /** AutoNav's planned path (lat, lon), for the map. */
  route: Array<[number, number]> | null;
  set(patch: Partial<Omit<GameUi, 'set'>>): void;
}

export const EMPTY_HUD: Hud = {
  speedMps: 0,
  batteryPct: 100,
  tiltDeg: 0,
  gradeDeg: 0,
  blocked: null,
  recharging: false,
  boosting: false,
  odometerM: 0,
  elapsedS: 0,
  next: null,
  here: null,
  action: null,
  drive: null,
  sand: 0,
  slip: 0,
  stuck: false,
  wheelsPct: 100,
  wearing: false,
  storm: null,
  laser: null,
  laserTarget: null,
  autonav: null,
  warp: 1,
  ingenuity: null,
};

let toastId = 0;
/** Shows a notice. */
export const toast = (key: string, params?: Toast['params']): void =>
  useGame.getState().set({ toast: { id: ++toastId, key, params } });

export const useGame = create<GameUi>((set) => ({
  phase: 'loading',
  expedition: newExpedition(),
  hasSave: false,
  saves: {},
  mission: 'delta',
  video: null,
  targets: [],
  camera: 'chase',
  mapOpen: true,
  hud: EMPTY_HUD,
  card: null,
  panorama: null,
  result: null,
  finding: null,
  toast: null,
  photoFilter: 'natural',
  route: null,
  set: (patch) => set(patch),
}));
