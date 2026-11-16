import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp, type LayerId } from '../../app/store';
import { POIS, panoramaForPoi, samplePhotos } from '../../data/catalog';
import {
  loadRover,
  loadSamples,
  type RoverSnapshot,
  type SampleSite,
} from '../../data/surfaceData';
import { exploreLink, loadGameAreas } from '../../data/gameAreas';
import { formatCoordinate } from '../../lib/format';
import { Icon360 } from '../../ui/icons';
import { SamplePhotos } from './SamplePhotos';

/** Route-planning coverage of the operational region (see data/build/regions/jezero/grid.json). */
const COVERAGE = { west: 77.28, east: 77.48, south: 18.4, north: 18.52 };
const inCoverage = (lat: number, lon: number) =>
  lat >= COVERAGE.south && lat <= COVERAGE.north && lon >= COVERAGE.west && lon <= COVERAGE.east;

/** Map layers offered as one-tap chips in this tab (the Layers control has them all). */
const MISSION_LAYERS: LayerId[] = ['rover', 'samples', 'ingenuity'];
const GROUND_LAYERS: LayerId[] = ['crism', 'thermalInertia', 'slope', 'elevation'];

function LayerChips({ ids, tour }: { ids: LayerId[]; tour?: string }) {
  const { t } = useTranslation();
  const layers = useApp((s) => s.layers);
  const setLayer = useApp((s) => s.setLayer);
  return (
    <div className="layer-chips" data-tour={tour}>
      {ids.map((id) => (
        <button
          key={id}
          type="button"
          className="layer-chip"
          aria-pressed={layers[id]}
          onClick={() => setLayer(id, !layers[id])}
        >
          {t(`layers.items.${id}`)}
        </button>
      ))}
    </div>
  );
}

export function SurfacePanel() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith('es') ? 'es' : 'en';
  const addWaypoint = useApp((s) => s.addWaypoint);
  const flyTo = useApp((s) => s.flyTo);
  const openPanorama = useApp((s) => s.setPanoramaOpen);
  const setMode = useApp((s) => s.setMode);
  const goTo = useApp((s) => s.goTo);
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

  // Places that are on one of the game's maps: they can be driven to there.
  const [inGame, setInGame] = useState<Set<string>>(new Set());
  useEffect(() => {
    void loadGameAreas().then((areas) =>
      setInGame(
        new Set(
          POIS.filter((p) =>
            areas.some(
              (b) => p.lat >= b.south && p.lat <= b.north && p.lon >= b.west && p.lon <= b.east,
            ),
          ).map((p) => p.id),
        ),
      ),
    );
  }, []);

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
    <section aria-labelledby="surface-title">
      <h2 id="surface-title">{t('surface.title')}</h2>
      <p className="lede">{t('surface.intro')}</p>

      <button type="button" className="next-tab surface-to-360" onClick={() => goTo('panoramas')}>
        <Icon360 />
        <span>
          <strong>{t('nav.panoramas')}</strong>
          <span>{t('surface.to360')}</span>
        </span>
      </button>

      {rover && (
        <div className="card" data-tour="rover">
          <div className="card-title">{t('science.rover')}</div>
          <p className="lede">
            {t('science.roverWhere', { sol: rover.latest.sol, date: updated })}
          </p>
          <LayerChips ids={MISSION_LAYERS} />
          <p className="meta">{rover.provenance}</p>
          <a className="btn" href="./play.html">
            {t('surface.drive')}
          </a>
        </div>
      )}

      <div className="card">
        <div className="card-title">{t('surface.groundTitle')}</div>
        <p className="lede">{t('surface.ground')}</p>
        <LayerChips ids={GROUND_LAYERS} tour="ground-layers" />
        <p className="meta inspect-tip">{t('surface.inspectTip')}</p>
      </div>

      <h3>{t('science.pois')}</h3>
      <div ref={listRef} data-tour="pois">
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
                {panoramaForPoi(p.id) && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => openPanorama(panoramaForPoi(p.id)!.id)}
                  >
                    {t('panorama.open', { sol: panoramaForPoi(p.id)!.sols[0] })}
                  </button>
                )}
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
                {inGame.has(p.id) && (
                  <a className="btn" href={exploreLink(p.lat, p.lon)}>
                    {t('science.driveHere')}
                  </a>
                )}
              </div>
            </details>
          );
        })}
      </div>

      <details className="samples" open data-tour="samples">
        <summary>
          <h3 style={{ display: 'inline' }}>{t('science.samplesCount', { n: samples.length })}</h3>
        </summary>
        <p className="meta">{t('samplePhoto.listNote')}</p>
        <ul className="sample-list">
          {samples.map((s) => (
            <li key={s.sampleNumber}>
              <SamplePhotos photos={samplePhotos(s.sampleNumber)} />
              <span className="sample-text">
                <strong>{s.name}</strong>
                <span>
                  {t('science.sampleMeta', {
                    n: s.sampleNumber,
                    sol: s.sol,
                    date: s.earthDate,
                    rock: s.rockType,
                  })}
                </span>
                {s.positionCorrectedFromEastingNorthing && (
                  <span className="meta">{t('science.corrected')}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
