import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp, type LoadingState } from './store';

type Status = 'pending' | 'done' | 'failed';

function stepStatus(key: keyof LoadingState, v: LoadingState[keyof LoadingState]): Status {
  if (key === 'sky') return v === 'pending' ? 'pending' : v === 'failed' ? 'failed' : 'done';
  return v as Status;
}

const STEPS: Array<keyof LoadingState> = ['stars', 'sky', 'terrain', 'imagery', 'tiles', 'surface'];

/**
 * Full-screen loader shown until the scene's first view is complete: star catalog, HD Milky Way,
 * terrain, imagery, visible tiles and mission data. The globe is never revealed half-drawn.
 */
export function LoadingScreen() {
  const { t } = useTranslation();
  const loading = useApp((s) => s.loading);
  const ready = useApp((s) => s.sceneReady);
  const setReady = useApp((s) => s.setSceneReady);
  const [gone, setGone] = useState(false);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setSlow(true), 15_000);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const id = window.setTimeout(() => setGone(true), reduced ? 0 : 700);
    return () => window.clearTimeout(id);
  }, [ready]);

  if (gone) return null;
  const done = STEPS.filter((k) => stepStatus(k, loading[k]) !== 'pending').length;

  return (
    <div
      className={`loading-screen${ready ? ' is-leaving' : ''}`}
      role="status"
      aria-live="polite"
      aria-busy={!ready}
    >
      <div className="loading-stars" aria-hidden="true" />
      <div className="loading-card">
        <div className="loading-orbit" aria-hidden="true">
          <div className="loading-planet" />
          <div className="loading-ring">
            <div className="loading-moon" />
          </div>
        </div>
        <h1 className="loading-title">Copernico</h1>
        <p className="loading-subtitle">{t('loading.subtitle')}</p>
        <div className="loading-bar" aria-hidden="true">
          <span style={{ width: `${(done / STEPS.length) * 100}%` }} />
        </div>
        <ul className="loading-steps">
          {STEPS.map((k) => {
            const status = stepStatus(k, loading[k]);
            const extra =
              k === 'sky' && (loading.sky === 'hd' || loading.sky === 'sd')
                ? ` · ${t(`loading.${loading.sky}`)}`
                : '';
            return (
              <li key={k} data-status={status}>
                <span className="loading-dot" aria-hidden="true" />
                {t(`loading.steps.${k}`)}
                {extra}
                <span className="visually-hidden">: {t(`loading.status.${status}`)}</span>
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
