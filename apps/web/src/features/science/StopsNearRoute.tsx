import type { DetourCost, RouteResult } from '@copernico/domain';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../app/store';
import { POIS, type Poi } from '../../data/catalog';
import { formatDegrees, formatDistance, formatDuration } from '../../lib/format';
import { nearestOnPolyline } from '../../lib/routeTrack';
import { computeRoutes } from '../routes/compute';
import { routingClient } from '../routes/routingClient';

/** Science stops are offered when they lie within this ground distance of the planned route. */
export const CORRIDOR_M = 1000;

interface Candidate {
  poi: Poi;
  offRouteM: number;
  /** Insert the stop after this waypoint index (the leg it is nearest to). */
  legIndex: number;
}

/** POIs near the selected route, each priced as a detour on the leg it is nearest to. */
export function nearbyCandidates(route: RouteResult, waypointPoiIds: Set<string>): Candidate[] {
  const out: Candidate[] = [];
  for (const poi of POIS) {
    if (waypointPoiIds.has(poi.id)) continue;
    const { distanceM, segmentIndex } = nearestOnPolyline(route.points, poi);
    if (distanceM > CORRIDOR_M) continue;
    let legIndex = 0;
    for (let i = 0; i < route.legStarts.length; i++)
      if (route.legStarts[i]! <= segmentIndex) legIndex = i;
    out.push({ poi, offRouteM: distanceM, legIndex });
  }
  return out;
}

export function StopsNearRoute() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const lang = locale.startsWith('es') ? 'es' : 'en';
  const result = useApp((s) => s.result);
  const profile = useApp((s) => s.profile);
  const waypoints = useApp((s) => s.waypoints);
  const returnToStart = useApp((s) => s.returnToStart);
  const insertWaypoint = useApp((s) => s.insertWaypoint);
  const computing = useApp((s) => s.computing);
  const [priced, setPriced] = useState<Map<string, DetourCost> | null>(null);

  const route = result ? (profile === 'lower-risk' ? result.lowerRisk : result.shortest) : null;
  const candidates = useMemo(
    () =>
      route?.status === 'ok'
        ? nearbyCandidates(route, new Set(waypoints.flatMap((w) => (w.poiId ? [w.poiId] : []))))
        : [],
    [route, waypoints],
  );

  useEffect(() => {
    setPriced(null);
    if (candidates.length === 0 || !routingClient.isReady) return;
    let cancelled = false;
    const legEnd = (i: number) => (i + 1 < waypoints.length ? waypoints[i + 1]! : waypoints[0]!);
    void routingClient
      .detours(
        profile,
        candidates.map((c) => ({
          id: c.poi.id,
          from: waypoints[c.legIndex]!,
          to: legEnd(c.legIndex),
          stop: { lat: c.poi.lat, lon: c.poi.lon },
        })),
      )
      .then((list) => {
        if (!cancelled) setPriced(new Map(list.map((d) => [d.id, d])));
      });
    return () => {
      cancelled = true;
    };
  }, [candidates, profile, waypoints, returnToStart]);

  if (!route || route.status !== 'ok') return null;

  const rows = candidates
    .map((c) => ({ ...c, cost: priced?.get(c.poi.id) }))
    .sort((a, b) => (a.cost?.extraDurationS ?? Infinity) - (b.cost?.extraDurationS ?? Infinity));

  const add = async (c: Candidate) => {
    insertWaypoint(c.legIndex + 1, {
      lat: c.poi.lat,
      lon: c.poi.lon,
      label: c.poi.name,
      poiId: c.poi.id,
    });
    await computeRoutes({
      needTwo: t('route.needTwo'),
      gridUnavailable: t('route.gridUnavailable'),
    });
  };

  return (
    <section className="card stops" aria-labelledby="stops-title">
      <div className="card-title">
        <span id="stops-title">{t('stops.title')}</span>
        <span className="tag">
          {t('stops.corridor', { distance: formatDistance(CORRIDOR_M, locale) })}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="lede">{t('stops.none')}</p>
      ) : (
        <ul className="stop-list">
          {rows.map(({ poi, offRouteM, legIndex, cost }) => (
            <li key={poi.id} className="stop">
              <div className="stop-main">
                <strong>{poi.name}</strong>
                <span className="meta">{poi.why[lang]}</span>
              </div>
              <div className="stop-cost">
                {cost === undefined ? (
                  <span className="meta">{t('stops.pricing')}</span>
                ) : cost.status === 'ok' ? (
                  <>
                    <b>+{formatDuration(cost.extraDurationS)}</b>
                    <span className="meta">
                      +{formatDistance(cost.extraDistanceM, locale)} ·{' '}
                      {t('stops.offRoute', { distance: formatDistance(offRouteM, locale) })}
                      {' · '}
                      {t('stops.maxSlope', {
                        slope: formatDegrees(cost.maxTerrainSlopeDeg, locale),
                      })}
                    </span>
                  </>
                ) : (
                  <span className="meta">{t('stops.unreachable')}</span>
                )}
              </div>
              <button
                type="button"
                className="btn btn-sm"
                disabled={computing || cost?.status !== 'ok'}
                onClick={() => void add({ poi, offRouteM, legIndex })}
                aria-label={t('stops.addAria', { name: poi.name })}
              >
                {t('stops.add')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="meta">{t('stops.method')}</p>
    </section>
  );
}
