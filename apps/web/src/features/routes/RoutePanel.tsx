import {
  buildTimeline,
  DEFAULT_DWELL_MIN,
  DEFAULT_EVA_PARAMS,
  EVA_PARAMS_BASIS,
  type RouteResult,
} from '@copernico/domain';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useApp, type WaypointEntry } from '../../app/store';
import { DATASET_ID, JEZERO } from '../../config';
import { explanationText, isWarning } from '../../lib/explain';
import {
  formatCoordinate,
  formatDegrees,
  formatDistance,
  formatDuration,
  formatElevation,
} from '../../lib/format';
import { IconCheck, IconPin, IconUp, IconX } from '../../ui/icons';
import { Term } from '../guide/Glossary';
import { MissionActions, SavedMissions } from '../missions/MissionControls';
import { ElevationProfile } from './ElevationProfile';
import { Timeline } from './Timeline';
import { computeRoutes } from './compute';
import { StopsNearRoute } from '../science/StopsNearRoute';
import { loadGuidedMarswalk } from '../exploration/guided';
import { prefersReducedMotion } from '../../lib/motion';

function waypointName(t: TFunction, w: WaypointEntry, i: number, count: number): string {
  if (w.label) return w.label;
  if (i === 0) return t('route.start');
  if (i === count - 1) return t('route.destination');
  return t('route.stop', { n: i });
}

/**
 * One numbered step of the planning flow. Later steps stay visible while locked, with a line on
 * what they will offer, so no feature is hidden behind an earlier one.
 */
function Step({
  n,
  title,
  state,
  hint,
  tour,
  children,
}: {
  n: number;
  title: string;
  state: 'done' | 'active' | 'locked';
  hint?: string;
  tour?: string;
  children?: ReactNode;
}) {
  return (
    <section className={`step step-${state}`} aria-labelledby={`step-${n}`} data-tour={tour}>
      <h3 id={`step-${n}`} className="step-title">
        <span className="step-n" aria-hidden="true">
          {state === 'done' ? <IconCheck width={14} height={14} /> : n}
        </span>
        <span className="visually-hidden">{n}. </span>
        {title}
      </h3>
      {state === 'locked' ? <p className="meta step-hint">{hint}</p> : children}
    </section>
  );
}

function useRouteTimeline(primary: RouteResult | null) {
  const waypoints = useApp((s) => s.waypoints);
  const returnToStart = useApp((s) => s.returnToStart);
  const evaStart = useApp((s) => s.evaStartUtcMs);
  return useMemo(
    () =>
      primary
        ? buildTimeline(
            primary,
            waypoints.map((w) => w.dwellMin ?? DEFAULT_DWELL_MIN),
            returnToStart,
            evaStart,
            JEZERO,
          )
        : null,
    [primary, waypoints, returnToStart, evaStart],
  );
}

export function RoutePanel() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const s = useApp();
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [error, setError] = useState<string | null>(null);
  const elapsedMs = s.computeMs;

  useEffect(() => {
    if (!s.picking) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && s.setPicking(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s.picking, s]);

  const compute = async () => {
    setError(null);
    setError(
      await computeRoutes({
        needTwo: t('route.needTwo'),
        gridUnavailable: t('route.gridUnavailable'),
      }),
    );
  };

  const addCoordinates = (e: FormEvent) => {
    e.preventDefault();
    const la = Number(lat);
    const lo = Number(lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90) return;
    s.addWaypoint({ lat: la, lon: ((lo % 360) + 360) % 360 });
    setLat('');
    setLon('');
  };

  const primary: RouteResult | null = s.result
    ? s.profile === 'lower-risk'
      ? s.result.lowerRisk
      : s.result.shortest
    : null;
  const gridBlocked = s.gridStatus === 'unavailable';
  const timeline = useRouteTimeline(primary);
  const routed = Boolean(s.result && primary && primary.status === 'ok' && primary.metrics);
  const names = (w: WaypointEntry, i: number) => waypointName(t, w, i, s.waypoints.length);

  return (
    <section aria-labelledby="route-title">
      <h2 id="route-title">{t('route.title')}</h2>
      <p className="lede">{t('route.intro')}</p>
      <SavedMissions />

      {gridBlocked && <p className="alert alert-danger">{t('route.gridUnavailable')}</p>}
      {s.gridStatus === 'loading' && (
        <p className="alert alert-info" role="status">
          {t('route.loadingGrid')}
        </p>
      )}

      <Step
        n={1}
        title={t('route.steps.stops')}
        state={s.waypoints.length >= 2 ? 'done' : 'active'}
        tour="step-stops"
      >
        <div className="guided-row">
          <p className="meta">{t('explore.guidedDescription')}</p>
          <button
            type="button"
            className="btn btn-sm"
            data-tour="guided"
            onClick={loadGuidedMarswalk}
          >
            {t('explore.startGuided')}
          </button>
        </div>
        {s.waypoints.length === 0 ? (
          <p className="lede">{t('route.empty')}</p>
        ) : (
          <ol className="waypoints">
            {s.waypoints.map((w, i) => {
              const name = waypointName(t, w, i, s.waypoints.length);
              return (
                <li key={w.id} className="waypoint">
                  <span className="waypoint-badge" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span className="waypoint-label">
                    {name}
                    <span className="waypoint-coords">
                      {formatCoordinate(w.lat, w.lon, locale)}
                    </span>
                    {i > 0 && (s.returnToStart || i < s.waypoints.length - 1) && (
                      <label className="dwell">
                        <input
                          type="number"
                          min={0}
                          max={240}
                          step={5}
                          value={w.dwellMin ?? DEFAULT_DWELL_MIN}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            if (Number.isFinite(v)) s.setDwell(w.id, Math.max(0, Math.min(240, v)));
                          }}
                          aria-label={t('route.dwellAria', { name })}
                        />
                        {t('route.dwellUnit')}
                      </label>
                    )}
                  </span>
                  <span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon"
                      onClick={() => s.moveWaypoint(w.id, -1)}
                      disabled={i === 0}
                      aria-label={t('route.moveUp', { name })}
                    >
                      <IconUp width={16} height={16} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon"
                      onClick={() => s.removeWaypoint(w.id)}
                      aria-label={t('route.remove', { name })}
                    >
                      <IconX width={16} height={16} />
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        <div className="btn-row">
          <button
            type="button"
            className="btn"
            aria-pressed={s.picking}
            onClick={() => {
              if (s.mode !== 'jezero') s.setMode('jezero');
              s.setPicking(!s.picking);
            }}
          >
            <IconPin width={16} height={16} /> {t('route.pickOnMap')}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={s.clearWaypoints}
            disabled={s.waypoints.length === 0}
          >
            {t('route.clear')}
          </button>
        </div>

        <details>
          <summary className="meta" style={{ cursor: 'pointer' }}>
            {t('route.addCoordinates')}
          </summary>
          <form className="field-row" onSubmit={addCoordinates} style={{ marginTop: 8 }}>
            <label className="field">
              {t('route.latitude')}
              <input
                inputMode="decimal"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                placeholder="18.4446"
                required
              />
            </label>
            <label className="field">
              {t('route.longitude')}
              <input
                inputMode="decimal"
                value={lon}
                onChange={(e) => setLon(e.target.value)}
                placeholder="77.4509"
                required
              />
            </label>
            <button type="submit" className="btn">
              {t('route.add')}
            </button>
          </form>
        </details>

        <label className="check">
          <input
            type="checkbox"
            checked={s.returnToStart}
            onChange={(e) => s.setReturnToStart(e.target.checked)}
          />
          {t('route.returnToStart')}
        </label>
      </Step>

      <Step n={2} title={t('route.steps.calculate')} state={s.result ? 'done' : 'active'}>
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-primary"
            data-tour="calculate"
            onClick={() => void compute()}
            disabled={s.computing || gridBlocked || s.waypoints.length < 2}
          >
            {s.computing ? t('route.computing') : t('route.compute')}
          </button>
        </div>
        {error && (
          <p className="alert alert-danger" role="alert">
            {error}
          </p>
        )}
      </Step>

      <Step
        n={3}
        title={t('route.steps.review')}
        state={s.result ? 'active' : 'locked'}
        hint={t('route.steps.reviewHint')}
      >
        <div aria-live="polite">
          {s.result && primary && (
            <RouteResults primary={primary} timeline={timeline} elapsedMs={elapsedMs} />
          )}
        </div>
      </Step>

      <Step
        n={4}
        title={t('route.steps.simulate')}
        state={routed ? 'active' : 'locked'}
        hint={t('route.steps.simulateHint')}
        tour="play"
      >
        <PlayButton />
      </Step>

      <Step
        n={5}
        title={t('route.steps.save')}
        state={routed ? 'active' : 'locked'}
        hint={t('route.steps.saveHint')}
      >
        {routed && primary && <MissionActions route={primary} timeline={timeline} names={names} />}
      </Step>
    </section>
  );
}

function RouteResults({
  primary,
  timeline,
  elapsedMs,
}: {
  primary: RouteResult;
  timeline: ReturnType<typeof buildTimeline> | null;
  elapsedMs: number | null;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const s = useApp();
  const result = s.result!;
  const m = primary.metrics;
  const walkbackS = timeline?.walkbackMarginS ?? m?.walkback.worstMarginS ?? 0;

  return (
    <>
      <div
        className="segmented"
        role="group"
        aria-label={t('route.profile')}
        data-tour="alternatives"
      >
        {(['lower-risk', 'shortest'] as const).map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={s.profile === p}
            onClick={() => s.setProfile(p)}
          >
            {t(`route.profiles.${p}`)}
          </button>
        ))}
      </div>

      {primary.status === 'no-route' || !m ? (
        <div className="alert alert-danger" style={{ marginTop: 10 }}>
          <strong>{t('route.noRoute')}</strong>
          <ul className="explain">
            {primary.explanation.map((e, i) => (
              <li key={i}>{explanationText(e, t, locale)}</li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          <dl className="metrics" data-tour="metrics">
            <div className="metric">
              <dt>{t('metrics.distance')}</dt>
              <dd>{formatDistance(m.horizontalDistanceM, locale)}</dd>
            </div>
            <div className="metric">
              <dt>{t('metrics.duration')}</dt>
              <dd>
                {formatDuration(m.estimatedDurationS)}
                <small>
                  {t('metrics.durationRange', {
                    min: formatDuration(Math.min(...Object.values(m.durationByModelS))),
                    max: formatDuration(Math.max(...Object.values(m.durationByModelS))),
                  })}
                </small>
              </dd>
            </div>
            <div className="metric">
              <dt>{t('metrics.gain')}</dt>
              <dd>{formatElevation(m.elevationGainM, locale)}</dd>
            </div>
            <div className="metric">
              <dt>{t('metrics.loss')}</dt>
              <dd>{formatElevation(m.elevationLossM, locale)}</dd>
            </div>
            <div className="metric">
              <dt>
                <Term id="slope">{t('metrics.maxSlope')}</Term>
              </dt>
              <dd>{formatDegrees(m.maxTerrainSlopeDeg, locale)}</dd>
            </div>
            <div className="metric">
              <dt>
                <Term id="walkback">{t('metrics.walkback')}</Term>
              </dt>
              <dd style={{ color: walkbackS >= 0 ? 'var(--ok)' : 'var(--danger)' }}>
                {walkbackS >= 0
                  ? t('metrics.walkbackOk', { margin: formatDuration(walkbackS) })
                  : t('metrics.walkbackFail', { margin: formatDuration(-walkbackS) })}
                <small title={t('metrics.walkbackRule')}>
                  {t('metrics.walkbackBasis', {
                    cap: formatDuration(DEFAULT_EVA_PARAMS.evaCapHours * 3600),
                    ingress: formatDuration(DEFAULT_EVA_PARAMS.ingressHours * 3600),
                  })}
                  {timeline && timeline.dwellS > 0 && ` · ${t('metrics.walkbackStops')}`}
                </small>
              </dd>
            </div>
          </dl>

          <SlopeColourToggle />

          {timeline && (
            <Timeline
              timeline={timeline}
              route={primary}
              names={(w, i) => (w ? waypointName(t, w, i, s.waypoints.length) : t('route.start'))}
            />
          )}

          <h4>{t('route.why')}</h4>
          <ul className="explain">
            {s.profile === 'lower-risk' && result.comparison && (
              <li>{explanationText(result.comparison, t, locale)}</li>
            )}
            {primary.explanation.map((e, i) => (
              <li key={i} style={isWarning(e) ? { color: 'var(--warn)' } : undefined}>
                {explanationText(e, t, locale)}
              </li>
            ))}
          </ul>

          <ElevationProfile profile={m.profile} />

          <h4>{t('metrics.bands')}</h4>
          <table className="data">
            <tbody>
              {(['mild', 'moderate', 'steep'] as const).map((b) => (
                <tr key={b}>
                  <th scope="row">{t(`legend.slope.${b}`)}</th>
                  <td className="num">{formatDistance(m.bandDistanceM[b], locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h4>{t('route.itinerary')}</h4>
          <table className="data">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col" className="num">
                  {t('metrics.distance')}
                </th>
                <th scope="col" className="num">
                  +/−
                </th>
                <th scope="col" className="num">
                  {t('metrics.maxSlope')}
                </th>
                <th scope="col" className="num">
                  {t('metrics.duration')}
                </th>
              </tr>
            </thead>
            <tbody>
              {primary.legs.map((leg) => (
                <tr key={leg.fromWaypoint}>
                  <td>
                    {leg.fromWaypoint + 1}→
                    {leg.toWaypoint >= s.waypoints.length ? 1 : leg.toWaypoint + 1}
                  </td>
                  <td className="num">{formatDistance(leg.horizontalDistanceM, locale)}</td>
                  <td className="num">
                    +{Math.round(leg.elevationGainM)}/−{Math.round(leg.elevationLossM)}
                  </td>
                  <td className="num">{formatDegrees(leg.maxTerrainSlopeDeg, locale)}</td>
                  <td className="num">{formatDuration(leg.estimatedDurationS)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <StopsNearRoute />

      <h4>{t('route.unresolved')}</h4>
      <p className="lede">{t('route.unresolvedList')}</p>
      <p className="meta">{t('app.prototypeNotice')}</p>

      <details>
        <summary className="meta" style={{ cursor: 'pointer' }}>
          {t('route.assumptions')}
        </summary>
        <p className="meta">{t('route.assumptionsNote')}</p>
        <table className="data">
          <tbody>
            {(Object.keys(DEFAULT_EVA_PARAMS) as Array<keyof typeof DEFAULT_EVA_PARAMS>)
              .filter((k) => k !== 'slopeBands')
              .map((k) => (
                <tr key={k}>
                  <th scope="row">{k}</th>
                  <td className="num">{String(DEFAULT_EVA_PARAMS[k])}</td>
                  <td>{EVA_PARAMS_BASIS[k].basis === 'assumption' ? 'A' : 'S'}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
      <p className="meta" style={{ marginTop: 10 }}>
        {t('route.algorithm', {
          algorithm: primary.algorithmVersion,
          params: primary.parameterSet,
          data: DATASET_ID,
        })}
        {elapsedMs !== null && ` · ${Math.round(elapsedMs)} ms`}
      </p>
    </>
  );
}

/** Starts or stops the route fly-through (disabled with reduced motion). */
function PlayButton() {
  const { t } = useTranslation();
  const playing = useApp((s) => s.playing);
  const setPlay = useApp((s) => s.setPlay);
  const setPanelOpen = useApp((s) => s.setPanelOpen);
  const reduced = prefersReducedMotion();
  return (
    <div className="play-row">
      <button
        type="button"
        className="btn btn-primary"
        disabled={reduced}
        title={reduced ? t('route.playReduced') : undefined}
        aria-pressed={playing}
        onClick={() => {
          if (playing) setPlay(null, false);
          else {
            // On small screens the sheet would cover the fly-through.
            if (window.matchMedia('(max-width: 820px)').matches) setPanelOpen(false);
            setPlay(Date.now(), true);
          }
        }}
      >
        {playing ? t('route.stopPlay') : t('route.play')}
      </button>
      <span className="meta">{t('route.playHint')}</span>
    </div>
  );
}

/** Colours the drawn route by slope band (same colours as the profile and the slope legend). */
function SlopeColourToggle() {
  const { t } = useTranslation();
  const on = useApp((s) => s.routeSlopeColours);
  const set = useApp((s) => s.setRouteSlopeColours);
  return (
    <div className="slope-toggle">
      <label className="check">
        <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
        {t('route.colourBySlope')}
      </label>
      {on && (
        <span className="slope-chips" aria-hidden="true">
          <i className="chip chip-mild">0–10°</i>
          <i className="chip chip-moderate">10–15°</i>
          <i className="chip chip-steep">15–20°</i>
        </span>
      )}
    </div>
  );
}
