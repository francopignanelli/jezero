import { nextLocalTrueSolarTime, type RouteComparison, type RouteProfile } from '@copernico/domain';
import { JEZERO } from '../config';
import { create } from 'zustand';
import type { OverlayKind } from '../features/routes/overlays';

export type Mode = 'orbit' | 'jezero';
export type Tab = 'explore' | 'route' | 'science' | 'environment';

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
  | 'sky'
  | 'reach'
  | 'crism';

export interface WaypointEntry {
  id: string;
  /** Planetocentric latitude (deg). */
  lat: number;
  /** East longitude in [0, 360) (deg). */
  lon: number;
  label?: string;
  poiId?: string;
  /** Minutes spent working at this stop (default DEFAULT_DWELL_MIN). */
  dwellMin?: number;
}

/** Camera target for a fly-to: height of the target point (m), distance and pitch of the view. */
export interface FlyOptions {
  heightM?: number;
  rangeM?: number;
  pitchDeg?: number;
  headingDeg?: number;
  /** Aim at a placed 3D model instead of lat/lon/height (e.g. 'roverModel'). */
  model?: string;
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
  flyRequest: ({ lat: number; lon: number; nonce: number } & FlyOptions) | null;
  loading: LoadingState;
  sceneReady: boolean;
  /** Value ranges of the computed overlays (for their map legends). */
  overlayRanges: Partial<Record<OverlayKind, [number, number]>>;
  /** Distance (m) along the selected route under the profile cursor, or null. */
  routeCursorM: number | null;
  /** Route fly-through: a request nonce, and whether it is running. */
  /** Guide: first-run welcome, guided tour step (null = not running), glossary (term to focus). */
  welcomeOpen: boolean;
  setWelcomeOpen(open: boolean): void;
  tourStep: number | null;
  setTourStep(step: number | null): void;
  glossary: { open: boolean; term: string | null };
  openGlossary(term?: string | null): void;
  closeGlossary(): void;
  /** Draw the selected route coloured by slope band instead of one colour. */
  routeSlopeColours: boolean;
  setRouteSlopeColours(v: boolean): void;
  playRequest: number | null;
  /** Which CRISM browse composite is shown (carbonate/clay or mafic). */
  crismComposite: 'car' | 'maf';
  setCrismComposite(c: 'car' | 'maf'): void;
  playing: boolean;
  setPlay(request: number | null, playing: boolean): void;
  /** Round-trip reach overlay from the first waypoint (bands in hours, cumulative areas). */
  reach: { bandsH: number[]; areaKm2: number[]; elapsedMs: number } | null;
  setReach(r: { bandsH: number[]; areaKm2: number[]; elapsedMs: number } | null): void;
  setRouteCursor(d: number | null): void;
  setOverlayRange(kind: OverlayKind, range: [number, number]): void;
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
  /** Worker compute time of the last result (ms). */
  computeMs: number | null;
  setComputeMs(ms: number | null): void;
  /** Point picked with the inspector (click on the map outside waypoint picking). */
  inspected: { lat: number; lon: number } | null;
  setInspected(p: { lat: number; lon: number } | null): void;
  insertWaypoint(index: number, w: Omit<WaypointEntry, 'id'>): void;
  /** Saved mission currently open (null id: unsaved, e.g. opened from a share link). */
  activeMission: { id: string | null; name: string } | null;
  setActiveMission(m: { id: string | null; name: string } | null): void;
  /** Incremented whenever saved missions change (re-reads browser storage). */
  missionsVersion: number;
  bumpMissions(): void;
  /** Transient message shown on the map (info) or as an alert (error). */
  notice: { kind: 'info' | 'error'; text: string } | null;
  setNotice(n: { kind: 'info' | 'error'; text: string } | null): void;
  setDwell(id: string, minutes: number): void;
  selectPoi(id: string | null): void;
  setEvaStart(ms: number): void;
  flyTo(lat: number, lon: number, opts?: FlyOptions): void;
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
    reach: false,
    crism: false,
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
  overlayRanges: {},
  routeCursorM: null,
  welcomeOpen: false,
  setWelcomeOpen: (welcomeOpen) => set({ welcomeOpen }),
  tourStep: null,
  setTourStep: (tourStep) => set({ tourStep }),
  glossary: { open: false, term: null },
  openGlossary: (term = null) => set({ glossary: { open: true, term } }),
  closeGlossary: () => set({ glossary: { open: false, term: null } }),
  routeSlopeColours: false,
  setRouteSlopeColours: (routeSlopeColours) => set({ routeSlopeColours }),
  playRequest: null,
  crismComposite: 'car',
  setCrismComposite: (crismComposite) => set({ crismComposite }),
  playing: false,
  setPlay: (playRequest, playing) => set({ playRequest, playing }),
  reach: null,
  setReach: (reach) => set({ reach }),
  setRouteCursor: (routeCursorM) => set({ routeCursorM }),
  setOverlayRange: (kind, range) =>
    set((s) => ({ overlayRanges: { ...s.overlayRanges, [kind]: range } })),
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
  clearWaypoints: () => set({ waypoints: [], result: null, activeMission: null }),
  setPicking: (picking) => set({ picking }),
  setProfile: (profile) => set({ profile }),
  setReturnToStart: (returnToStart) => set({ returnToStart, result: null }),
  setGridStatus: (gridStatus) => set({ gridStatus }),
  setComputing: (computing) => set({ computing }),
  setResult: (result) => set({ result }),
  computeMs: null,
  setComputeMs: (computeMs) => set({ computeMs }),
  inspected: null,
  setInspected: (inspected) => set({ inspected }),
  // Stop time changes the timeline only; the routes stay valid.
  setDwell: (id, minutes) =>
    set((s) => ({
      waypoints: s.waypoints.map((w) => (w.id === id ? { ...w, dwellMin: minutes } : w)),
    })),
  activeMission: null,
  setActiveMission: (activeMission) => set({ activeMission }),
  missionsVersion: 0,
  bumpMissions: () => set((s) => ({ missionsVersion: s.missionsVersion + 1 })),
  notice: null,
  setNotice: (notice) => set({ notice }),
  insertWaypoint: (index, w) =>
    set((s) => {
      const list = [...s.waypoints];
      list.splice(Math.max(0, Math.min(list.length, index)), 0, withId(w));
      return { waypoints: list, result: null };
    }),
  selectPoi: (selectedPoiId) => set({ selectedPoiId }),
  setEvaStart: (evaStartUtcMs) => set({ evaStartUtcMs }),
  flyTo: (lat, lon, opts = {}) => set({ flyRequest: { lat, lon, ...opts, nonce: Date.now() } }),
}));

// Development only: lets browser checks drive the app state directly.
if (import.meta.env.DEV)
  (window as unknown as { __copernicoStore?: typeof useApp }).__copernicoStore = useApp;
