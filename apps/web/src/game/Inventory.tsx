import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DATA_VERSION, dataUrl } from '../config';
import { PANORAMAS, POIS, samplePhotos } from '../data/catalog';
import type { SampleSite } from '../data/surfaceData';
import {
  missionOf,
  WITNESS_TUBES,
  objectiveCount,
  objectiveDone,
  tubeRack,
  type ExpeditionState,
} from './expedition';
import { mainElements, ROCK_TYPES } from './science';
import type { GameSession } from './session';
import { Spectrum } from './Spectrum';
import { useGame } from './store';

const TABS = ['tubes', 'samples', 'science', 'discoveries', 'journal'] as const;
type Tab = (typeof TABS)[number];

/** Kind of sample, for its explanation. */
export function whyKey(site: SampleSite): string {
  if (site.sampleType === 'Atmospheric') return 'atmospheric';
  if (site.sampleType === 'Regolith') return 'regolith';
  if (/carbonate/i.test(site.rockType)) return 'carbonate';
  if (/mixed/i.test(site.rockType)) return 'mixed';
  if (/^igneous/i.test(site.rockType)) return 'igneous';
  return 'sedimentary';
}

/**
 * The inventory (I): the tube rack, the samples cored here, SuperCam's analyses, the discoveries
 * (panoramas, Ingenuity's flights) and the expedition's journal. The game waits while it is open.
 */
export function Inventory({ session }: { session: GameSession }) {
  const { t } = useTranslation();
  const exp = useGame((s) => s.expedition);
  const [tab, setTab] = useState<Tab>('tubes');
  return (
    <div className="game-screen">
      <section
        className="game-dialog game-inventory"
        role="dialog"
        aria-modal="true"
        aria-labelledby="game-inv-title"
      >
        <header className="game-inventory-head">
          <h2 id="game-inv-title">{t('game.inventory.title')}</h2>
          <button type="button" className="btn" autoFocus onClick={() => session.resume()}>
            {t('game.inventory.close')}
          </button>
        </header>
        <div className="game-tabs" role="tablist" aria-label={t('game.inventory.title')}>
          {TABS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              id={`game-inv-tab-${k}`}
              aria-selected={tab === k}
              aria-controls={`game-inv-panel-${k}`}
              className={tab === k ? 'is-on' : ''}
              onClick={() => setTab(k)}
            >
              {t(`game.inventory.tabs.${k}`)}
            </button>
          ))}
        </div>
        <div
          className="game-tabpanel"
          role="tabpanel"
          id={`game-inv-panel-${tab}`}
          aria-labelledby={`game-inv-tab-${tab}`}
        >
          {tab === 'tubes' && <Tubes exp={exp} sites={session.sampleSites} />}
          {tab === 'samples' && <Samples exp={exp} sites={session.sampleSites} />}
          {tab === 'science' && <Science exp={exp} />}
          {tab === 'discoveries' && <Discoveries exp={exp} session={session} />}
          {tab === 'journal' && <Journal exp={exp} />}
        </div>
      </section>
    </div>
  );
}

function Tubes({ exp, sites }: { exp: ExpeditionState; sites: SampleSite[] }) {
  const { t } = useTranslation();
  const rack = tubeRack(exp);
  const name = (entry: string | null) => sites.find((s) => s.sampleNumber === entry)?.name ?? '';
  const filled = rack.filter((x) => x.number).length;
  return (
    <div className="game-tubes">
      <p className="meta">{t('game.inventory.tubes.intro', { filled, total: rack.length })}</p>
      <ol className="game-rack">
        {rack.map((tube, i) => {
          const state = !tube.number
            ? 'is-empty'
            : tube.depot
              ? 'is-depot'
              : tube.earlier
                ? 'is-earlier'
                : 'is-here';
          const label = tube.number
            ? `${t('game.card.number', { number: tube.number })} · ${name(tube.entry)}${tube.depot ? ` · ${t('game.inventory.tubes.depot')}` : ''}`
            : t('game.inventory.tubes.empty');
          return (
            <li key={i} className={state} title={label} aria-label={label}>
              <span aria-hidden="true">{tube.number ?? ''}</span>
            </li>
          );
        })}
        {Array.from({ length: WITNESS_TUBES }, (_, i) => (
          <li
            key={`w${i}`}
            className="is-witness"
            title={t('game.inventory.tubes.witness')}
            aria-label={t('game.inventory.tubes.witness')}
          >
            <span aria-hidden="true">W</span>
          </li>
        ))}
      </ol>
      <ul className="game-rack-key">
        {(['earlier', 'here', 'depot', 'empty', 'witness'] as const).map((k) => (
          <li key={k} className={`is-${k}`}>
            <span aria-hidden="true" /> {t(`game.inventory.tubes.${k}`)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Samples({ exp, sites }: { exp: ExpeditionState; sites: SampleSite[] }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === 'es' ? 'es' : 'en';
  if (!exp.samples.length) return <p className="meta">{t('game.inventory.samples.none')}</p>;
  return (
    <ul className="game-samples">
      {exp.samples.map((entry) => {
        const site = sites.find((s) => s.sampleNumber === entry);
        if (!site) return null;
        const photo = samplePhotos(entry)[0];
        const numbers: string[] = entry.match(/\d+/g) ?? [];
        const poi = POIS.find((p) => p.sampleNumbers.some((n) => numbers.includes(n)));
        return (
          <li key={entry} className="is-have">
            <details>
              <summary>
                <span className="game-sample-thumb" aria-hidden="true">
                  {photo ? (
                    <img src={dataUrl(`${photo.thumb ?? photo.file}?v=${DATA_VERSION}`)} alt="" />
                  ) : (
                    <span>✓</span>
                  )}
                </span>
                <span>
                  <strong>{site.name}</strong>
                  <span className="meta">
                    {t(numbers.length > 1 ? 'game.card.numbers' : 'game.card.number', {
                      number: entry,
                    })}{' '}
                    · {t('game.collection.sol', { sol: site.sol })}
                  </span>
                </span>
              </summary>
              <div className="game-sample-more">
                {photo && (
                  <figure>
                    <img src={dataUrl(`${photo.file}?v=${DATA_VERSION}`)} alt={photo.name} />
                    <figcaption className="meta">
                      {photo.camera} · {photo.credit}
                    </figcaption>
                  </figure>
                )}
                <p className="meta">
                  {t('game.card.at', { outcrop: site.outcrop, location: site.location })}
                </p>
                <p>{t(`game.card.why.${whyKey(site)}`)}</p>
                {poi && <p>{poi.why[lang]}</p>}
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}

function Science({ exp }: { exp: ExpeditionState }) {
  const { t } = useTranslation();
  if (!exp.finds.length) return <p className="meta">{t('game.inventory.science.none')}</p>;
  const types = ROCK_TYPES.filter((r) => exp.finds.some((f) => f.type === r));
  return (
    <div className="game-science">
      <p className="meta">
        {t('game.inventory.science.total', {
          count: exp.finds.length,
          types: types.length,
          points: exp.science,
        })}
      </p>
      <ul className="game-finds">
        {[...exp.finds].reverse().map((f, i) => (
          <li key={`${f.key}-${i}`}>
            <div>
              <strong>{t(`game.rocks.${f.type}.name`)}</strong>
              <span className="meta">
                +{f.points} · {mainElements(f.type).join(' ')}
                {f.first && ` · ${t('game.finding.new')}`}
              </span>
            </div>
            <Spectrum type={f.type} seed={f.key} small />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Discoveries({ exp, session }: { exp: ExpeditionState; session: GameSession }) {
  const { t } = useTranslation();
  return (
    <div className="game-discoveries">
      <h3>{t('game.inventory.discoveries.panoramas')}</h3>
      <ul className="game-pano-list">
        {missionOf(exp).panoramas.map((p) => {
          const have = exp.panoramas.includes(p.id);
          const pano = PANORAMAS.find((x) => x.id === p.id);
          return (
            <li key={p.id} className={have ? 'is-have' : 'is-locked'}>
              {have && pano ? (
                <img
                  src={dataUrl(`${pano.file.replace('_8k.webp', '_thumb.webp')}?v=${DATA_VERSION}`)}
                  alt=""
                />
              ) : (
                <span className="game-pano-q" aria-hidden="true">
                  ?
                </span>
              )}
              <div>
                <strong>{have ? p.name : t('game.collection.unknown')}</strong>
                <span className="meta">
                  {have && pano
                    ? t('game.pano.sols', {
                        first: pano.sols[0],
                        last: pano.sols[1],
                        date: pano.date,
                      })
                    : t('game.inventory.discoveries.panoramaHint')}
                </span>
              </div>
              {have && (
                <button
                  type="button"
                  className="btn btn-icon"
                  onClick={() => session.viewPanorama(p.id)}
                >
                  {t('game.inventory.discoveries.view')}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <h3>{t('game.inventory.discoveries.flights')}</h3>
      {exp.flights.length ? (
        <ul className="game-flights">
          {exp.flights.map((n) => {
            const f = missionOf(exp).flights.find((x) => x.flight === n);
            return (
              <li key={n}>
                {t('game.inventory.discoveries.flight', {
                  flight: n,
                  sol: f?.sol ?? '',
                  date: f?.date ?? '',
                })}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="meta">{t('game.inventory.discoveries.flightsNone')}</p>
      )}
    </div>
  );
}

function Journal({ exp }: { exp: ExpeditionState }) {
  const { t } = useTranslation();
  return (
    <ol className="game-journal">
      {missionOf(exp).chapters.map((c, i) => {
        const state = i < exp.chapter ? 'is-done' : i === exp.chapter ? 'is-now' : 'is-later';
        return (
          <li key={c.id} className={state}>
            <div className="game-panel-title">
              {t('game.chapter.kicker', { n: i + 1, first: c.sols[0], last: c.sols[1] })}
            </div>
            <strong>
              {i <= exp.chapter ? t(`game.chapters.${c.id}.title`) : t('game.collection.unknown')}
            </strong>
            {i <= exp.chapter && (
              <ul>
                {c.objectives.map((o) => {
                  const done = objectiveDone(exp, o, c);
                  const count = objectiveCount(exp, o, c);
                  return (
                    <li key={o.id} className={done ? 'is-done' : ''}>
                      <span aria-hidden="true">{done ? '✓' : o.optional ? '◇' : '○'}</span>{' '}
                      {t(`game.objectives.${o.id}`)}
                      {count && ` (${count[0]}/${count[1]})`}
                      {o.optional && <em> · {t('game.objectives.optional')}</em>}
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
