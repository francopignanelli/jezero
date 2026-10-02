import { useApp } from '../../app/store';
import { loadGuidedMarswalk } from '../exploration/guided';
import { computeRoutes } from '../routes/compute';

/**
 * Guided tour: each step points at one part of the screen (a `data-tour` anchor) and explains it in
 * plain language. `prepare` puts the app in the state the step needs, so "Next" always works even if
 * the user skipped the suggested action; `action` is the optional "Do it for me".
 * Texts live in i18n under tour.steps.<id>.
 */
export interface TourStep {
  id: string;
  target?: string;
  prepare?: () => Promise<void> | void;
  action?: () => Promise<void> | void;
  /** The map needs a moment to fly or redraw before the highlight makes sense. */
  settleMs?: number;
}

const messages = () => ({ needTwo: '', gridUnavailable: '' });

const showPanel = (tab: 'explore' | 'route' | 'science' | 'environment') => {
  const s = useApp.getState();
  s.setTab(tab);
  s.setPanelOpen(true);
};

async function ensureRoute(): Promise<void> {
  const s = useApp.getState();
  if (s.result) return;
  if (s.waypoints.length < 2) loadGuidedMarswalk();
  await computeRoutes(messages());
}

export const TOUR: TourStep[] = [
  {
    id: 'planet',
    target: 'map',
    prepare: () => {
      const s = useApp.getState();
      if (s.mode !== 'orbit') s.setMode('orbit');
      showPanel('explore');
    },
    settleMs: 1500,
  },
  { id: 'panels', target: 'tab-explore', prepare: () => showPanel('explore') },
  {
    id: 'jezero',
    target: 'explore-jezero',
    prepare: () => showPanel('explore'),
    action: () => useApp.getState().setMode('jezero'),
  },
  {
    id: 'area',
    target: 'map',
    prepare: () => {
      const s = useApp.getState();
      if (s.mode !== 'jezero') s.setMode('jezero');
    },
    settleMs: 6500,
  },
  {
    id: 'guided',
    target: 'guided',
    prepare: () => showPanel('explore'),
    action: () => loadGuidedMarswalk(),
  },
  {
    id: 'calculate',
    target: 'calculate',
    prepare: () => {
      if (useApp.getState().waypoints.length < 2) loadGuidedMarswalk();
      showPanel('route');
    },
    action: async () => {
      await computeRoutes(messages());
    },
  },
  {
    id: 'results',
    target: 'metrics',
    prepare: async () => {
      showPanel('route');
      await ensureRoute();
    },
  },
  { id: 'alternatives', target: 'alternatives', prepare: ensureRoute },
  {
    id: 'timeline',
    target: 'timeline',
    prepare: async () => {
      showPanel('route');
      await ensureRoute();
    },
  },
  { id: 'profile', target: 'profile', prepare: ensureRoute },
  {
    id: 'science',
    target: 'stops',
    prepare: async () => {
      await ensureRoute();
      showPanel('science');
    },
  },
  { id: 'layers', target: 'layers' },
  {
    id: 'play',
    target: 'play',
    prepare: async () => {
      await ensureRoute();
      showPanel('route');
    },
  },
  { id: 'missions', target: 'mission-actions', prepare: () => showPanel('route') },
  { id: 'help', target: 'help' },
];
