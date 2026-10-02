import type { ElevationProfile as Profile } from '@copernico/domain';
import { useEffect, useMemo, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../app/store';
import { formatDegrees, formatDistance, formatDuration, formatElevation } from '../../lib/format';
import { profileAt } from '../../lib/routeTrack';

const W = 340;
const H = 130;
const PAD = { l: 44, r: 8, t: 8, b: 22 };

/**
 * Slope-band coloured elevation profile. Hovering, dragging or using the arrow keys moves a cursor
 * that is mirrored as a marker on the 3D route. The itinerary table carries the same information.
 */
export function ElevationProfile({ profile }: { profile: Profile }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const cursorM = useApp((s) => s.routeCursorM);
  const setCursor = useApp((s) => s.setRouteCursor);
  const focused = useRef(false);
  // A new route invalidates the cursor position.
  useEffect(() => () => setCursor(null), [profile, setCursor]);

  const model = useMemo(() => {
    const n = profile.distanceM.length;
    const total = profile.distanceM[n - 1] ?? 0;
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const z of profile.elevationM) {
      if (Number.isFinite(z)) {
        lo = Math.min(lo, z);
        hi = Math.max(hi, z);
      }
    }
    const span = Math.max(10, hi - lo);
    const x = (d: number) => PAD.l + (d / Math.max(1, total)) * (W - PAD.l - PAD.r);
    const y = (z: number) => PAD.t + (1 - (z - lo) / span) * (H - PAD.t - PAD.b);
    const step = Math.max(1, Math.floor(n / 400));
    const segments: Array<{ d: string; colour: string }> = [];
    for (let i = step; i < n; i += step) {
      const a = i - step;
      const s = profile.terrainSlopeDeg[i] ?? 0;
      const colour = s <= 10 ? '#1f9e89' : s <= 15 ? '#fde725' : '#f89540';
      segments.push({
        d: `M${x(profile.distanceM[a]!)},${y(profile.elevationM[a]!)}L${x(profile.distanceM[i]!)},${y(profile.elevationM[i]!)}`,
        colour,
      });
    }
    return { total, lo, hi, segments, x, y };
  }, [profile]);

  const sample = cursorM === null ? null : profileAt(profile, cursorM);
  const readout = (d: number) => {
    const p = profileAt(profile, d);
    return t('route.profileReadout', {
      distance: formatDistance(p.distanceM, locale),
      elevation: formatElevation(p.elevationM, locale),
      slope: formatDegrees(p.slopeDeg, locale),
      elapsed: formatDuration(p.elapsedS),
    });
  };

  const fromPointer = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - box.left) / box.width) * W;
    const f = (vx - PAD.l) / (W - PAD.l - PAD.r);
    setCursor(Math.min(1, Math.max(0, f)) * model.total);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = Math.max(10, model.total / 100);
    const current = cursorM ?? 0;
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowUp'
        ? current + step
        : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
          ? current - step
          : e.key === 'PageUp'
            ? current + step * 10
            : e.key === 'PageDown'
              ? current - step * 10
              : e.key === 'Home'
                ? 0
                : e.key === 'End'
                  ? model.total
                  : null;
    if (next === null) return;
    e.preventDefault();
    setCursor(Math.min(model.total, Math.max(0, next)));
  };

  return (
    <figure className="profile" data-tour="profile">
      <div
        className="profile-slider"
        role="slider"
        tabIndex={0}
        aria-label={t('route.profileCursor')}
        aria-valuemin={0}
        aria-valuemax={Math.round(model.total)}
        aria-valuenow={Math.round(cursorM ?? 0)}
        aria-valuetext={readout(cursorM ?? 0)}
        onKeyDown={onKey}
        onFocus={() => {
          focused.current = true;
          if (cursorM === null) setCursor(0);
        }}
        onBlur={() => {
          focused.current = false;
          setCursor(null);
        }}
      >
        <svg
          width="100%"
          viewBox={`0 0 ${W} ${H}`}
          aria-hidden="true"
          onPointerMove={fromPointer}
          onPointerDown={fromPointer}
          onPointerLeave={() => {
            if (!focused.current) setCursor(null);
          }}
        >
          <rect
            x={PAD.l}
            y={PAD.t}
            width={W - PAD.l - PAD.r}
            height={H - PAD.t - PAD.b}
            fill="#0b0e13"
            stroke="#2b3441"
          />
          {model.segments.map((s, i) => (
            <path key={i} d={s.d} stroke={s.colour} strokeWidth={2.2} fill="none" />
          ))}
          {sample && (
            <g>
              <line
                x1={model.x(sample.distanceM)}
                x2={model.x(sample.distanceM)}
                y1={PAD.t}
                y2={H - PAD.b}
                stroke="#ffffff"
                strokeOpacity={0.6}
                strokeDasharray="3 3"
              />
              <circle
                cx={model.x(sample.distanceM)}
                cy={model.y(sample.elevationM)}
                r={4}
                fill="#ffffff"
                stroke="#0b0e13"
                strokeWidth={1.5}
              />
            </g>
          )}
          <text x={PAD.l - 4} y={PAD.t + 9} textAnchor="end" fontSize="9" fill="#a4adba">
            {Math.round(model.hi)}
          </text>
          <text x={PAD.l - 4} y={H - PAD.b} textAnchor="end" fontSize="9" fill="#a4adba">
            {Math.round(model.lo)}
          </text>
          <text x={W - PAD.r} y={H - 6} textAnchor="end" fontSize="9" fill="#a4adba">
            {formatDistance(model.total, locale)}
          </text>
          <text x={PAD.l} y={H - 6} fontSize="9" fill="#a4adba">
            0
          </text>
        </svg>
      </div>
      <figcaption className="meta profile-readout" aria-live="off">
        {sample ? readout(sample.distanceM) : t('route.profileHint')}
      </figcaption>
    </figure>
  );
}
