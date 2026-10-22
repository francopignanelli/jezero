import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp, type LoadingState } from './store';
import { prefersReducedMotion } from '../lib/motion';

type Status = 'pending' | 'active' | 'done' | 'failed';

const STEPS: Array<keyof LoadingState> = ['stars', 'sky', 'terrain', 'imagery', 'tiles', 'surface'];

function stepStatus(key: keyof LoadingState, loading: LoadingState): Status {
  const v = loading[key];
  if (v === 'failed') return 'failed';
  if (v !== 'pending') return 'done';
  // Everything loads in parallel except the first view, which waits for terrain and imagery.
  if (key === 'tiles' && (loading.terrain === 'pending' || loading.imagery === 'pending'))
    return 'pending';
  return 'active';
}

/**
 * Drives the loading screen that index.html paints before the app bundle arrives (#boot). It is
 * animated only with CSS transforms and opacity, which run on the browser's compositor thread, so
 * the planet, the orbit and the progress bar stay smooth while loading keeps the main thread busy.
 * Progress moves by CSS transitions: each finished step sends the bar most of the way toward the
 * next boundary with a long ease-out (it creeps, never stalls or jumps); it completes before the
 * screen fades out.
 */
export function LoadingScreen() {
  const { t } = useTranslation();
  const loading = useApp((s) => s.loading);
  const ready = useApp((s) => s.sceneReady);
  const setReady = useApp((s) => s.setSceneReady);
  const floor = useRef<number | null>(null); // bar never moves backwards

  const statuses = STEPS.map((k) => stepStatus(k, loading));
  const done = statuses.filter((s) => s === 'done' || s === 'failed').length;

  // Labels, step states and screen-reader text.
  useEffect(() => {
    const boot = document.getElementById('boot');
    if (!boot) return;
    const subtitle = boot.querySelector('[data-i18n="subtitle"]');
    if (subtitle) subtitle.textContent = t('loading.subtitle');
    const button = boot.querySelector<HTMLButtonElement>('.boot-continue');
    if (button) button.textContent = t('loading.continue');
    STEPS.forEach((k, i) => {
      const li = boot.querySelector<HTMLElement>(`li[data-step="${k}"]`);
      if (!li) return;
      li.dataset.status = statuses[i]!;
      const extra =
        k === 'sky' && (loading.sky === 'hd' || loading.sky === 'sd')
          ? ` · ${t(`loading.${loading.sky}`)}`
          : '';
      const label = li.querySelector('.boot-label');
      if (label) label.textContent = t(`loading.steps.${k}`) + extra;
      const sr = li.querySelector('.boot-sr');
      const spoken = statuses[i] === 'active' ? 'pending' : statuses[i]!;
      if (sr) sr.textContent = `: ${t(`loading.status.${spoken}`)}`;
    });
  });

  // Progress: hand over from the first-paint creep animation, then transition per step.
  useEffect(() => {
    const bar = document.querySelector<HTMLElement>('#boot .boot-bar > span');
    if (!bar) return;
    if (floor.current === null) {
      // Take over from the first-paint creep at the value it has reached.
      const m = getComputedStyle(bar).transform.match(/matrix\(([-\d.e]+)/);
      floor.current = m ? Number(m[1]) : 0;
      bar.style.animation = 'none';
      bar.style.transform = `scaleX(${floor.current})`;
      void bar.offsetWidth; // commit the starting value before transitioning from it
    }
    // Each finished step aims just short of the next boundary with a long ease-out: quick at first,
    // then a slow creep, so the bar keeps moving while a step takes long. A new target starts from
    // wherever the bar is, so it never jumps.
    const goal = ready ? 1 : Math.max(floor.current, Math.min(0.97, (done + 0.9) / STEPS.length));
    floor.current = goal;
    bar.style.transition = ready
      ? 'transform 0.55s cubic-bezier(0.4, 0, 0.2, 1)'
      : 'transform 16s cubic-bezier(0.1, 0.7, 0.2, 1)';
    bar.style.transform = `scaleX(${goal.toFixed(4)})`;
  }, [done, ready]);

  // Exit once the bar has completed: fade (0.9 s), then remove the element.
  useEffect(() => {
    if (!ready) return;
    const boot = document.getElementById('boot');
    if (!boot) return;
    boot.setAttribute('aria-busy', 'false');
    const reduced = prefersReducedMotion();
    const leave = window.setTimeout(() => boot.classList.add('is-leaving'), reduced ? 0 : 650);
    const remove = window.setTimeout(() => boot.remove(), reduced ? 0 : 1600);
    return () => {
      window.clearTimeout(leave);
      window.clearTimeout(remove);
    };
  }, [ready]);

  // Escape hatch when something is slow.
  useEffect(() => {
    const button = document.querySelector<HTMLButtonElement>('#boot .boot-continue');
    if (!button) return;
    const onClick = () => setReady(true);
    button.addEventListener('click', onClick);
    const id = window.setTimeout(() => {
      if (!useApp.getState().sceneReady) button.hidden = false;
    }, 15_000);
    return () => {
      button.removeEventListener('click', onClick);
      window.clearTimeout(id);
    };
  }, [setReady]);

  return null;
}
