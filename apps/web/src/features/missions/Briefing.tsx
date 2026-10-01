import type { EvaTimeline, RouteResult } from '@copernico/domain';
import { solarPosition } from '@copernico/domain';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp, type WaypointEntry } from '../../app/store';
import { datasetById } from '../../data/catalog';
import { DATASET_ID, JEZERO } from '../../config';
import {
  formatDegrees,
  formatDistance,
  formatDuration,
  formatElevation,
  formatHours,
  formatUtc,
} from '../../lib/format';
import { currentScene } from '../../render/sceneRegistry';

const USED_DATASETS = [
  'hirise-dtm-trn',
  'hirise-ortho-trn',
  'ctx-ortho-jpl',
  'mola-megdr-32',
  'viking-color-925',
  'themis-ti-jezero',
  'm2020-mmgis',
  'm2020-meda',
];
const ltst = (ms: number) => formatHours(solarPosition(ms, JEZERO).ltstHours);

/** Printable mission briefing (rendered only while printing; see the print stylesheet). */
export function Briefing({
  name,
  route,
  timeline,
  names,
}: {
  name: string;
  route: RouteResult;
  timeline: EvaTimeline | null;
  names: (w: WaypointEntry, i: number) => string;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const waypoints = useApp((s) => s.waypoints);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const m = route.metrics!;

  useEffect(() => {
    void currentScene()?.snapshot().then(setSnapshot);
  }, []);

  const count = waypoints.length;
  return (
    <article className="briefing" aria-label={t('briefing.title')}>
      <header>
        <p className="briefing-kicker">{t('briefing.kicker')}</p>
        <h1>{name}</h1>
        {timeline && (
          <p>
            {t('briefing.start', {
              ltst: ltst(timeline.startUtcMs),
              utc: formatUtc(timeline.startUtcMs, locale),
            })}
          </p>
        )}
      </header>
      {snapshot && <img src={snapshot} alt={t('briefing.mapAlt')} className="briefing-map" />}

      <section>
        <h2>{t('briefing.summary')}</h2>
        <table>
          <tbody>
            <tr>
              <th>{t('metrics.distance')}</th>
              <td>{formatDistance(m.horizontalDistanceM, locale)}</td>
              <th>{t('metrics.duration')}</th>
              <td>{formatDuration(m.estimatedDurationS)}</td>
            </tr>
            <tr>
              <th>{t('metrics.gain')}</th>
              <td>{formatElevation(m.elevationGainM, locale)}</td>
              <th>{t('metrics.maxSlope')}</th>
              <td>{formatDegrees(m.maxTerrainSlopeDeg, locale)}</td>
            </tr>
            {timeline && (
              <tr>
                <th>{t('briefing.evaTotal')}</th>
                <td>{formatDuration(timeline.totalS)}</td>
                <th>{t('metrics.walkback')}</th>
                <td>{formatDuration(timeline.walkbackMarginS)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {timeline && (
        <section>
          <h2>{t('timeline.title')}</h2>
          <table>
            <tbody>
              {timeline.events
                .filter((e) => e.kind !== 'leave')
                .map((e, i) => (
                  <tr key={i}>
                    <td>{ltst(e.utcMs)} LTST</td>
                    <td>{formatUtc(e.utcMs, locale)}</td>
                    <td>
                      {t(`timeline.events.${e.kind}`, {
                        name: names(waypoints[e.waypointIndex]!, e.waypointIndex),
                      })}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          <p>
            {timeline.sunBelowAtS === null
              ? timeline.daylightMarginS !== null &&
                t('timeline.daylightOk', {
                  margin: formatDuration(timeline.daylightMarginS),
                  deg: timeline.minSunElevationDeg,
                  time: ltst(timeline.endUtcMs + timeline.daylightMarginS * 1000),
                })
              : t('briefing.daylightWarning')}
          </p>
        </section>
      )}

      <section>
        <h2>{t('route.itinerary')}</h2>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>{t('metrics.distance')}</th>
              <th>+/−</th>
              <th>{t('metrics.maxSlope')}</th>
              <th>{t('metrics.duration')}</th>
            </tr>
          </thead>
          <tbody>
            {route.legs.map((leg, i) => (
              <tr key={i}>
                <td>
                  {names(waypoints[leg.fromWaypoint]!, leg.fromWaypoint)} →{' '}
                  {leg.toWaypoint >= count
                    ? names(waypoints[0]!, 0)
                    : names(waypoints[leg.toWaypoint]!, leg.toWaypoint)}
                </td>
                <td>{formatDistance(leg.horizontalDistanceM, locale)}</td>
                <td>
                  +{Math.round(leg.elevationGainM)}/−{Math.round(leg.elevationLossM)} m
                </td>
                <td>{formatDegrees(leg.maxTerrainSlopeDeg, locale)}</td>
                <td>{formatDuration(leg.estimatedDurationS)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>{t('route.unresolved')}</h2>
        <p>{t('route.unresolvedList')}</p>
        <p>{t('app.prototypeNotice')}</p>
      </section>

      <section>
        <h2>{t('briefing.sources')}</h2>
        <ul>
          {USED_DATASETS.map((id) => datasetById(id))
            .filter((d) => d !== undefined)
            .map((d) => (
              <li key={d.id}>
                {d.mission} · {d.title}. {d.citation}
              </li>
            ))}
        </ul>
        <p>
          {t('route.algorithm', {
            algorithm: route.algorithmVersion,
            params: route.parameterSet,
            data: DATASET_ID,
          })}
        </p>
      </section>
    </article>
  );
}
