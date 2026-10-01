import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { loadCrism, type CrismManifest } from '../../data/surfaceData';
import { useApp } from '../../app/store';
import { RAMP, REACH_COLOURS, SLOPE_COLOURS, type OverlayKind } from '../routes/overlays';

/** CSS colour for a legend swatch. Overlay alphas are tuned for draping; swatches use at least 60 %. */
const rgba = ([r, g, b, a]: readonly [number, number, number, number]) =>
  `rgb(${r} ${g} ${b} / ${Math.max(0.6, a / 255).toFixed(2)})`;
const RAMP_CSS = `linear-gradient(90deg, ${RAMP.map(([r, g, b]) => `rgb(${r} ${g} ${b})`).join(', ')})`;

export function SlopeLegend() {
  const { t } = useTranslation();
  return (
    <div className="legend" role="group" aria-label={t('legend.slope.title')}>
      <strong>{t('legend.slope.title')}</strong>
      <div className="legend-row">
        <span className="swatch" style={{ background: rgba(SLOPE_COLOURS.mild) }} />
        {t('legend.slope.mild')}
      </div>
      <div className="legend-row">
        <span className="swatch" style={{ background: rgba(SLOPE_COLOURS.moderate) }} />
        {t('legend.slope.moderate')}
      </div>
      <div className="legend-row">
        <span className="swatch" style={{ background: rgba(SLOPE_COLOURS.steep) }} />
        {t('legend.slope.steep')}
      </div>
      <div className="legend-row">
        <span className="swatch swatch-striped" />
        {t('legend.slope.blocked')}
      </div>
    </div>
  );
}

/** Continuous legend for the elevation and thermal-inertia overlays (same ramp as the overlay). */
export function RampLegend({
  kind,
  range,
}: {
  kind: Exclude<OverlayKind, 'slope'>;
  range: [number, number];
}) {
  const { t, i18n } = useTranslation();
  const fmt = (v: number) => Math.round(v).toLocaleString(i18n.language);
  return (
    <div className="legend" role="group" aria-label={t(`legend.${kind}.title`)}>
      <strong>{t(`legend.${kind}.title`)}</strong>
      <span className="ramp" style={{ background: RAMP_CSS }} aria-hidden="true" />
      <div className="ramp-labels">
        <span>≤ {fmt(range[0])}</span>
        <span>≥ {fmt(range[1])}</span>
      </div>
      {kind === 'thermalInertia' && (
        <div className="ramp-labels meta">
          <span>{t('legend.thermalInertia.low')}</span>
          <span>{t('legend.thermalInertia.high')}</span>
        </div>
      )}
    </div>
  );
}

/** Discrete round-trip bands from the start, with the cumulative reachable area. */
export function ReachLegend() {
  const { t, i18n } = useTranslation();
  const reach = useApp((s) => s.reach);
  const hasStart = useApp((s) => s.waypoints.length > 0);
  if (!hasStart) {
    return (
      <div className="legend">
        <strong>{t('legend.reach.title')}</strong>
        <span className="meta">{t('legend.reach.needStart')}</span>
      </div>
    );
  }
  if (!reach) {
    return (
      <div className="legend">
        <strong>{t('legend.reach.title')}</strong>
        <span className="meta">{t('legend.reach.computing')}</span>
      </div>
    );
  }
  const fmt = (v: number) => v.toLocaleString(i18n.language, { maximumFractionDigits: 1 });
  return (
    <div className="legend" role="group" aria-label={t('legend.reach.title')}>
      <strong>{t('legend.reach.title')}</strong>
      <div className="reach-bands">
        {reach.bandsH.map((h, i) => (
          <div key={h} className="legend-row">
            <span
              className="swatch"
              style={{ background: rgba(REACH_COLOURS[Math.min(i, REACH_COLOURS.length - 1)]!) }}
            />
            {t('legend.reach.band', { h: fmt(h), area: fmt(reach.areaKm2[i] ?? 0) })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** CRISM composite switch and the meaning of each colour channel. */
export function CrismLegend() {
  const { t } = useTranslation();
  const composite = useApp((s) => s.crismComposite);
  const setComposite = useApp((s) => s.setCrismComposite);
  const [manifest, setManifest] = useState<CrismManifest | null>(null);
  useEffect(() => {
    void loadCrism().then(setManifest);
  }, []);
  const years = [
    ...new Set((manifest?.observations ?? []).map((o) => o.startTime.slice(0, 4))),
  ].join(', ');
  return (
    <div className="legend" role="group" aria-label={t('legend.crism.title')}>
      <strong>{t('legend.crism.title')}</strong>
      <div className="segmented segmented-sm" role="group" aria-label={t('legend.crism.composite')}>
        {(['car', 'maf'] as const).map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={composite === c}
            onClick={() => setComposite(c)}
          >
            {t(`legend.crism.${c}.name`)}
          </button>
        ))}
      </div>
      {(['r', 'g', 'b'] as const).map((ch) => (
        <div key={ch} className="legend-row">
          <span className={`swatch swatch-${ch}`} />
          {t(`legend.crism.${composite}.${ch}`)}
        </div>
      ))}
      <span className="meta">{t(`legend.crism.${composite}.hint`)}</span>
      <span className="meta">
        {t('legend.crism.caveat', { n: manifest?.observations.length ?? 0, years })}
      </span>
    </div>
  );
}

/** Legends for the analysis overlays that are currently visible, shown on the map. */
export function MapLegend() {
  const layers = useApp((s) => s.layers);
  const mode = useApp((s) => s.mode);
  const ranges = useApp((s) => s.overlayRanges);
  if (mode !== 'jezero') return null;
  const items = [
    layers.crism && <CrismLegend key="crism" />,
    layers.reach && <ReachLegend key="reach" />,
    layers.slope && <SlopeLegend key="slope" />,
    layers.elevation && ranges.elevation && (
      <RampLegend key="elevation" kind="elevation" range={ranges.elevation} />
    ),
    layers.thermalInertia && ranges.thermalInertia && (
      <RampLegend key="ti" kind="thermalInertia" range={ranges.thermalInertia} />
    ),
  ].filter(Boolean);
  if (items.length === 0) return null;
  return <div className="map-legend">{items}</div>;
}
