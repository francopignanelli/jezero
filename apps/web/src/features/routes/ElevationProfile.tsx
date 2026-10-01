import type { ElevationProfile as Profile } from '@copernico/domain';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDistance, formatElevation } from '../../lib/format';

const W = 340;
const H = 130;
const PAD = { l: 44, r: 8, t: 8, b: 22 };

/** Slope-band coloured elevation profile. The route's textual table carries the same information. */
export function ElevationProfile({ profile }: { profile: Profile }) {
  const { t, i18n } = useTranslation();
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
    return { total, lo, hi, segments };
  }, [profile]);

  return (
    <figure style={{ margin: '8px 0' }}>
      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${t('route.profileChart')}: ${formatElevation(model.lo, i18n.language)} – ${formatElevation(model.hi, i18n.language)}, ${formatDistance(model.total, i18n.language)}`}
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
        <text x={PAD.l - 4} y={PAD.t + 9} textAnchor="end" fontSize="9" fill="#a4adba">
          {Math.round(model.hi)}
        </text>
        <text x={PAD.l - 4} y={H - PAD.b} textAnchor="end" fontSize="9" fill="#a4adba">
          {Math.round(model.lo)}
        </text>
        <text x={W - PAD.r} y={H - 6} textAnchor="end" fontSize="9" fill="#a4adba">
          {formatDistance(model.total, i18n.language)}
        </text>
        <text x={PAD.l} y={H - 6} fontSize="9" fill="#a4adba">
          0
        </text>
      </svg>
      <figcaption className="meta">{t('route.profileChart')} · m</figcaption>
    </figure>
  );
}
