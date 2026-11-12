import { useApp, type Tab } from '../../app/store';
import { POIS } from '../../data/catalog';
import { loadGuidedMarswalk } from '../exploration/guided';
import { computeRoutes } from '../routes/compute';

/**
 * Guided tour, in chapters that match the tabs. Each step points at one part of the screen (a
 * `data-tour` anchor) and explains it in plain language. `prepare` puts the app in the state the
 * step needs, so "Next" always works even if the user skipped the suggested action; `action` is the
 * optional "Do it for me", which demo mode runs by itself. Texts live in i18n under
 * tour.steps.<id>.
 */
export type ChapterId = Tab;
export const CHAPTERS: readonly ChapterId[] = [
  'mars',
  'surface',
  'panoramas',
  'marswalk',
  'conditions',
];

export interface TourStep {
  id: string;
  chapter: ChapterId;
  target?: string;
  prepare?: () => Promise<void> | void;
  action?: () => Promise<void> | void;
  /** The map needs a moment to fly or redraw before the highlight makes sense. */
  settleMs?: number;
  /** Demo mode: how long the step stays up after its action (default: by text length). */
  demoMs?: number;
}

const messages = () => ({ needTwo: '', gridUnavailable: '' });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Opens a tab (with its camera place) unless it is already open. */
const show = (tab: Tab) => {
  const s = useApp.getState();
  const place = tab === 'conditions' || s.mode === (tab === 'mars' ? 'orbit' : 'jezero');
  if (s.tab !== tab || !s.panelOpen || !place) s.goTo(tab);
};
/** Steps that do not use the 360° viewer or the walk close them, so the next highlight is visible. */
const calm = () => {
  const s = useApp.getState();
  if (s.panoramaOpen) s.setPanoramaOpen(null);
  if (s.tour) s.setTour(null);
  if (s.playing) s.setPlay(null, false);
};

async function ensureRoute(): Promise<void> {
  const s = useApp.getState();
  if (s.result) return;
  if (s.waypoints.length < 2) loadGuidedMarswalk();
  await computeRoutes(messages());
}

const TOUR_POI = POIS.find((p) => p.id === 'three-forks') ?? POIS[0]!;

export const TOUR: TourStep[] = [
  // ---- Mars ----
  {
    id: 'planet',
    chapter: 'mars',
    target: 'map',
    prepare: () => {
      calm();
      show('mars');
    },
    settleMs: 1500,
  },
  { id: 'panels', chapter: 'mars', target: 'tabs', prepare: () => show('mars') },
  {
    id: 'jezero',
    chapter: 'mars',
    target: 'explore-jezero',
    prepare: () => show('mars'),
    action: () => useApp.getState().goTo('surface'),
  },
  // ---- Surface ----
  {
    id: 'area',
    chapter: 'surface',
    target: 'map',
    prepare: () => {
      calm();
      show('surface');
    },
    settleMs: 6500,
  },
  {
    id: 'rover',
    chapter: 'surface',
    target: 'rover',
    prepare: () => {
      calm();
      show('surface');
    },
    // Perseverance's route, its samples and Ingenuity's flights on the map.
    action: () => {
      const s = useApp.getState();
      s.setLayer('rover', true);
      s.setLayer('samples', true);
      s.setLayer('ingenuity', true);
    },
    demoMs: 7000,
  },
  {
    id: 'ground',
    chapter: 'surface',
    target: 'ground-layers',
    prepare: () => show('surface'),
    action: () => useApp.getState().setLayer('crism', true),
  },
  {
    id: 'inspect',
    chapter: 'surface',
    target: 'map',
    prepare: () => show('surface'),
    action: () => useApp.getState().setInspected({ lat: TOUR_POI.lat, lon: TOUR_POI.lon }),
  },
  {
    id: 'pois',
    chapter: 'surface',
    target: 'pois',
    prepare: () => {
      const s = useApp.getState();
      s.setInspected(null);
      if (s.layers.crism) s.setLayer('crism', false);
      show('surface');
    },
    action: () => {
      const s = useApp.getState();
      s.selectPoi(TOUR_POI.id);
      s.flyTo(TOUR_POI.lat, TOUR_POI.lon);
    },
  },
  // ---- 360° views ----
  {
    id: 'panoramas',
    chapter: 'panoramas',
    target: 'panoramas',
    prepare: () => {
      calm();
      show('panoramas');
    },
    action: () => useApp.getState().setPanoramaOpen('crocodile-bridge'),
  },
  {
    id: 'panoramaView',
    chapter: 'panoramas',
    prepare: () => {
      const s = useApp.getState();
      if (!s.panoramaOpen) s.setPanoramaOpen('crocodile-bridge');
    },
    demoMs: 9000,
  },
  // ---- Marswalk ----
  {
    id: 'guided',
    chapter: 'marswalk',
    target: 'guided',
    prepare: () => {
      calm();
      show('marswalk');
    },
    action: () => loadGuidedMarswalk(),
  },
  {
    id: 'calculate',
    chapter: 'marswalk',
    target: 'calculate',
    prepare: () => {
      if (useApp.getState().waypoints.length < 2) loadGuidedMarswalk();
      show('marswalk');
    },
    action: async () => {
      await computeRoutes(messages());
    },
  },
  {
    id: 'results',
    chapter: 'marswalk',
    target: 'metrics',
    prepare: async () => {
      show('marswalk');
      await ensureRoute();
    },
  },
  { id: 'alternatives', chapter: 'marswalk', target: 'alternatives', prepare: ensureRoute },
  {
    id: 'timeline',
    chapter: 'marswalk',
    target: 'timeline',
    prepare: async () => {
      show('marswalk');
      await ensureRoute();
    },
  },
  { id: 'profile', chapter: 'marswalk', target: 'profile', prepare: ensureRoute },
  { id: 'science', chapter: 'marswalk', target: 'stops', prepare: ensureRoute },
  {
    id: 'play',
    chapter: 'marswalk',
    target: 'play',
    prepare: async () => {
      show('marswalk');
      await ensureRoute();
    },
    action: async () => {
      useApp.getState().setPlay(Date.now(), true);
      await sleep(300);
    },
    demoMs: 16_000,
  },
  {
    id: 'missions',
    chapter: 'marswalk',
    target: 'mission-actions',
    prepare: async () => {
      calm();
      show('marswalk');
      await ensureRoute();
    },
  },
  // ---- Conditions ----
  {
    id: 'conditions',
    chapter: 'conditions',
    target: 'eva-start',
    prepare: () => {
      calm();
      show('conditions');
    },
    // Three hours later: the Sun, the sky and the timeline follow.
    action: () => {
      const s = useApp.getState();
      s.setEvaStart(s.evaStartUtcMs + 3 * 3600_000);
    },
  },
  { id: 'layers', chapter: 'conditions', target: 'layers' },
  { id: 'help', chapter: 'conditions', target: 'help' },
];

export const chapterStart = (c: ChapterId) => TOUR.findIndex((s) => s.chapter === c);
export const stepIndex = (id: string) => TOUR.findIndex((s) => s.id === id);
