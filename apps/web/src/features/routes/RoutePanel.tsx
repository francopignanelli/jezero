import {
  buildTimeline,
  DEFAULT_DWELL_MIN,
  DEFAULT_EVA_PARAMS,
  EVA_PARAMS_BASIS,
  type RouteResult,
} from '@copernico/domain';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
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
import { IconPin, IconUp, IconX } from '../../ui/icons';
import { MissionActions, SavedMissions } from '../missions/MissionControls';
import { ElevationProfile } from './ElevationProfile';
import { Timeline } from './Timeline';
import { computeRoutes } from './compute';
import { CORRIDOR_M, nearbyCandidates } from '../science/StopsNearRoute';

function waypointName(t: TFunction, w: WaypointEntry, i: number, count: number): string {
  if (w.label) return w.label;
  if (i === 0) return t('route.start');
  if (i === count - 1) return t('route.destination');
  return t('route.stop', { n: i });
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

      <h3>{t('route.waypoints')}</h3>
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
                  <span className="waypoint-coords">{formatCoordinate(w.lat, w.lon, locale)}</span>
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

      <div className="btn-row">
        <button
          type="button"
          className="btn btn-primary"
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

      <div aria-live="polite">
        {s.result && primary && <RouteResults primary={primary} elapsedMs={elapsedMs} />}
      </div>
    </section>
  );
}

function RouteResults({ primary, elapsedMs }: { primary: RouteResult; elapsedMs: number | null }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const s = useApp();
  const result = s.result!;
  const m = primary.metrics;
  const timeline = useMemo(
    () =>
      buildTimeline(
        primary,
        s.waypoints.map((w) => w.dwellMin ?? DEFAULT_DWELL_MIN),
        s.returnToStart,
        s.evaStartUtcMs,
        JEZERO,
      ),
    [primary, s.waypoints, s.returnToStart, s.evaStartUtcMs],
  );
  const walkbackS = timeline?.walkbackMarginS ?? m?.walkback.worstMarginS ?? 0;

  return (
    <>
      <h3>{t('route.results')}</h3>
      <div className="segmented" role="group" aria-label={t('route.profile')}>
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
          <dl className="metrics">
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
              <dt>{t('metrics.maxSlope')}</dt>
              <dd>{formatDegrees(m.maxTerrainSlopeDeg, locale)}</dd>
            </div>
            <div className="metric">
              <dt>{t('metrics.walkback')}</dt>
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

          <MissionActions
            route={primary}
            timeline={timeline}
            names={(w, i) => waypointName(t, w, i, s.waypoints.length)}
          />

          {timeline && (
            <Timeline
              timeline={timeline}
              route={primary}
              names={(w, i) => (w ? waypointName(t, w, i, s.waypoints.length) : t('route.start'))}
            />
          )}

          <h3>{t('route.why')}</h3>
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

          <h3>{t('metrics.bands')}</h3>
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

          <h3>{t('route.itinerary')}</h3>
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

      <NearbyStopsHint route={primary} />

      <h3>{t('route.unresolved')}</h3>
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

/** One line in the results pointing to science stops near the route (priced in Science). */
function NearbyStopsHint({ route }: { route: RouteResult }) {
  const { t, i18n } = useTranslation();
  const waypoints = useApp((s) => s.waypoints);
  const setTab = useApp((s) => s.setTab);
  const n = nearbyCandidates(
    route,
    new Set(waypoints.flatMap((w) => (w.poiId ? [w.poiId] : []))),
  ).length;
  if (n === 0) return null;
  return (
    <p className="alert alert-info stops-hint">
      {t('stops.summary', { count: n, distance: formatDistance(CORRIDOR_M, i18n.language) })}{' '}
      <button type="button" className="link" onClick={() => setTab('science')}>
        {t('stops.see')}
      </button>
    </p>
  );
}
