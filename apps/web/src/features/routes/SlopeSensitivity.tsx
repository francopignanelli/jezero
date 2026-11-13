import { DEFAULT_EVA_PARAMS, SLOPE_SCENARIOS_DEG, type RouteMetrics } from '@copernico/domain';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../app/store';
import { formatDegrees, formatDistance, formatDuration } from '../../lib/format';
import { routingClient } from './routingClient';
import type { SlopeScenario } from './routing.worker';

/**
 * How much the lower-risk route depends on its least certain assumption, the maximum slope a
 * suited walker can take (20°, from lunar sources, applied to Mars's 0.38 g): the same Marswalk
 * planned again with 15° and 25°, side by side, and what that says about it.
 */
export function SlopeSensitivity({ metrics }: { metrics: RouteMetrics }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const result = useApp((s) => s.result);
  const waypoints = useApp((s) => s.waypoints);
  const returnToStart = useApp((s) => s.returnToStart);
  const [scenarios, setScenarios] = useState<SlopeScenario[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setScenarios(null);
    setFailed(false);
    routingClient
      .scenarios(
        waypoints.map((w) => ({ lat: w.lat, lon: w.lon })),
        returnToStart,
        [...SLOPE_SCENARIOS_DEG],
      )
      .then((s) => live && setScenarios(s))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
    // Recomputed for each new result (planned for the waypoints of that moment).
  }, [result]);

  const base: SlopeScenario = {
    maxSlopeDeg: DEFAULT_EVA_PARAMS.maxSlopeDeg,
    found: true,
    distanceM: metrics.horizontalDistanceM,
    durationS: metrics.estimatedDurationS,
    maxSlopeOnRouteDeg: metrics.maxTerrainSlopeDeg,
    walkbackOk: metrics.walkback.ok,
  };
  const rows = scenarios ? [...scenarios, base].sort((a, b) => a.maxSlopeDeg - b.maxSlopeDeg) : null;

  return (
    <section aria-labelledby="slope-sensitivity" className="sensitivity">
      <h4 id="slope-sensitivity">{t('route.sensitivity.title')}</h4>
      <p className="meta">{t('route.sensitivity.intro', { deg: DEFAULT_EVA_PARAMS.maxSlopeDeg })}</p>
      {failed && <p className="meta">{t('route.sensitivity.failed')}</p>}
      {!rows && !failed && <p className="meta">{t('route.sensitivity.computing')}</p>}
      {rows && (
        <>
          <table className="data">
            <thead>
              <tr>
                <th scope="col">{t('route.sensitivity.limit')}</th>
                <th scope="col" className="num">{t('metrics.distance')}</th>
                <th scope="col" className="num">{t('metrics.duration')}</th>
                <th scope="col" className="num">{t('metrics.maxSlope')}</th>
                <th scope="col">{t('metrics.walkback')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.maxSlopeDeg} className={r === base ? 'is-current' : ''}>
                  <th scope="row">
                    {formatDegrees(r.maxSlopeDeg, locale)}
                    {r === base && ` · ${t('route.sensitivity.current')}`}
                  </th>
                  {r.found ? (
                    <>
                      <td className="num">{formatDistance(r.distanceM!, locale)}</td>
                      <td className="num">{formatDuration(r.durationS!)}</td>
                      <td className="num">{formatDegrees(r.maxSlopeOnRouteDeg!, locale)}</td>
                      <td style={{ color: r.walkbackOk ? 'var(--ok)' : 'var(--danger)' }}>
                        {r.walkbackOk ? t('route.sensitivity.ok') : t('route.sensitivity.tooLong')}
                      </td>
                    </>
                  ) : (
                    <td colSpan={4} style={{ color: 'var(--danger)' }}>
                      {t('route.sensitivity.none')}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="lede">{verdict(rows, base, t)}</p>
        </>
      )}
    </section>
  );
}

/** One sentence: does the route stand if the slope limit is wrong? */
function verdict(
  rows: SlopeScenario[],
  base: SlopeScenario,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  const lower = rows.find((r) => r.maxSlopeDeg < base.maxSlopeDeg);
  const upper = rows.find((r) => r.maxSlopeDeg > base.maxSlopeDeg);
  if (lower && !lower.found) return t('route.sensitivity.needsSteep', { deg: lower.maxSlopeDeg });
  const change = (r?: SlopeScenario) =>
    r?.found && r.distanceM && base.distanceM ? Math.abs(r.distanceM - base.distanceM) / base.distanceM : 0;
  const worst = Math.max(change(lower), change(upper));
  if (worst < 0.1) return t('route.sensitivity.robust');
  return t('route.sensitivity.depends', { pct: Math.round(worst * 100) });
}
