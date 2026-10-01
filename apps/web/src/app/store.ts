import { nextLocalTrueSolarTime, type RouteComparison, type RouteProfile } from '@copernico/domain';
import { JEZERO } from '../config';
import { create } from 'zustand';

export type Mode = 'orbit' | 'jezero';
export type Tab = 'explore' | 'layers' | 'route' | 'science' | 'environment' | 'missions';

export type LayerId =
  | 'viking'
  | 'ctx'
  | 'hirise'
  | 'coverage'
  | 'slope'
  | 'elevation'
  | 'thermalInertia'
  | 'rover'
  | 'samples'
  | 'pois'
  | 'ingenuity'
  | 'sky';

export interface WaypointEntry {
  id: string;
  /** Planetocentric latitude (deg). */
  lat: number;
  /** East longitude in [0, 360) (deg). */
  lon: number;
  label?: string;
  poiId?: string;
}

export type GridStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

export type LoadStep = 'pending' | 'done' | 'failed';
/** Startup assets the scene waits for before it is revealed (see LoadingScreen). */
export interface LoadingState {
  stars: LoadStep;
  sky: 'pending' | 'hd' | 'sd' | 'failed';
  terrain: LoadStep;
  imagery: LoadStep;
  tiles: LoadStep;
  surface: LoadStep;
}

interface AppState {
  mode: Mode;
  tab: Tab;
  /** Side panel (desktop) / bottom sheet (mobile) visibility. */
  panelOpen: boolean;
  layers: Record<LayerId, boolean>;
  waypoints: WaypointEntry[];
  picking: boolean;
  profile: RouteProfile;
  returnToStart: boolean;
  gridStatus: GridStatus;
  computing: boolean;
  result: RouteComparison | null;
  selectedPoiId: string | null;
  evaStartUtcMs: number;
  flyRequest: { lat: number; lon: number; nonce: number } | null;
  loading: LoadingState;
  sceneReady: boolean;
  setLoading(p: Partial<LoadingState>): void;
  setSceneReady(v: boolean): void;
  setMode(mode: Mode): void;
  setTab(tab: Tab): void;
  setPanelOpen(open: boolean): void;
  setLayer(id: LayerId, visible: boolean): void;
  addWaypoint(w: Omit<WaypointEntry, 'id'>): void;
  removeWaypoint(id: string): void;
  moveWaypoint(id: string, delta: -1 | 1): void;
  setWaypoints(list: Array<Omit<WaypointEntry, 'id'>>): void;
  clearWaypoints(): void;
  setPicking(v: boolean): void;
  setProfile(p: RouteProfile): void;
  setReturnToStart(v: boolean): void;
  setGridStatus(s: GridStatus): void;
  setComputing(v: boolean): void;
  setResult(r: RouteComparison | null): void;
  selectPoi(id: string | null): void;
  setEvaStart(ms: number): void;
  flyTo(lat: number, lon: number): void;
}

let nextId = 1;
const withId = (w: Omit<WaypointEntry, 'id'>): WaypointEntry => ({ ...w, id: `wp${nextId++}` });

export const useApp = create<AppState>((set) => ({
  mode: 'orbit',
  tab: 'explore',
  panelOpen: true,
  layers: {
    viking: true,
    ctx: true,
    hirise: true,
    coverage: true,
    slope: false,
    elevation: false,
    thermalInertia: false,
    rover: true,
    samples: true,
    pois: true,
    ingenuity: false,
    sky: true,
  },
  waypoints: [],
  picking: false,
  profile: 'lower-risk',
  returnToStart: true,
  gridStatus: 'idle',
  computing: false,
  result: null,
  selectedPoiId: null,
  // Default planned EVA start: next 10:00 local true solar time at Jezero (calculated, editable).
  evaStartUtcMs: nextLocalTrueSolarTime(Date.now(), JEZERO, 10),
  flyRequest: null,
  loading: {
    stars: 'pending',
    sky: 'pending',
    terrain: 'pending',
    imagery: 'pending',
    tiles: 'pending',
    surface: 'pending',
  },
  sceneReady: false,
  setLoading: (p) => set((s) => ({ loading: { ...s.loading, ...p } })),
  setSceneReady: (sceneReady) => set({ sceneReady }),
  setMode: (mode) => set({ mode }),
  setTab: (tab) => set({ tab, panelOpen: true }),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  setLayer: (id, visible) => set((s) => ({ layers: { ...s.layers, [id]: visible } })),
  addWaypoint: (w) => set((s) => ({ waypoints: [...s.waypoints, withId(w)], result: null })),
  removeWaypoint: (id) =>
    set((s) => ({ waypoints: s.waypoints.filter((w) => w.id !== id), result: null })),
  moveWaypoint: (id, delta) =>
    set((s) => {
      const i = s.waypoints.findIndex((w) => w.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= s.waypoints.length) return s;
      const list = [...s.waypoints];
      [list[i], list[j]] = [list[j]!, list[i]!];
      return { waypoints: list, result: null };
    }),
  setWaypoints: (list) => set({ waypoints: list.map(withId), result: null }),
  clearWaypoints: () => set({ waypoints: [], result: null }),
  setPicking: (picking) => set({ picking }),
  setProfile: (profile) => set({ profile }),
  setReturnToStart: (returnToStart) => set({ returnToStart, result: null }),
  setGridStatus: (gridStatus) => set({ gridStatus }),
  setComputing: (computing) => set({ computing }),
  setResult: (result) => set({ result }),
  selectPoi: (selectedPoiId) => set({ selectedPoiId }),
  setEvaStart: (evaStartUtcMs) => set({ evaStartUtcMs }),
  flyTo: (lat, lon) => set({ flyRequest: { lat, lon, nonce: Date.now() } }),
}));
