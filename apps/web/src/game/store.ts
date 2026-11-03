import { create } from 'zustand';
import type { CameraMode } from './gameView';
import type { MissionId, Target } from './missions';
import type { Blocked } from './roverSim';

export type Phase = 'loading' | 'briefing' | 'playing' | 'paused' | 'card' | 'complete' | 'failed';

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
}

export interface MissionResult {
  missionId: MissionId;
  elapsedS: number;
  odometerM: number;
  energyUsedPct: number;
  tubes: number;
  bestS: number | null;
  newBest: boolean;
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
  set: (patch) => set(patch),
}));
