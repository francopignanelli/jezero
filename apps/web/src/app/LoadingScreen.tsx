import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DATA_VERSION, dataUrl } from '../config';
import { PlanetLoader } from './PlanetLoader';
import { useApp, type LoadingState } from './store';

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

/** Deterministic star field (a few hundred stars, a dozen bright ones with soft halos). */
function drawStars(canvas: HTMLCanvasElement) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const tints = ['255,255,255', '214,226,255', '255,236,214', '255,214,170', '196,214,255'];
  const n = Math.round((w * h) / 1900);
  for (let i = 0; i < n; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const m = rnd() ** 5; // mostly faint
    const tint = tints[Math.floor(rnd() * tints.length)];
    ctx.fillStyle = `rgba(${tint}, ${0.25 + 0.75 * m})`;
    ctx.beginPath();
    ctx.arc(x, y, 0.3 + 1.2 * m, 0, 2 * Math.PI);
    ctx.fill();
    if (m > 0.72) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, 3 + 6 * m);
      g.addColorStop(0, `rgba(${tint}, ${0.45 * m})`);
      g.addColorStop(1, `rgba(${tint}, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, 3 + 6 * m, 0, 2 * Math.PI);
      ctx.fill();
    }
  }
}

const RING = (
  <svg viewBox="0 0 24 24" className="step-icon" aria-hidden="true">
    <circle className="step-ring" cx="12" cy="12" r="9.5" />
    <circle className="step-spin" cx="12" cy="12" r="9.5" />
    <circle className="step-fill" cx="12" cy="12" r="10.5" />
    <path className="step-check" d="M7.4 12.4l3 3 6.2-6.6" />
    <path className="step-bang" d="M12 7.5v5.2M12 16.2v.3" />
  </svg>
);

/**
 * Full-screen loader shown until the scene's first view is complete. The progress bar eases toward
 * its target every frame and creeps slowly within the current step, so it never jumps or stalls;
 * it completes before the screen fades away.
 */
export function LoadingScreen() {
  const { t } = useTranslation();
  const loading = useApp((s) => s.loading);
  const ready = useApp((s) => s.sceneReady);
  const setReady = useApp((s) => s.setSceneReady);
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);
  const [slow, setSlow] = useState(false);
  const [milkyWay, setMilkyWay] = useState(false);
  const starsRef = useRef<HTMLCanvasElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);

  const statuses = STEPS.map((k) => stepStatus(k, loading));
  const done = statuses.filter((s) => s === 'done' || s === 'failed').length;
  const target = useRef({ done: 0, changed: performance.now(), ready: false });
  if (target.current.done !== done)
    target.current = { ...target.current, done, changed: performance.now() };
  target.current.ready = ready;

  useEffect(() => {
    const id = window.setTimeout(() => setSlow(true), 15_000);
    const stars = starsRef.current!;
    drawStars(stars);
    const onResize = () => drawStars(stars);
    window.addEventListener('resize', onResize);
    // The scene loads this same image for its sky, so it comes from the cache.
    const img = new Image();
    img.src = dataUrl(`sky/milkyway_4k.webp?v=${DATA_VERSION}`);
    void img.decode().then(
      () => setMilkyWay(true),
      () => {},
    );
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  // Smooth progress: ease toward (finished steps + creep within the current one) / total.
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let shown = 0;
    let last = performance.now();
    let raf = 0;
    let finishedAt = 0;
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const { done: d, changed, ready: r } = target.current;
      const creep = d < STEPS.length ? 0.8 * (1 - Math.exp(-(now - changed) / 2500)) : 0;
      const goal = r ? 1 : Math.min(0.97, (d + creep) / STEPS.length);
      shown = reduced ? goal : shown + (goal - shown) * (1 - Math.exp(-dt / 0.28));
      if (barRef.current) barRef.current.style.transform = `scaleX(${shown.toFixed(4)})`;
      if (r && shown > 0.995) {
        finishedAt ||= now;
        if (now - finishedAt > (reduced ? 0 : 220)) {
          setLeaving(true);
          return;
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (!leaving) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const id = window.setTimeout(() => setGone(true), reduced ? 0 : 900);
    return () => window.clearTimeout(id);
  }, [leaving]);

  if (gone) return null;

  return (
    <div
      className={`loading-screen${leaving ? ' is-leaving' : ''}`}
      role="status"
      aria-live="polite"
      aria-busy={!ready}
    >
      <div
        className={`loading-milkyway${milkyWay ? ' is-loaded' : ''}`}
        style={{ backgroundImage: `url(${dataUrl(`sky/milkyway_4k.webp?v=${DATA_VERSION}`)})` }}
        aria-hidden="true"
      />
      <div className="loading-vignette" aria-hidden="true" />
      <canvas ref={starsRef} className="loading-stars" aria-hidden="true" />
      <div className="loading-card">
        <PlanetLoader />
        <h1 className="loading-title">Copernico</h1>
        <p className="loading-subtitle">{t('loading.subtitle')}</p>
        <div className="loading-bar" aria-hidden="true">
          <span ref={barRef} />
        </div>
        <ul className="loading-steps">
          {STEPS.map((k, i) => {
            const status = statuses[i]!;
            const extra =
              k === 'sky' && (loading.sky === 'hd' || loading.sky === 'sd')
                ? ` · ${t(`loading.${loading.sky}`)}`
                : '';
            const spoken = status === 'active' ? 'pending' : status;
            return (
              <li key={k} data-status={status} style={{ animationDelay: `${120 + i * 70}ms` }}>
                {RING}
                <span className="step-label">
                  {t(`loading.steps.${k}`)}
                  {extra}
                </span>
                <span className="visually-hidden">: {t(`loading.status.${spoken}`)}</span>
              </li>
            );
          })}
        </ul>
        {slow && !ready && (
          <button type="button" className="btn" onClick={() => setReady(true)}>
            {t('loading.continue')}
          </button>
        )}
      </div>
    </div>
  );
}
