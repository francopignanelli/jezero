import { create } from 'zustand';
import type { CameraMode } from './world/cameraRig';
import type { PhotoFilter } from './world/world';
import type { MissionId, Target } from './missions';
import type { Blocked } from './roverSim';
import type { RockType } from './science';

export type Phase =
  'loading' | 'briefing' | 'playing' | 'paused' | 'card' | 'complete' | 'photo' | 'failed';

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
  /** Nearest remaining target: distance and bearing relative to the camera (°, clockwise). */
  next: {
    id: string;
    name: string;
    kind: Target['kind'];
    distanceM: number;
    relDeg: number;
  } | null;
  /** Target whose zone the rover is in. */
  here: { id: string; name: string; kind: Target['kind']; stopped: boolean } | null;
  action: { kind: 'core' | 'deposit'; fraction: number } | null;
  /** Hazards: sand under the rover (0–1), slip (0–1), stuck; wheel health (%), wearing now. */
  sand: number;
  slip: number;
  stuck: boolean;
  wheelsPct: number;
  wearing: boolean;
  /** Dust storm: announced, or blowing. */
  storm: 'warning' | 'active' | null;
  /** Science points this mission; the laser's state. */
  science: number;
  laser: { fraction: number } | null;
  /** A rock in the laser's range at the centre of the view: new, or already analysed. */
  laserTarget: 'ready' | 'done' | null;
}

export interface MissionResult {
  missionId: MissionId;
  elapsedS: number;
  odometerM: number;
  energyUsedPct: number;
  tubes: number;
  bestS: number | null;
  newBest: boolean;
  science: number;
  rocks: number;
  wheelsPct: number;
}

/** The result of a laser analysis (shown as a panel for a few seconds). */
export interface Finding {
  type: RockType;
  key: string;
  points: number;
  first: boolean;
}

interface GameUi {
  phase: Phase;
  missionId: MissionId | null;
  targets: Target[];
  collected: string[];
  deposited: boolean;
  camera: CameraMode;
  mapOpen: boolean;
  hud: Hud;
  /** Sample just collected (its card is open). */
  card: Target | null;
  result: MissionResult | null;
  finding: Finding | null;
  photoFilter: PhotoFilter;
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
  sand: 0,
  slip: 0,
  stuck: false,
  wheelsPct: 100,
  wearing: false,
  storm: null,
  science: 0,
  laser: null,
  laserTarget: null,
};

export const useGame = create<GameUi>((set) => ({
  phase: 'loading',
  missionId: null,
  targets: [],
  collected: [],
  deposited: false,
  camera: 'chase',
  mapOpen: true,
  hud: EMPTY_HUD,
  card: null,
  result: null,
  finding: null,
  photoFilter: 'natural',
  set: (patch) => set(patch),
}));
