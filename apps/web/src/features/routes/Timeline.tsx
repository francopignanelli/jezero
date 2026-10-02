import { solarPosition, type EvaTimeline, type RouteResult } from '@copernico/domain';
import type { PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp, type WaypointEntry } from '../../app/store';
import { JEZERO } from '../../config';
import { formatDuration, formatHours, formatUtc } from '../../lib/format';
import { distanceAtElapsed } from '../../lib/routeTrack';
import { Term } from '../guide/Glossary';

const W = 340;
const BAR_H = 14;
const SUN_H = 46;
const SUN_TOP = BAR_H + 8;
const H = SUN_TOP + SUN_H + 12;

const ltst = (utcMs: number) => formatHours(solarPosition(utcMs, JEZERO).ltstHours);

/**
 * EVA timeline: walking legs and time at stops on one clock, with the calculated Sun elevation
 * over the EVA and the daylight check. Hovering a walking block follows the route on the map.
 */
export function Timeline({
  timeline,
  route,
  names,
}: {
  timeline: EvaTimeline;
  route: RouteResult;
  names: (w: WaypointEntry | undefined, index: number) => string;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const waypoints = useApp((s) => s.waypoints);
  const setCursor = useApp((s) => s.setRouteCursor);
  const tl = timeline;
  const x = (s: number) => (s / Math.max(1, tl.totalS)) * W;

  // Sun curve scaled to [min(0, lowest), max(highest, threshold + 10)] degrees.
  const lo = Math.min(0, ...tl.sun.map((p) => p.elevationDeg));
  const hi = Math.max(tl.minSunElevationDeg + 10, ...tl.sun.map((p) => p.elevationDeg));
  const y = (deg: number) => SUN_TOP + (1 - (deg - lo) / Math.max(1, hi - lo)) * SUN_H;
  const sunPath = tl.sun
    .map((p, i) => `${i ? 'L' : 'M'}${x(p.elapsedS).toFixed(1)},${y(p.elevationDeg).toFixed(1)}`)
    .join('');

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const at = ((e.clientX - box.left) / box.width) * tl.totalS;
    // Walking time elapsed at `at`: total minus the stop time already spent (clamped inside a stop).
    let dwellBefore = 0;
    for (const seg of tl.segments) {
      if (seg.kind !== 'dwell' || seg.startS >= at) continue;
      dwellBefore += Math.min(at, seg.endS) - seg.startS;
    }
    const profile = route.metrics?.profile;
    if (profile) setCursor(distanceAtElapsed(profile, at - dwellBefore));
  };

  const daylightOk = tl.sunBelowAtS === null;
  const legOfBelow =
    tl.sunBelowAtS === null
      ? null
      : tl.segments.find((s) => s.startS <= tl.sunBelowAtS! && s.endS >= tl.sunBelowAtS!);

  return (
    <section className="timeline" aria-labelledby="timeline-title" data-tour="timeline">
      <h3 id="timeline-title">
        <Term id="daylight">{t('timeline.title')}</Term>
      </h3>
      <p className="timeline-summary">
        {t('timeline.summary', {
          start: ltst(tl.startUtcMs),
          end: ltst(tl.endUtcMs),
          total: formatDuration(tl.totalS),
          walk: formatDuration(tl.walkS),
          dwell: formatDuration(tl.dwellS),
        })}
      </p>
      <svg
        className="timeline-chart"
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        aria-hidden="true"
        onPointerMove={onMove}
        onPointerLeave={() => setCursor(null)}
      >
        {tl.segments.map((s, i) => (
          <rect
            key={i}
            x={x(s.startS)}
            y={0}
            width={Math.max(1, x(s.endS) - x(s.startS) - 1)}
            height={BAR_H}
            rx={3}
            className={s.kind === 'walk' ? 'tl-walk' : 'tl-dwell'}
          />
        ))}
        <line
          x1={0}
          x2={W}
          y1={y(tl.minSunElevationDeg)}
          y2={y(tl.minSunElevationDeg)}
          className="tl-threshold"
        />
        <text x={W - 2} y={y(tl.minSunElevationDeg) - 3} textAnchor="end" className="tl-label">
          {t('timeline.threshold', { deg: tl.minSunElevationDeg })}
        </text>
        <path d={sunPath} className={daylightOk ? 'tl-sun' : 'tl-sun tl-sun-bad'} fill="none" />
        <text x={2} y={H - 1} className="tl-label">
          {ltst(tl.startUtcMs)}
        </text>
        <text x={W - 2} y={H - 1} textAnchor="end" className="tl-label">
          {ltst(tl.endUtcMs)}
        </text>
      </svg>
      <div className="tl-legend meta">
        <span>
          <i className="tl-key tl-walk" /> {t('timeline.walking')}
        </span>
        <span>
          <i className="tl-key tl-dwell" /> {t('timeline.atStop')}
        </span>
        <span>
          <i className="tl-key tl-sun-key" /> {t('timeline.sun')}
        </span>
      </div>

      {daylightOk ? (
        <p className="tl-check ok">
          {tl.daylightMarginS !== null
            ? t('timeline.daylightOk', {
                margin: formatDuration(tl.daylightMarginS),
                deg: tl.minSunElevationDeg,
                time: ltst(tl.endUtcMs + tl.daylightMarginS * 1000),
              })
            : t('timeline.daylightOkNoEnd')}
        </p>
      ) : tl.sunBelowAtS === 0 ? (
        <p className="tl-check bad" role="alert">
          {t('timeline.daylightBadStart', {
            deg: tl.minSunElevationDeg,
            time: ltst(tl.startUtcMs),
          })}
        </p>
      ) : (
        <p className="tl-check bad" role="alert">
          {t('timeline.daylightBad', {
            deg: tl.minSunElevationDeg,
            time: ltst(tl.startUtcMs + tl.sunBelowAtS! * 1000),
            where:
              legOfBelow?.kind === 'dwell'
                ? t('timeline.atName', {
                    name: names(waypoints[legOfBelow.index], legOfBelow.index),
                  })
                : t('timeline.onLeg', { n: (legOfBelow?.index ?? 0) + 1 }),
          })}
        </p>
      )}

      <ol className="tl-events">
        {tl.events.map((e, i) => {
          const name = names(waypoints[e.waypointIndex], e.waypointIndex);
          const next = tl.events[i + 1];
          const dwell =
            e.kind === 'arrive' && next?.kind === 'leave' ? next.elapsedS - e.elapsedS : 0;
          if (e.kind === 'leave') return null;
          return (
            <li key={i}>
              <time dateTime={new Date(e.utcMs).toISOString()} title={formatUtc(e.utcMs, locale)}>
                {ltst(e.utcMs)}
              </time>
              <span>
                {t(`timeline.events.${e.kind}`, { name })}
                {dwell > 0 && (
                  <small> · {t('timeline.stopFor', { duration: formatDuration(dwell) })}</small>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="meta">{t('timeline.note')}</p>
    </section>
  );
}
