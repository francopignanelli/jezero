import { useSyncExternalStore } from 'react';
import { useApp } from '../../app/store';

/**
 * "Things to try": one item per main feature, ticked the first time it is used, so every part of
 * the app gets discovered. Each item names the tour step that shows it ("Show me").
 */
export const TRY_ITEMS = [
  { id: 'jezero', step: 'jezero' },
  { id: 'panorama', step: 'panoramas' },
  { id: 'rover', step: 'rover' },
  { id: 'inspect', step: 'inspect' },
  { id: 'layer', step: 'ground' },
  { id: 'route', step: 'calculate' },
  { id: 'simulate', step: 'play' },
  { id: 'save', step: 'missions' },
  { id: 'conditions', step: 'conditions' },
] as const;
export type TryId = (typeof TRY_ITEMS)[number]['id'];

const KEY = 'copernico.tried';
const listeners = new Set<() => void>();
let tried: ReadonlySet<TryId> = read();

function read(): ReadonlySet<TryId> {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(KEY) ?? '[]') as TryId[]);
  } catch {
    return new Set();
  }
}

export function markTried(id: TryId): void {
  if (tried.has(id)) return;
  tried = new Set([...tried, id]);
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...tried]));
  } catch {
    /* storage unavailable: ticks last for this visit */
  }
  for (const l of listeners) l();
}

export function useTried(): ReadonlySet<TryId> {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => tried,
  );
}

const GROUND_LAYERS = [
  'crism',
  'thermalInertia',
  'slope',
  'elevation',
  'reach',
  'ingenuity',
] as const;

// Ticks from app state; saving and sharing are marked where they happen (MissionControls).
useApp.subscribe((s, prev) => {
  if (s.mode === 'jezero') markTried('jezero');
  if (s.panoramaOpen) markTried('panorama');
  if (s.layers.rover && !prev.layers.rover) markTried('rover');
  if (s.inspected) markTried('inspect');
  if (GROUND_LAYERS.some((id) => s.layers[id] && !prev.layers[id])) markTried('layer');
  if (s.result) markTried('route');
  if (s.playing) markTried('simulate');
  if (s.evaStartUtcMs !== prev.evaStartUtcMs) markTried('conditions');
});
