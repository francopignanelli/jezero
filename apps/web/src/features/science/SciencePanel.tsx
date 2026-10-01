import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../app/store';
import { POIS } from '../../data/catalog';
import {
  loadRover,
  loadSamples,
  type RoverSnapshot,
  type SampleSite,
} from '../../data/surfaceData';
import { formatCoordinate } from '../../lib/format';
import { StopsNearRoute } from './StopsNearRoute';

/** Route-planning coverage of the operational region (see data/build/regions/jezero/grid.json). */
const COVERAGE = { west: 77.28, east: 77.48, south: 18.4, north: 18.52 };
const inCoverage = (lat: number, lon: number) =>
  lat >= COVERAGE.south && lat <= COVERAGE.north && lon >= COVERAGE.west && lon <= COVERAGE.east;

export function SciencePanel() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith('es') ? 'es' : 'en';
  const addWaypoint = useApp((s) => s.addWaypoint);
  const flyTo = useApp((s) => s.flyTo);
  const setMode = useApp((s) => s.setMode);
  const [rover, setRover] = useState<RoverSnapshot | null>(null);
  const [samples, setSamples] = useState<SampleSite[]>([]);
  const selectedPoiId = useApp((s) => s.selectedPoiId);
  const selectPoi = useApp((s) => s.selectPoi);
  const listRef = useRef<HTMLDivElement>(null);

  // A POI picked on the map opens its card here.
  useEffect(() => {
    if (!selectedPoiId) return;
    listRef.current
      ?.querySelector(`#poi-card-${selectedPoiId}`)
      ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [selectedPoiId]);

  useEffect(() => {
    void loadRover().then(setRover);
    void loadSamples().then((s) => setSamples(s?.samples ?? []));
  }, []);

  const show = (lat: number, lon: number) => {
    setMode('jezero');
    flyTo(lat, lon);
  };

  const updated = rover?.sources[0]?.lastModified
    ? new Date(rover.sources[0].lastModified).toISOString().slice(0, 10)
    : '—';

  return (
    <section aria-labelledby="science-title">
      <h2 id="science-title">{t('science.title')}</h2>
      <p className="lede">{t('science.intro')}</p>

      <StopsNearRoute />

      {rover && (
        <div className="card">
          <div className="card-title">
            {t('science.rover')}
            <span
              className={`tag ${inCoverage(rover.latest.lat, rover.latest.lon) ? '' : 'tag-out'}`}
            >
              {inCoverage(rover.latest.lat, rover.latest.lon)
                ? t('science.inCoverage')
                : t('science.roverOutside')}
            </span>
          </div>
          <p className="lede">
            {t('science.roverLatest', { sol: rover.latest.sol, date: updated })}
          </p>
          <p className="meta">
            {formatCoordinate(rover.latest.lat, rover.latest.lon, i18n.language)}
          </p>
          <p className="meta">{rover.provenance}</p>
          <button
            type="button"
            className="btn"
            onClick={() => show(rover.latest.lat, rover.latest.lon)}
          >
            {t('science.flyTo')}
          </button>
        </div>
      )}

      <h3>{t('science.pois')}</h3>
      <div ref={listRef}>
        {POIS.map((p) => {
          const inside = inCoverage(p.lat, p.lon);
          return (
            <details
              key={p.id}
              id={`poi-card-${p.id}`}
              className="card poi"
              open={selectedPoiId === p.id}
              onToggle={(e) => {
                const open = (e.currentTarget as HTMLDetailsElement).open;
                if (open && selectedPoiId !== p.id) selectPoi(p.id);
                if (!open && selectedPoiId === p.id) selectPoi(null);
              }}
            >
              <summary className="card-title">
                <span id={`poi-${p.id}`}>{p.name}</span>
                <span className={`tag ${inside ? '' : 'tag-out'}`}>
                  {inside ? t('science.inCoverage') : t('science.outCoverage')}
                </span>
              </summary>
              <p style={{ fontSize: 'var(--fs-sm)', margin: '6px 0' }}>
                <strong>{t('science.why')}:</strong> {p.why[lang]}
              </p>
              <p style={{ fontSize: 'var(--fs-sm)', margin: '6px 0' }}>
                <strong>{t('science.investigate')}:</strong> {p.investigate[lang]}
              </p>
              <p className="meta">
                {formatCoordinate(p.lat, p.lon, i18n.language)} · {p.basis}
              </p>
              <p className="meta">
                {t('science.source')}: {p.sources.join('; ')}
              </p>
              <div className="btn-row">
                <button type="button" className="btn" onClick={() => show(p.lat, p.lon)}>
                  {t('science.flyTo')}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={!inside}
                  onClick={() =>
                    addWaypoint({ lat: p.lat, lon: p.lon, label: p.name, poiId: p.id })
                  }
                >
                  {t('science.addStop')}
                </button>
              </div>
            </details>
          );
        })}
      </div>

      <details className="samples">
        <summary>
          <h3 style={{ display: 'inline' }}>{t('science.samplesCount', { n: samples.length })}</h3>
        </summary>
        <table className="data">
          <tbody>
            {samples.map((s) => (
              <tr key={s.sampleNumber}>
                <th scope="row">{s.name}</th>
                <td>
                  {t('science.sampleMeta', {
                    n: s.sampleNumber,
                    sol: s.sol,
                    date: s.earthDate,
                    rock: s.rockType,
                  })}
                  {s.positionCorrectedFromEastingNorthing && (
                    <div className="meta">{t('science.corrected')}</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
