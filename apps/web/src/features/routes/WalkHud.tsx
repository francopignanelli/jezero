import { DEFAULT_DWELL_MIN, DEFAULT_EVA_PARAMS } from '@copernico/domain';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../app/store';
import { formatDistance, formatElevation } from '../../lib/format';
import { profileAt } from '../../lib/routeTrack';
import { IconPause, IconPlay, IconX } from '../../ui/icons';
import { walkControls, walkFeed, type WalkStatus } from './walkFeed';
import { prefersReducedMotion } from '../../lib/motion';

const BAND_COLOUR = { mild: '#3ff0c0', moderate: '#fde725', steep: '#f89540' } as const;

function clockText(s: number): string {
  const m = Math.floor(s / 60);
  return `T+${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * On-map panel of the walk simulation: EVA clock (planner walking time plus the time worked at the
 * stops already passed), distance, the slope underfoot coloured by band, elevation, the next stop,
 * and a progress bar with the stops marked. Numbers update every frame through refs.
 */
export function WalkHud() {
  const { t, i18n } = useTranslation();
  const playing = useApp((s) => s.playing);
  const [status, setStatus] = useState<WalkStatus | null>(null);
  const [paused, setPaused] = useState(false);
  const [arrival, setArrival] = useState<string | null>(null);
  const refs = {
    clock: useRef<HTMLElement>(null),
    distance: useRef<HTMLElement>(null),
    slope: useRef<HTMLElement>(null),
    slopeDot: useRef<HTMLSpanElement>(null),
    elevation: useRef<HTMLElement>(null),
    next: useRef<HTMLSpanElement>(null),
    bar: useRef<HTMLSpanElement>(null),
  };
  const stopsKey = useRef('');

  const nameOf = (waypoint: number, i: number, last: boolean) => {
    const w = useApp.getState().waypoints[waypoint];
    if (w?.label) return w.label;
    if (last && waypoint === 0) return t('walk.backToStart');
    return t('walk.stop', { n: i + 1 });
  };

  useEffect(() => {
    if (!playing) {
      setPaused(false);
      setArrival(null);
      return;
    }
    let arrivalTimer = 0;
    const unsub = walkFeed.subscribe((s) => {
      const key = s ? `${s.stops.length}:${s.phase === 'intro'}` : '';
      if (key !== stopsKey.current) {
        stopsKey.current = key;
        setStatus(s);
      }
      if (!s) return;
      const state = useApp.getState();
      const route =
        state.profile === 'lower-risk' ? state.result?.lowerRisk : state.result?.shortest;
      const profile = route?.metrics?.profile;
      const total = profile?.distanceM.at(-1) ?? 0;
      const dP = s.distanceM * s.toProfile;
      if (profile) {
        const sample = profileAt(profile, dP);
        const passed = s.stops.filter((x, i) => i < s.stops.length - 1 && x.distanceM <= dP + 0.5);
        const dwell = passed.reduce(
          (sum, x) => sum + (state.waypoints[x.waypoint]?.dwellMin ?? DEFAULT_DWELL_MIN) * 60,
          0,
        );
        const band =
          sample.slopeDeg <= DEFAULT_EVA_PARAMS.slopeBands[0]!.upToDeg
            ? 'mild'
            : sample.slopeDeg <= DEFAULT_EVA_PARAMS.slopeBands[1]!.upToDeg
              ? 'moderate'
              : 'steep';
        if (refs.clock.current) refs.clock.current.textContent = clockText(sample.elapsedS + dwell);
        if (refs.distance.current)
          refs.distance.current.textContent = `${formatDistance(dP, i18n.language)} / ${formatDistance(total, i18n.language)}`;
        if (refs.slope.current) refs.slope.current.textContent = `${Math.round(sample.slopeDeg)}°`;
        if (refs.slopeDot.current) refs.slopeDot.current.style.background = BAND_COLOUR[band];
        if (refs.elevation.current)
          refs.elevation.current.textContent = formatElevation(sample.elevationM, i18n.language);
      }
      const nextIndex = s.stops.findIndex((x) => x.distanceM > dP + 0.5);
      if (refs.next.current) {
        refs.next.current.textContent =
          nextIndex < 0
            ? t('walk.done')
            : t('walk.next', {
                name: nameOf(
                  s.stops[nextIndex]!.waypoint,
                  nextIndex,
                  nextIndex === s.stops.length - 1,
                ),
                distance: formatDistance(s.stops[nextIndex]!.distanceM - dP, i18n.language),
              });
      }
      if (refs.bar.current) refs.bar.current.style.transform = `scaleX(${s.fraction.toFixed(4)})`;
      if (s.arrived !== null) {
        const x = s.stops[s.arrived]!;
        setArrival(
          t('walk.arrived', {
            name: nameOf(x.waypoint, s.arrived, s.arrived === s.stops.length - 1),
          }),
        );
        window.clearTimeout(arrivalTimer);
        arrivalTimer = window.setTimeout(() => setArrival(null), 2600);
      }
    });
    return () => {
      unsub();
      window.clearTimeout(arrivalTimer);
    };
    // nameOf reads the store directly.
  }, [playing, i18n.language, t]);

  if (!playing || !status) return null;
  const totalP = status.stops.at(-1)?.distanceM ?? 1;
  return (
    <div className="walk-hud" role="status" aria-live="off">
      <div className="walk-head">
        <span className="walk-kicker">
          <span className="walk-live" aria-hidden="true" />
          {t('walk.title')}
        </span>
        <span ref={refs.next} className="walk-next" />
      </div>
      <dl className="walk-stats">
        <div>
          <dt>{t('walk.clock')}</dt>
          <dd ref={refs.clock}>T+0:00</dd>
        </div>
        <div>
          <dt>{t('walk.distance')}</dt>
          <dd ref={refs.distance}>—</dd>
        </div>
        <div>
          <dt>{t('walk.slope')}</dt>
          <dd>
            <span ref={refs.slopeDot} className="walk-band" aria-hidden="true" />
            <span ref={refs.slope}>—</span>
          </dd>
        </div>
        <div>
          <dt>{t('walk.elevation')}</dt>
          <dd ref={refs.elevation}>—</dd>
        </div>
      </dl>
      <div className="walk-progress" aria-hidden="true">
        <span ref={refs.bar} className="walk-progress-fill" />
        {status.stops.slice(0, -1).map((x, i) => (
          <i key={i} style={{ left: `${(x.distanceM / totalP) * 100}%` }} />
        ))}
      </div>
      <div className="walk-actions">
        <button
          type="button"
          className="walk-btn"
          aria-label={paused ? t('walk.resume') : t('walk.pause')}
          title={paused ? t('walk.resume') : t('walk.pause')}
          onClick={() => {
            walkControls.setPaused(!paused);
            setPaused(!paused);
          }}
        >
          {paused ? <IconPlay /> : <IconPause />}
        </button>
        <button
          type="button"
          className="walk-btn"
          aria-label={t('walk.stopSim')}
          title={t('walk.stopSim')}
          onClick={() => useApp.getState().setPlay(null, false)}
        >
          <IconX />
        </button>
      </div>
      {arrival && (
        <p className="walk-arrival" key={arrival}>
          {arrival}
        </p>
      )}
    </div>
  );
}

/** On the map whenever a route is ready: starts the walk simulation (also in Marswalk, step 4). */
export function SimulateButton() {
  const { t } = useTranslation();
  const ready = useApp((s) => {
    const r = s.profile === 'lower-risk' ? s.result?.lowerRisk : s.result?.shortest;
    return r?.status === 'ok' && Boolean(r.metrics);
  });
  const show = useApp((s) => s.mode === 'jezero' && !s.playing && !s.panoramaOpen && !s.tour);
  const setPlay = useApp((s) => s.setPlay);
  const reduced = prefersReducedMotion();
  if (!ready || !show || reduced) return null;
  return (
    <button type="button" className="simulate-fab" onClick={() => setPlay(Date.now(), true)}>
      <IconPlay />
      {t('route.simulateMap')}
    </button>
  );
}
