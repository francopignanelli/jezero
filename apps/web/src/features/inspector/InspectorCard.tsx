import type { PointInspection } from '@copernico/domain';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../app/store';
import { loadImageryLayer } from '../../data/surfaceData';
import { formatCoordinate, formatDegrees, formatDistance, formatElevation } from '../../lib/format';
import { nearestOnPolyline } from '../../lib/routeTrack';
import { IconX } from '../../ui/icons';
import { routingClient } from '../routes/routingClient';

type Rect = { west: number; south: number; east: number; north: number };
let ctxRect: Promise<Rect | null> | null = null;
const inRect = (r: Rect | null, lat: number, lon: number) =>
  !!r && lat >= r.south && lat <= r.north && lon >= r.west && lon <= r.east;

/**
 * Everything the planner knows about a clicked point: the same grid values the router uses
 * (elevation, constraint slope, thermal inertia, flags), plus the distance to the planned route.
 */
export function InspectorCard() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const inspected = useApp((s) => s.inspected);
  const setInspected = useApp((s) => s.setInspected);
  const addWaypoint = useApp((s) => s.addWaypoint);
  const gridStatus = useApp((s) => s.gridStatus);
  const result = useApp((s) => s.result);
  const profile = useApp((s) => s.profile);
  const [info, setInfo] = useState<PointInspection | null>(null);
  const [imagery, setImagery] = useState<string | null>(null);

  useEffect(() => {
    setInfo(null);
    setImagery(null);
    if (!inspected || gridStatus !== 'ready') return;
    let cancelled = false;
    void routingClient.inspect(inspected.lat, inspected.lon).then(async (r) => {
      if (cancelled) return;
      setInfo(r);
      if (r.inCoverage) setImagery('HiRISE · MRO');
      else {
        ctxRect ??= loadImageryLayer('ctx').then((m) => m?.rectangle ?? null);
        const rect = await ctxRect;
        if (!cancelled)
          setImagery(inRect(rect, inspected.lat, inspected.lon) ? 'CTX · MRO' : 'Viking Orbiters');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [inspected, gridStatus]);

  if (!inspected) return null;
  const route = result ? (profile === 'lower-risk' ? result.lowerRisk : result.shortest) : null;
  const toRoute =
    route?.status === 'ok' ? nearestOnPolyline(route.points, inspected).distanceM : null;
  const walkable = info?.inCoverage && info.blocked === 'none';

  return (
    <section className="inspector" aria-labelledby="inspector-title" aria-live="polite">
      <div className="card-title">
        <span id="inspector-title">{t('inspector.title')}</span>
        <button
          type="button"
          className="popover-close"
          aria-label={t('inspector.close')}
          onClick={() => setInspected(null)}
        >
          <IconX />
        </button>
      </div>
      <p className="meta">{formatCoordinate(inspected.lat, inspected.lon, locale)}</p>
      {gridStatus !== 'ready' ? (
        <p className="lede">{t('inspector.gridPending')}</p>
      ) : !info ? (
        <p className="meta">{t('inspector.loading')}</p>
      ) : !info.inCoverage ? (
        <>
          <p className="lede">{t('inspector.outside')}</p>
          {imagery && (
            <p className="meta">
              {t('inspector.imagery')}: {imagery}
            </p>
          )}
        </>
      ) : (
        <>
          <dl className="inspector-grid">
            <dt>{t('inspector.elevation')}</dt>
            <dd>{formatElevation(info.elevationM, locale)}</dd>
            <dt>{t('inspector.slope')}</dt>
            <dd>
              {formatDegrees(info.slopeDeg, locale)}
              {info.band && info.band !== 'beyond' && (
                <small> · {t(`legend.slope.${info.band}`)}</small>
              )}
            </dd>
            <dt>{t('inspector.ti')}</dt>
            <dd>
              {info.thermalInertia === null
                ? '—'
                : `${Math.round(info.thermalInertia)} J m⁻² K⁻¹ s⁻½`}
            </dd>
            {toRoute !== null && (
              <>
                <dt>{t('inspector.toRoute')}</dt>
                <dd>{formatDistance(toRoute, locale)}</dd>
              </>
            )}
            <dt>{t('inspector.imagery')}</dt>
            <dd>{imagery ?? '—'}</dd>
          </dl>
          {info.blocked !== 'none' && (
            <p className="inspector-flag warn">
              {t('inspector.blocked', { reason: t(`inspector.reasons.${info.blocked}`) })}
            </p>
          )}
          {info.rough && <p className="inspector-flag">{t('inspector.rough')}</p>}
          {info.lowThermalInertia && <p className="inspector-flag">{t('inspector.lowTi')}</p>}
          {walkable && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                addWaypoint({ lat: inspected.lat, lon: inspected.lon });
                setInspected(null);
              }}
            >
              {t('inspector.addWaypoint')}
            </button>
          )}
        </>
      )}
    </section>
  );
}
