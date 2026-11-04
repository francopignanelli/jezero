import { memo, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { DATA_VERSION, dataUrl } from '../config';
import { POIS, samplePhotos } from '../data/catalog';
import { LANGUAGES } from '../i18n';
import { formatClock, formatDegrees, formatDistance } from '../lib/format';
import { M_PER_DEG } from '../lib/math';
import { readBest, readCareer, resetProgress, type Career } from './career';
import {
  CHAPTERS,
  FLIGHTS,
  START,
  isDone,
  objectiveCount,
  objectiveDone,
  type Target,
} from './expedition';
import { Inventory, whyKey } from './Inventory';
import { PanoramaView } from './PanoramaView';
import { deletePhoto, downloadBlob, listPhotos, photoFileName, type Photo } from './photos';
import { DRIVE } from './roverSim';
import { mainElements, POINTS, ROCK_TYPES } from './science';
import { GameSession, readQuality, writeQuality } from './session';
import { Spectrum } from './Spectrum';
import { useGame } from './store';
import { PHOTO_FILTERS, type Quality } from './world/world';

const HOME = './';

export function GameApp() {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState<GameSession | null>(null);
  const phase = useGame((s) => s.phase);

  useEffect(() => {
    if (!host.current) return;
    const reveal = () => {
      document.querySelector('.game-boot')?.classList.add('is-leaving');
      window.setTimeout(() => document.querySelector('.game-boot')?.remove(), 700);
    };
    const s = GameSession.open(host.current);
    if (!s) {
      useGame.getState().set({ phase: 'failed' });
      reveal();
      return;
    }
    let live = true;
    void s.load().then((ok) => {
      if (!live) return; // React StrictMode's discarded first mount (already destroyed)
      if (ok) setSession(s);
      else useGame.getState().set({ phase: 'failed' });
      reveal();
    });
    return () => {
      live = false;
      s.destroy();
    };
  }, []);

  return (
    <div className="game" data-phase={phase}>
      <div ref={host} className="game-canvas" />
      {phase === 'failed' && (
        <div className="game-screen">
          <div className="game-dialog" role="alert">
            <p>{t('game.failed')}</p>
            <a className="btn btn-primary" href={HOME}>
              {t('game.back')}
            </a>
          </div>
        </div>
      )}
      {session && phase === 'briefing' && <MainMenu session={session} />}
      {session && phase === 'loading' && (
        <div className="game-veil" role="status">
          {t('game.loadingMission')}
        </div>
      )}
      {session && ['playing', 'paused', 'card', 'inventory', 'chapter'].includes(phase) && (
        <Hud session={session} />
      )}
      {session && phase === 'playing' && <FindingPanel />}
      {session && ['playing', 'chapter', 'card', 'panorama'].includes(phase) && <Toasts />}
      {session && phase === 'chapter' && <ChapterPage session={session} />}
      {session && phase === 'paused' && <PauseMenu session={session} />}
      {session && phase === 'card' && <SampleCard session={session} />}
      {session && phase === 'inventory' && <Inventory session={session} />}
      {session && phase === 'panorama' && <PanoramaPhase session={session} />}
      {session && phase === 'complete' && <Complete session={session} />}
      {session && phase === 'photo' && <PhotoMode session={session} />}
    </div>
  );
}

// ---------- main menu ----------

function LanguageSwitch() {
  const { i18n } = useTranslation();
  return (
    <div className="game-lang" role="group" aria-label="Language">
      {LANGUAGES.map((l) => (
        <button
          key={l}
          type="button"
          className={`btn btn-icon ${i18n.language === l ? 'is-on' : ''}`}
          aria-pressed={i18n.language === l}
          onClick={() => void i18n.changeLanguage(l)}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

/** Graphics quality (renderer settings are fixed at start, so a change reloads the page). */
function QualitySelect() {
  const { t } = useTranslation();
  const [q] = useState<Quality>(readQuality);
  return (
    <select
      id="game-quality"
      value={q}
      onChange={(e) => {
        writeQuality(e.target.value as Quality);
        window.location.reload();
      }}
    >
      {(['high', 'medium', 'low'] as const).map((v) => (
        <option key={v} value={v}>
          {t(`game.quality.${v}`)}
        </option>
      ))}
    </select>
  );
}

function SoundToggle({ session }: { session: GameSession }) {
  const { t } = useTranslation();
  const [muted, setMuted] = useState(session.audio.muted);
  return (
    <button
      type="button"
      className="btn btn-icon"
      aria-pressed={!muted}
      onClick={() => {
        session.audio.setMuted(!muted);
        setMuted(!muted);
      }}
    >
      {muted ? t('game.sound.off') : t('game.sound.on')}
    </button>
  );
}

const TABS = ['expedition', 'collection', 'photos', 'options', 'how'] as const;
type Tab = (typeof TABS)[number];

function MainMenu({ session }: { session: GameSession }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('expedition');
  const [career, setCareer] = useState<Career>(readCareer);
  return (
    <div className="game-screen">
      <section className="game-dialog game-briefing" aria-labelledby="game-title">
        <header className="game-briefing-head">
          <a className="btn btn-ghost" href={HOME}>
            ← {t('game.back')}
          </a>
          <div className="game-briefing-tools">
            <button type="button" className="btn btn-icon" onClick={() => session.enterPhoto()}>
              {t('game.photo.open')}
            </button>
            <LanguageSwitch />
          </div>
        </header>
        <h1 id="game-title">{t('game.title')}</h1>
        <p className="lede">{t('game.tagline')}</p>
        <div className="game-tabs" role="tablist" aria-label={t('game.menu.label')}>
          {TABS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              id={`game-tab-${k}`}
              aria-selected={tab === k}
              aria-controls={`game-panel-${k}`}
              className={tab === k ? 'is-on' : ''}
              onClick={() => setTab(k)}
            >
              {t(`game.menu.${k}`)}
            </button>
          ))}
        </div>
        <div
          className="game-tabpanel"
          role="tabpanel"
          id={`game-panel-${tab}`}
          aria-labelledby={`game-tab-${tab}`}
        >
          {tab === 'expedition' && <ExpeditionTab session={session} />}
          {tab === 'collection' && <Collection session={session} career={career} />}
          {tab === 'photos' && <Gallery />}
          {tab === 'options' && (
            <Options session={session} onReset={() => setCareer(readCareer())} />
          )}
          {tab === 'how' && <HowToPlay />}
        </div>
      </section>
    </div>
  );
}

/** Continue the saved expedition, or start a new one; the four chapters at a glance. */
function ExpeditionTab({ session }: { session: GameSession }) {
  const { t } = useTranslation();
  const hasSave = useGame((s) => s.hasSave);
  const exp = useGame((s) => s.expedition);
  const [confirm, setConfirm] = useState(false);
  const best = readBest();
  return (
    <div className="game-expedition">
      <p>{t('game.expedition.intro')}</p>
      <ol className="game-chapter-list">
        {CHAPTERS.map((c, i) => (
          <li key={c.id} className={hasSave && i < exp.chapter ? 'is-done' : ''}>
            <span className="game-chapter-n">{i + 1}</span>
            <div>
              <strong>{t(`game.chapters.${c.id}.title`)}</strong>
              <span className="meta">
                {t('game.chapter.sols', { first: c.sols[0], last: c.sols[1] })}
              </span>
            </div>
          </li>
        ))}
      </ol>
      <div className="btn-row">
        {hasSave && (
          <button
            type="button"
            className="btn btn-primary"
            autoFocus
            onClick={() => session.continueExpedition()}
          >
            {t('game.expedition.continue', { chapter: exp.chapter + 1 })}
          </button>
        )}
        {hasSave && !confirm ? (
          <button type="button" className="btn" onClick={() => setConfirm(true)}>
            {t('game.expedition.new')}
          </button>
        ) : (
          <button
            type="button"
            className={hasSave ? 'btn' : 'btn btn-primary'}
            autoFocus={!hasSave}
            onClick={() => session.newExpedition()}
          >
            {hasSave ? t('game.expedition.newConfirm') : t('game.expedition.start')}
          </button>
        )}
      </div>
      <p className="meta">
        {t('game.expedition.meta')}
        {best !== null && <> · {t('game.best', { time: formatClock(best) })}</>}
      </p>
    </div>
  );
}

/** Samples ever cored on this map, and the rock types found with the laser. */
function Collection({ session, career }: { session: GameSession; career: Career }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === 'es' ? 'es' : 'en';
  const all = session.places.filter((x) => x.kind === 'sample');
  const got = all.filter((x) => career.samples.includes(x.id)).length;
  const types = ROCK_TYPES.filter((r) => career.rocks[r]).length;
  return (
    <div className="game-collection">
      <dl className="game-stats game-stats-3">
        <div>
          <dt>{t('game.collection.samples')}</dt>
          <dd>
            {got}/{all.length}
          </dd>
        </div>
        <div>
          <dt>{t('game.collection.rockTypes')}</dt>
          <dd>
            {types}/{ROCK_TYPES.length}
          </dd>
        </div>
        <div>
          <dt>{t('game.collection.science')}</dt>
          <dd>{career.science}</dd>
        </div>
      </dl>
      <ul className="game-samples">
        {all.map((x) => {
          const site = x.site!;
          const have = career.samples.includes(x.id);
          const photo = have ? samplePhotos(site.sampleNumber)[0] : undefined;
          const numbers: string[] = site.sampleNumber.match(/\d+/g) ?? [];
          const poi = POIS.find((p) => p.sampleNumbers.some((n) => numbers.includes(n)));
          return (
            <li key={x.id} className={have ? 'is-have' : 'is-locked'}>
              <details>
                <summary>
                  <span className="game-sample-thumb" aria-hidden="true">
                    {photo ? (
                      <img src={dataUrl(`${photo.thumb ?? photo.file}?v=${DATA_VERSION}`)} alt="" />
                    ) : (
                      <span>{have ? '✓' : '?'}</span>
                    )}
                  </span>
                  <span>
                    <strong>{have ? site.name : t('game.collection.unknown')}</strong>
                    <span className="meta">
                      {t(numbers.length > 1 ? 'game.card.numbers' : 'game.card.number', {
                        number: site.sampleNumber,
                      })}
                      {have && <> · {t('game.collection.sol', { sol: site.sol })}</>}
                    </span>
                  </span>
                </summary>
                {have ? (
                  <div className="game-sample-more">
                    <p className="meta">
                      {t('game.card.at', { outcrop: site.outcrop, location: site.location })}
                    </p>
                    <p>{t(`game.card.why.${whyKey(site)}`)}</p>
                    {poi && <p>{poi.why[lang]}</p>}
                  </div>
                ) : (
                  <p className="meta game-sample-more">{t('game.collection.locked')}</p>
                )}
              </details>
            </li>
          );
        })}
      </ul>
      <h2>{t('game.collection.rocksTitle')}</h2>
      <p className="meta">{t('game.collection.rocksIntro')}</p>
      <ul className="game-rocks">
        {ROCK_TYPES.map((r) => {
          const n = career.rocks[r] ?? 0;
          return (
            <li key={r} className={n ? 'is-have' : 'is-locked'}>
              <strong>{n ? t(`game.rocks.${r}.name`) : t('game.collection.unknown')}</strong>
              <span className="meta">
                {n
                  ? `${t('game.collection.analysed', { count: n })} · ${mainElements(r).join(' ')}`
                  : t(`game.rocks.${r}.hint`)}
              </span>
              {n > 0 && <p>{t(`game.rocks.${r}.desc`)}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Photos taken in photo mode (kept in this browser). */
function Gallery() {
  const { t } = useTranslation();
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [open, setOpen] = useState<Photo | null>(null);
  useEffect(() => {
    let live = true;
    void listPhotos().then((list) => {
      if (!live) return;
      setPhotos(list);
      setUrls(new Map(list.map((p) => [p.id, URL.createObjectURL(p.blob)])));
    });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  if (!photos) return <p className="meta">{t('game.gallery.loading')}</p>;
  if (!photos.length) return <p className="meta">{t('game.gallery.empty')}</p>;
  const remove = async (p: Photo) => {
    await deletePhoto(p.id);
    setOpen(null);
    setPhotos(photos.filter((x) => x.id !== p.id));
  };
  return (
    <div className="game-gallery">
      {open ? (
        <figure className="game-gallery-view">
          <img src={urls.get(open.id)} alt={t('game.gallery.photo')} />
          <figcaption>
            {new Date(open.createdMs).toLocaleString()} · {t(`game.photo.filters.${open.filter}`)}
          </figcaption>
          <div className="game-gallery-actions">
            <button type="button" className="btn" onClick={() => setOpen(null)}>
              ← {t('game.gallery.back')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => downloadBlob(open.blob, photoFileName(open.createdMs))}
            >
              {t('game.gallery.download')}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => void remove(open)}>
              {t('game.gallery.delete')}
            </button>
          </div>
        </figure>
      ) : (
        <ul className="game-gallery-grid">
          {photos.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => setOpen(p)} aria-label={t('game.gallery.photo')}>
                <img src={urls.get(p.id)} alt="" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Options({ session, onReset }: { session: GameSession; onReset: () => void }) {
  const { t } = useTranslation();
  const [o, setO] = useState(session.options);
  const [confirm, setConfirm] = useState(false);
  const set = (patch: Partial<typeof o>) => {
    const next = { ...o, ...patch };
    setO(next);
    session.setOptions(next);
  };
  return (
    <div className="game-options">
      <div className="game-option">
        <label htmlFor="game-quality">{t('game.quality.title')}</label>
        <QualitySelect />
      </div>
      <div className="game-option">
        <span>{t('game.options.sound')}</span>
        <SoundToggle session={session} />
      </div>
      <div className="game-option">
        <span>{t('game.options.language')}</span>
        <LanguageSwitch />
      </div>
      <label className="game-option">
        <span>
          {t('game.options.hazards')}
          <small>{t('game.options.hazardsHelp')}</small>
        </span>
        <input
          type="checkbox"
          checked={o.hazards}
          onChange={(e) => set({ hazards: e.target.checked })}
        />
      </label>
      <label className="game-option">
        <span>
          {t('game.options.storms')}
          <small>{t('game.options.stormsHelp')}</small>
        </span>
        <input
          type="checkbox"
          checked={o.storms}
          onChange={(e) => set({ storms: e.target.checked })}
        />
      </label>
      <div className="game-option">
        <span>
          {t('game.options.reset')}
          <small>{t('game.options.resetHelp')}</small>
        </span>
        {confirm ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              resetProgress();
              setConfirm(false);
              useGame.getState().set({ hasSave: false });
              onReset();
            }}
          >
            {t('game.options.resetConfirm')}
          </button>
        ) : (
          <button type="button" className="btn" onClick={() => setConfirm(true)}>
            {t('game.options.resetButton')}
          </button>
        )}
      </div>
    </div>
  );
}

function HowToPlay() {
  const { t } = useTranslation();
  return (
    <>
      <ul className="game-how">
        {(
          [
            'drive',
            'core',
            'pano',
            'laser',
            'autonav',
            'warp',
            'inventory',
            'photo',
            'slope',
            'power',
            'keys',
          ] as const
        ).map((k) => (
          <li key={k}>{t(`game.how.${k}`)}</li>
        ))}
      </ul>
      <h2>{t('game.how.hazardsTitle')}</h2>
      <ul className="game-how">
        {(['sand', 'rocks', 'tilt', 'storm'] as const).map((k) => (
          <li key={k}>{t(`game.how.hazards.${k}`)}</li>
        ))}
      </ul>
      <p className="meta">{t('game.realNote')}</p>
    </>
  );
}

// ---------- chapter page ----------

function ChapterPage({ session }: { session: GameSession }) {
  const { t } = useTranslation();
  const exp = useGame((s) => s.expedition);
  const c = CHAPTERS[exp.chapter]!;
  return (
    <div className="game-screen">
      <div
        className="game-dialog game-chapter"
        role="dialog"
        aria-modal="true"
        aria-labelledby="game-chapter-title"
      >
        <div className="game-panel-title">
          {t('game.chapter.kicker', { n: exp.chapter + 1, first: c.sols[0], last: c.sols[1] })}
        </div>
        <h2 id="game-chapter-title">{t(`game.chapters.${c.id}.title`)}</h2>
        <p>{t(`game.chapters.${c.id}.story`)}</p>
        <ul className="game-chapter-goals">
          {c.objectives.map((o) => (
            <li key={o.id} className={o.optional ? 'is-optional' : ''}>
              <span aria-hidden="true">{o.optional ? '◇' : '○'}</span>{' '}
              {t(`game.objectives.${o.id}`)}
              {o.optional && <em> · {t('game.objectives.optional')}</em>}
            </li>
          ))}
        </ul>
        <p className="meta">{t('game.chapter.tip')}</p>
        <button
          type="button"
          className="btn btn-primary"
          autoFocus
          onClick={() => session.resume()}
        >
          {exp.chapter === 0 && exp.reached.length === 0
            ? t('game.chapter.begin')
            : t('game.chapter.continue')}
        </button>
      </div>
    </div>
  );
}

// ---------- HUD ----------

function Objectives() {
  const { t } = useTranslation();
  const exp = useGame((s) => s.expedition);
  const storm = useGame((s) => s.hud.storm);
  const c = CHAPTERS[exp.chapter];
  if (!c) return null;
  return (
    <section className="game-panel game-objectives" aria-label={t('game.hud.objectives')}>
      <div className="game-panel-title">
        {t('game.chapter.short', { n: exp.chapter + 1 })} · {t(`game.chapters.${c.id}.title`)}
      </div>
      <ol>
        {c.objectives.map((o) => {
          const done = objectiveDone(exp, o, c);
          const count = objectiveCount(exp, o, c);
          return (
            <li
              key={o.id}
              className={`${done ? 'is-done' : ''} ${o.optional ? 'is-optional' : ''}`}
            >
              <span aria-hidden="true">{done ? '✓' : o.optional ? '◇' : '○'}</span>{' '}
              {t(`game.objectives.${o.id}`)}
              {count && count[1] > 1 && !done && ` ${count[0]}/${count[1]}`}
            </li>
          );
        })}
      </ol>
      {storm && (
        <p className={`game-storm ${storm === 'active' ? 'is-active' : ''}`}>
          {t(storm === 'active' ? 'game.hud.storm' : 'game.hud.stormSoon')}
        </p>
      )}
    </section>
  );
}

function Hud({ session }: { session: GameSession }) {
  const { t, i18n } = useTranslation();
  const hud = useGame((s) => s.hud);
  const camera = useGame((s) => s.camera);
  const mapOpen = useGame((s) => s.mapOpen);
  const exp = useGame((s) => s.expedition);
  const phase = useGame((s) => s.phase);
  const lang = i18n.language;

  return (
    <div className="game-hud">
      <Objectives />

      {hud.next && (
        <div className="game-compass" aria-live="off">
          <svg
            viewBox="0 0 40 40"
            aria-hidden="true"
            style={{ transform: `rotate(${hud.next.relDeg}deg)` }}
          >
            <path d="M20 4 L31 30 L20 24 L9 30 Z" />
          </svg>
          <span>
            <strong>{hud.next.name}</strong>
            {formatDistance(hud.next.distanceM, lang)}
          </span>
        </div>
      )}

      {hud.autonav && (
        <div className="game-panel game-autonav" role="status">
          <span className="game-autonav-dot" aria-hidden="true" />
          <span>
            {t(
              hud.autonav.state === 'recovering'
                ? 'game.autonav.recovering'
                : 'game.autonav.driving',
              {
                name: hud.autonav.goal || t('game.autonav.point'),
                distance: formatDistance(hud.autonav.distanceM, lang),
              },
            )}
          </span>
          <button type="button" className="btn btn-icon" onClick={() => session.cycleWarp()}>
            ×{hud.warp}
          </button>
          <button type="button" className="btn btn-icon" onClick={() => session.stopAutoNav()}>
            {t('game.autonav.stop')}
          </button>
        </div>
      )}
      {!hud.autonav && hud.warp > 1 && (
        <div className="game-panel game-autonav" role="status">
          <span>{t('game.warp.on', { warp: hud.warp })}</span>
          <button type="button" className="btn btn-icon" onClick={() => session.cycleWarp()}>
            ×{hud.warp}
          </button>
        </div>
      )}

      <section className="game-panel game-gauges" aria-label={t('game.hud.battery')}>
        <div className={`game-battery ${hud.batteryPct < 20 ? 'is-low' : ''}`}>
          <span>{t('game.hud.battery')}</span>
          <div
            className="game-bar"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(hud.batteryPct)}
            aria-label={t('game.hud.battery')}
          >
            <div style={{ width: `${hud.batteryPct}%` }} />
          </div>
          <strong>{Math.round(hud.batteryPct)}%</strong>
        </div>
        <div
          className={`game-battery game-wheels ${hud.wheelsPct < 50 ? 'is-low' : ''} ${hud.wearing ? 'is-hit' : ''}`}
        >
          <span>{t('game.hud.wheels')}</span>
          <div
            className="game-bar"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(hud.wheelsPct)}
            aria-label={t('game.hud.wheels')}
          >
            <div style={{ width: `${hud.wheelsPct}%` }} />
          </div>
          <strong>{Math.round(hud.wheelsPct)}%</strong>
        </div>
        <dl>
          <div>
            <dt>{t('game.hud.speed')}</dt>
            <dd className={hud.boosting ? 'is-boost' : ''}>
              {Math.abs(hud.speedMps).toFixed(1)} m/s
            </dd>
          </div>
          <div>
            <dt>{t('game.hud.tilt')}</dt>
            <dd className={hud.tiltDeg >= DRIVE.tiltWarnDeg ? 'is-warn' : ''}>
              {formatDegrees(hud.tiltDeg, lang)}
            </dd>
          </div>
          <div>
            <dt>{t('game.hud.time')}</dt>
            <dd>{formatClock(hud.elapsedS)}</dd>
          </div>
          <div>
            <dt>{t('game.hud.driven')}</dt>
            <dd>{formatDistance(hud.odometerM, lang)}</dd>
          </div>
          <div>
            <dt>{t('game.hud.slip')}</dt>
            <dd className={hud.slip > 0.3 ? 'is-warn' : ''}>{Math.round(hud.slip * 100)}%</dd>
          </div>
          <div>
            <dt>{t('game.hud.science')}</dt>
            <dd>{exp.science}</dd>
          </div>
        </dl>
        <div className="game-tools">
          <button
            type="button"
            className={`btn btn-icon ${hud.autonav ? 'is-on' : ''}`}
            aria-pressed={!!hud.autonav}
            onClick={() => (hud.autonav ? session.stopAutoNav() : session.startAutoNav())}
          >
            {t('game.hud.autonav')}
          </button>
          <button
            type="button"
            className="btn btn-icon"
            disabled={hud.laserTarget !== 'ready' || !!hud.laser}
            onClick={() => session.fireLaser()}
          >
            {t('game.hud.laser')}
          </button>
          <button type="button" className="btn btn-icon" onClick={() => session.openInventory()}>
            {t('game.hud.inventory')}
          </button>
          <button type="button" className="btn btn-icon" onClick={() => session.enterPhoto()}>
            {t('game.hud.photo')}
          </button>
          <button type="button" className="btn btn-icon" onClick={() => session.cycleCamera()}>
            {t('game.hud.camera')}: {t(`game.hud.cameraModes.${camera}`)}
          </button>
          <button
            type="button"
            className="btn btn-icon"
            aria-pressed={mapOpen}
            onClick={() => useGame.getState().set({ mapOpen: !mapOpen })}
          >
            {t('game.hud.map')}
          </button>
          <button type="button" className="btn btn-icon" onClick={() => session.pause()}>
            {t('game.hud.pause')}
          </button>
          <SoundToggle session={session} />
        </div>
      </section>

      {phase === 'playing' && <Prompt />}
      {mapOpen && <GameMap session={session} />}
      <TouchPad session={session} />
    </div>
  );
}

function Prompt() {
  const { t } = useTranslation();
  const hud = useGame((s) => s.hud);
  let text: string | null = null;
  let tone = '';
  const { here, action } = hud;
  const fraction = action?.fraction ?? hud.laser?.fraction ?? null;
  if (action && here) {
    text =
      action.kind === 'core'
        ? t('game.prompt.coring', { name: here.name })
        : action.kind === 'panorama'
          ? t('game.prompt.shooting', { name: here.name })
          : t('game.prompt.dropping');
  } else if (hud.laser) {
    text = t('game.prompt.lasering');
  } else if (hud.stuck) {
    text = t('game.prompt.stuck');
    tone = 'is-warn';
  } else if (hud.blocked === 'power' || hud.recharging) {
    text = t('game.prompt.power');
    tone = 'is-warn';
  } else if (hud.blocked === 'steep' && !hud.autonav) {
    text = t('game.prompt.steep');
    tone = 'is-warn';
  } else if (hud.blocked === 'rock' && !hud.autonav) {
    text = t('game.prompt.boulder');
    tone = 'is-warn';
  } else if (hud.blocked === 'tilt' && !hud.autonav) {
    text = t('game.prompt.tiltBlocked');
    tone = 'is-warn';
  } else if (hud.blocked === 'edge') {
    text = t('game.prompt.edge');
    tone = 'is-warn';
  } else if (hud.storm === 'warning') {
    text = t('game.prompt.stormSoon');
    tone = 'is-warn';
  } else if (hud.wearing) {
    text = t('game.prompt.rocks', { pct: Math.round(hud.wheelsPct) });
    tone = 'is-warn';
  } else if (hud.slip > 0.3 && Math.abs(hud.speedMps) > 0.3) {
    text = t('game.prompt.sand', { pct: Math.round(hud.slip * 100) });
    tone = 'is-warn';
  } else if (here) {
    const key = here.kind === 'depot' ? 'Drop' : here.kind === 'panorama' ? 'Pano' : 'Core';
    text = t(`game.prompt.${here.stopped ? 'hold' : 'stop'}To${key}`, { name: here.name });
    tone = 'is-go';
  } else if (hud.ingenuity?.flying && hud.ingenuity.distanceM < 250) {
    text = t('game.prompt.heliFlying');
  } else if (hud.ingenuity?.ready && hud.ingenuity.distanceM < 200) {
    text = t('game.prompt.heli', { distance: Math.round(hud.ingenuity.distanceM) });
  } else if (hud.laserTarget === 'ready') {
    text = t('game.prompt.laserReady');
  } else if (hud.laserTarget === 'done') {
    text = t('game.prompt.laserDone');
  } else if (hud.tiltDeg >= DRIVE.tiltWarnDeg) {
    text = t('game.prompt.tilt', { deg: `${Math.round(hud.tiltDeg)}°` });
    tone = 'is-warn';
  } else if (hud.storm === 'active') {
    text = t('game.prompt.storm');
  } else if (hud.next?.kind === 'depot') {
    text = t('game.prompt.toDepot');
  } else if (hud.next && !hud.autonav && hud.next.distanceM > 60) {
    text = t('game.prompt.autonavHint');
  }
  return (
    <div className={`game-prompt ${tone}`} role="status" aria-live="polite">
      {text && <span>{text}</span>}
      {fraction !== null && (action || hud.laser) && (
        <div className="game-bar game-action-bar" aria-hidden="true">
          <div style={{ width: `${fraction * 100}%` }} />
        </div>
      )}
    </div>
  );
}

/** Notices (a place reached, Ingenuity flying, tubes left…), a few seconds each. */
function Toasts() {
  const { t } = useTranslation();
  const toast = useGame((s) => s.toast);
  const [shown, setShown] = useState(toast);
  useEffect(() => {
    if (!toast) return;
    setShown(toast);
    const id = window.setTimeout(() => setShown(null), 5200);
    return () => window.clearTimeout(id);
  }, [toast]);
  if (!shown) return null;
  return (
    <div className="game-toast" role="status" aria-live="polite" key={shown.id}>
      {t(shown.key, shown.params ?? {})}
    </div>
  );
}

// ---------- SuperCam read-out ----------

/** The result of the last laser analysis, for a few seconds. */
function FindingPanel() {
  const { t } = useTranslation();
  const finding = useGame((s) => s.finding);
  useEffect(() => {
    if (!finding) return;
    const id = window.setTimeout(() => useGame.getState().set({ finding: null }), 11000);
    return () => window.clearTimeout(id);
  }, [finding]);
  if (!finding) return null;
  return (
    <section className="game-panel game-finding" role="status" aria-live="polite">
      <div className="game-panel-title">
        {t('game.finding.title')} · +{finding.points} {t('game.finding.points')}
        {finding.first && <span className="game-finding-new"> · {t('game.finding.new')}</span>}
      </div>
      <h3>{t(`game.rocks.${finding.type}.name`)}</h3>
      <Spectrum type={finding.type} seed={finding.key} />
      <p>{t(`game.rocks.${finding.type}.desc`)}</p>
      <p className="meta">
        {t('game.finding.elements', { list: mainElements(finding.type).join(', ') })} ·{' '}
        {t('game.finding.base', { points: POINTS[finding.type] })}
      </p>
      <button
        type="button"
        className="btn btn-icon"
        onClick={() => useGame.getState().set({ finding: null })}
      >
        {t('game.finding.close')}
      </button>
    </section>
  );
}

// ---------- photo mode ----------

function PhotoMode({ session }: { session: GameSession }) {
  const { t, i18n } = useTranslation();
  const filter = useGame((s) => s.photoFilter);
  const exp = useGame((s) => s.expedition);
  const [saved, setSaved] = useState<{ blob: Blob; name: string; kept: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const chapter = CHAPTERS[exp.chapter];
  const place = chapter ? t(`game.chapters.${chapter.id}.title`) : t('game.title');
  const caption = `Perseverance · Jezero · ${place} · ${new Date().toLocaleDateString(i18n.language)} · Copernico`;
  return (
    <div className="game-photo" role="dialog" aria-label={t('game.photo.title')}>
      <div className="game-panel game-photo-bar">
        <div className="game-panel-title">{t('game.photo.title')}</div>
        <div className="game-photo-filters" role="radiogroup" aria-label={t('game.photo.filter')}>
          {PHOTO_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={filter === f}
              className={`btn btn-icon ${filter === f ? 'is-on' : ''}`}
              onClick={() => session.setPhotoFilter(f)}
            >
              {t(`game.photo.filters.${f}`)}
            </button>
          ))}
        </div>
        <p className="meta">{t(`game.photo.about.${filter}`)}</p>
        <div className="game-photo-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void session.takePhoto(caption).then((r) => {
                setBusy(false);
                setSaved(r);
              });
            }}
          >
            {t('game.photo.take')}
          </button>
          <button type="button" className="btn" onClick={() => session.exitPhoto()}>
            {t('game.photo.exit')}
          </button>
        </div>
        <p className="meta">{t('game.photo.hint')}</p>
        {saved && (
          <p className="game-photo-saved" role="status">
            {saved.kept ? t('game.photo.saved') : t('game.photo.notKept')}{' '}
            <button
              type="button"
              className="btn btn-icon"
              onClick={() => downloadBlob(saved.blob, saved.name)}
            >
              {t('game.gallery.download')}
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

// ---------- map ----------

const MAP_W = 300;
const MAP_H = 210;
const MAP_SCALE_LARGE = 2.4;

/** Local metres of a position from the map centre (x east, y north). */
const toMap = (lat0: number, lon0: number, lat: number, lon: number): [number, number] => [
  (lon - lon0) * Math.cos((lat0 * Math.PI) / 180) * M_PER_DEG,
  (lat - lat0) * M_PER_DEG,
];

/**
 * The map: the 0.5 m HiRISE image of the area (the game's own), Perseverance's real route, the
 * places open now and those done, Ingenuity, AutoNav's path and the rover. Click to send AutoNav.
 * Re-rendered only when progress changes, not with every HUD update.
 */
const GameMap = memo(function GameMap({ session }: { session: GameSession }) {
  const { t, i18n } = useTranslation();
  const targets = useGame((s) => s.targets);
  const exp = useGame((s) => s.expedition);
  const route = useGame((s) => s.route);
  const [large, setLarge] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const roverRef = useRef<SVGGElement>(null);
  const heliRef = useRef<SVGGElement>(null);
  const k = large ? MAP_SCALE_LARGE : 1;
  const W = MAP_W * k;
  const H = MAP_H * k;

  // Extent: every place of the map, the start and the airfields, with a margin.
  const pts = [...session.places, START, ...FLIGHTS];
  const lats = pts.map((p) => p.lat);
  const lons = pts.map((p) => p.lon);
  const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2;
  const lon0 = (Math.min(...lons) + Math.max(...lons)) / 2;
  const spanX =
    (Math.max(...lons) - Math.min(...lons)) * Math.cos((lat0 * Math.PI) / 180) * M_PER_DEG + 160;
  const spanY = (Math.max(...lats) - Math.min(...lats)) * M_PER_DEG + 160;
  const mPerPx = Math.max(spanX / W, spanY / H);
  const px = (lat: number, lon: number): [number, number] => {
    const [x, y] = toMap(lat0, lon0, lat, lon);
    return [W / 2 + x / mPerPx, H / 2 - y / mPerPx];
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const area = session.world.frame;
    const base = session.mapImage;
    if (!canvas || !area || !base) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let live = true;
    const img = new Image();
    img.src = dataUrl(`${base.file}?v=${DATA_VERSION}`);
    void img.decode().then(
      () => {
        if (!live) return;
        // The image covers the area's detail layer, centred on the area.
        const cell = base.cellM;
        const [cx, cy] = toMap(lat0, lon0, area.lat0, area.lon0);
        const ox = img.width / 2 + (-cx - (W / 2) * mPerPx) / cell;
        const oy = img.height / 2 - (-cy + (H / 2) * mPerPx) / cell;
        ctx.drawImage(img, ox, oy, (W * mPerPx) / cell, (H * mPerPx) / cell, 0, 0, W, H);
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = 'rgb(214, 150, 104)';
        ctx.fillRect(0, 0, W, H);
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
        ctx.fillRect(0, 0, W, H);
      },
      () => {},
    );
    return () => {
      live = false;
    };
    // The image depends only on the map's size.
  }, [W, H, mPerPx, lat0, lon0, session]);

  // The rover and Ingenuity follow every animation frame (not through React).
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const p = session.roverPose;
      const [x, y] = px(p.lat, p.lon);
      roverRef.current?.setAttribute(
        'transform',
        `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${((p.headingRad * 180) / Math.PI).toFixed(1)})`,
      );
      const h = session.ingenuityPose;
      if (heliRef.current) {
        heliRef.current.style.display = h ? '' : 'none';
        if (h) {
          const [hx, hy] = px(h.lat, h.lon);
          heliRef.current.setAttribute('transform', `translate(${hx.toFixed(1)} ${hy.toFixed(1)})`);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  });

  const onClick = (e: ReactPointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * W;
    const sy = ((e.clientY - r.top) / r.height) * H;
    // A place under the pointer is the goal; otherwise the point itself.
    const hit = targets.find((x) => {
      const [cx, cy] = px(x.lat, x.lon);
      return Math.hypot(cx - sx, cy - sy) < 9;
    });
    const mx = (sx - W / 2) * mPerPx;
    const my = (H / 2 - sy) * mPerPx;
    const lat = lat0 + my / M_PER_DEG;
    const lon = lon0 + mx / (Math.cos((lat0 * Math.PI) / 180) * M_PER_DEG);
    session.startAutoNav(hit ?? { lat, lon });
  };

  const done = session.places.filter((x) => isDone(exp, x));
  const scaleM = mPerPx * W > 900 ? 200 : 100;
  const routePts = (list: Array<[number, number]>) =>
    list
      .map(([la, lo]) =>
        px(la, lo)
          .map((v) => v.toFixed(1))
          .join(','),
      )
      .join(' ');
  const glyph = (x: Target, cx: number, cy: number, cls: string) =>
    x.kind === 'depot' ? (
      <rect
        key={`${cls}-${x.id}`}
        x={cx - 5}
        y={cy - 5}
        width="10"
        height="10"
        transform={`rotate(45 ${cx} ${cy})`}
        className={`game-map-depot ${cls}`}
      />
    ) : x.kind === 'panorama' ? (
      <g key={`${cls}-${x.id}`} className={`game-map-pano ${cls}`}>
        <circle cx={cx} cy={cy} r="6" />
        {!cls.includes('is-done') && (
          <text x={cx} y={cy + 3.5} textAnchor="middle">
            ?
          </text>
        )}
      </g>
    ) : (
      <circle
        key={`${cls}-${x.id}`}
        cx={cx}
        cy={cy}
        r="5"
        className={`game-map-target is-${x.kind} ${cls}`}
      />
    );
  return (
    <div className={`game-map ${large ? 'is-large' : ''}`}>
      <canvas ref={canvasRef} style={{ width: W, height: H }} aria-hidden="true" />
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: W, height: H }}
        role="img"
        aria-label={t('game.map.label')}
        onPointerDown={onClick}
      >
        <polyline points={routePts(session.realRoute)} className="game-map-real" />
        {route && <polyline points={routePts(route)} className="game-map-route" />}
        {done.map((x) => {
          const [cx, cy] = px(x.lat, x.lon);
          return glyph(x, cx, cy, 'is-done');
        })}
        {targets.map((x) => {
          const [cx, cy] = px(x.lat, x.lon);
          return glyph(x, cx, cy, '');
        })}
        <g ref={heliRef} className="game-map-heli">
          <path d="M-5 -5 L5 5 M5 -5 L-5 5" />
          <circle r="1.6" />
        </g>
        <g ref={roverRef}>
          <path d="M0 -8 L6 6 L0 3 L-6 6 Z" className="game-map-rover" />
        </g>
        <text x={W / 2} y="14" textAnchor="middle" className="game-map-n">
          N
        </text>
        <g className="game-map-scale">
          <line x1="10" x2={10 + scaleM / mPerPx} y1={H - 10} y2={H - 10} />
          <text x="10" y={H - 15}>
            {formatDistance(scaleM, i18n.language)}
          </text>
        </g>
      </svg>
      <div className="game-map-bar">
        <span className="meta">{t('game.map.hint')}</span>
        <button type="button" className="btn btn-icon" onClick={() => setLarge(!large)}>
          {large ? t('game.map.smaller') : t('game.map.larger')}
        </button>
      </div>
    </div>
  );
});

// ---------- touch pad ----------

function TouchPad({ session }: { session: GameSession }) {
  const { t } = useTranslation();
  const [coarse] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches,
  );
  // Gone (a dialog, photo mode): nothing stays held.
  useEffect(() => () => session.controls.clear(), [session]);
  if (!coarse) return null;
  type Pad = Parameters<GameSession['controls']['pad']>[1];
  const hold = (button: NonNullable<Pad>) => {
    const release = (e: ReactPointerEvent) => session.controls.pad(e.pointerId, null);
    return {
      onPointerDown: (e: ReactPointerEvent) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        session.controls.pad(e.pointerId, button);
      },
      onPointerUp: release,
      onPointerCancel: release,
      onLostPointerCapture: release,
      onContextMenu: (e: { preventDefault(): void }) => e.preventDefault(),
    };
  };
  return (
    <div className="game-touch">
      <div className="game-touch-steer">
        <button type="button" aria-label={t('game.touch.left')} {...hold('left')}>
          ◀
        </button>
        <button type="button" aria-label={t('game.touch.right')} {...hold('right')}>
          ▶
        </button>
      </div>
      <div className="game-touch-drive">
        <button
          type="button"
          aria-label={t('game.touch.laser')}
          onPointerDown={() => session.fireLaser()}
        >
          ✶
        </button>
        <button
          type="button"
          aria-label={t('game.touch.core')}
          className="is-action"
          {...hold('core')}
        >
          ⦿
        </button>
        <button type="button" aria-label={t('game.touch.boost')} {...hold('boost')}>
          »
        </button>
        <button type="button" aria-label={t('game.touch.forward')} {...hold('forward')}>
          ▲
        </button>
        <button type="button" aria-label={t('game.touch.back')} {...hold('back')}>
          ▼
        </button>
      </div>
    </div>
  );
}

// ---------- dialogs ----------

function PauseMenu({ session }: { session: GameSession }) {
  const { t } = useTranslation();
  return (
    <div className="game-screen">
      <div
        className="game-dialog game-small"
        role="dialog"
        aria-modal="true"
        aria-labelledby="game-pause"
      >
        <h2 id="game-pause">{t('game.pause.title')}</h2>
        <div className="btn-stack">
          <button
            type="button"
            className="btn btn-primary"
            autoFocus
            onClick={() => session.resume()}
          >
            {t('game.pause.resume')}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              session.resume();
              session.openInventory();
            }}
          >
            {t('game.pause.inventory')}
          </button>
          <button type="button" className="btn" onClick={() => session.quit()}>
            {t('game.pause.menu')}
          </button>
          <a className="btn btn-ghost" href={HOME}>
            {t('game.back')}
          </a>
        </div>
        <p className="meta">{t('game.pause.saved')}</p>
      </div>
    </div>
  );
}

function SampleCard({ session }: { session: GameSession }) {
  const { t, i18n } = useTranslation();
  const card = useGame((s) => s.card);
  const site = card?.site;
  if (!card || !site) return null;
  const photo = samplePhotos(site.sampleNumber)[0];
  const numbers: string[] = site.sampleNumber.match(/\d+/g) ?? [];
  const poi = POIS.find((p) => p.sampleNumbers.some((n) => numbers.includes(n)));
  const lang = i18n.language === 'es' ? 'es' : 'en';
  return (
    <div className="game-screen">
      <div
        className="game-dialog game-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="game-card-title"
      >
        {photo && (
          <figure>
            <img src={dataUrl(`${photo.file}?v=${DATA_VERSION}`)} alt={photo.name} />
            <figcaption>
              {photo.camera} · {photo.credit}
            </figcaption>
          </figure>
        )}
        <div className="game-card-body">
          <div className="game-panel-title">
            {t('game.card.title')} ·{' '}
            {t(numbers.length > 1 ? 'game.card.numbers' : 'game.card.number', {
              number: site.sampleNumber,
            })}
          </div>
          <h2 id="game-card-title">{site.name}</h2>
          <p className="meta">
            {t('game.card.at', { outcrop: site.outcrop, location: site.location })}
          </p>
          <p>{t(`game.card.why.${whyKey(site)}`)}</p>
          {poi && <p>{poi.why[lang]}</p>}
          <p className="meta">{t('game.card.cored', { sol: site.sol, date: site.earthDate })}</p>
          <p className="meta">{t('game.card.inRack')}</p>
          <button
            type="button"
            className="btn btn-primary"
            autoFocus
            onClick={() => session.closeCard()}
          >
            {t('game.card.continue')}
          </button>
        </div>
      </div>
    </div>
  );
}

function PanoramaPhase({ session }: { session: GameSession }) {
  const id = useGame((s) => s.panorama);
  if (!id) return null;
  const yaw = (session.roverPose.cameraRad * 180) / Math.PI;
  return <PanoramaView id={id} startYawDeg={yaw} onClose={() => session.closePanorama()} />;
}

function Complete({ session }: { session: GameSession }) {
  const { t, i18n } = useTranslation();
  const result = useGame((s) => s.result);
  if (!result) return null;
  const lang = i18n.language;
  const first = CHAPTERS[0]!.sols[0];
  const last = CHAPTERS[CHAPTERS.length - 1]!.sols[1];
  return (
    <div className="game-screen">
      <div
        className="game-dialog game-small"
        role="dialog"
        aria-modal="true"
        aria-labelledby="game-done"
      >
        <div className="game-panel-title">{t('game.title')}</div>
        <h2 id="game-done">{t('game.complete.title')}</h2>
        {result.newBest && <p className="game-best">{t('game.complete.newBest')}</p>}
        <dl className="game-stats">
          <div>
            <dt>{t('game.complete.time')}</dt>
            <dd>{formatClock(result.elapsedS)}</dd>
          </div>
          <div>
            <dt>{t('game.complete.driven')}</dt>
            <dd>{formatDistance(result.odometerM, lang)}</dd>
          </div>
          <div>
            <dt>{t('game.complete.energy')}</dt>
            <dd>{Math.round(result.energyUsedPct)}%</dd>
          </div>
          <div>
            <dt>{t('game.complete.tubes')}</dt>
            <dd>{result.tubes}</dd>
          </div>
          <div>
            <dt>{t('game.complete.depot')}</dt>
            <dd>{result.depotTubes}</dd>
          </div>
          <div>
            <dt>{t('game.complete.science')}</dt>
            <dd>{result.science}</dd>
          </div>
          <div>
            <dt>{t('game.complete.rocks')}</dt>
            <dd>{result.rocks}</dd>
          </div>
          <div>
            <dt>{t('game.complete.panoramas')}</dt>
            <dd>{result.panoramas}/3</dd>
          </div>
          <div>
            <dt>{t('game.complete.flights')}</dt>
            <dd>{result.flights}</dd>
          </div>
          <div>
            <dt>{t('game.complete.wheels')}</dt>
            <dd>{Math.round(result.wheelsPct)}%</dd>
          </div>
        </dl>
        <p>
          {t('game.complete.real', {
            first,
            last,
            sols: last - first,
            months: Math.round(((last - first) * 1.0275) / 30.44),
          })}
        </p>
        <div className="btn-stack">
          <button
            type="button"
            className="btn btn-primary"
            autoFocus
            onClick={() => session.keepExploring()}
          >
            {t('game.complete.explore')}
          </button>
          <button type="button" className="btn" onClick={() => session.newExpedition()}>
            {t('game.complete.again')}
          </button>
          <button type="button" className="btn" onClick={() => session.quit()}>
            {t('game.complete.menu')}
          </button>
        </div>
      </div>
    </div>
  );
}
