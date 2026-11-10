import {
  memo,
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { DATA_VERSION, dataUrl } from '../config';
import { POIS, samplePhotos } from '../data/catalog';
import { LANGUAGES } from '../i18n';
import { formatClock, formatDegrees, formatDistance } from '../lib/format';
import { M_PER_DEG } from '../lib/math';
import { resetProgress } from './career';
import {
  MISSIONS,
  isDone,
  missionOf,
  objectiveCount,
  objectiveDone,
  type MissionId,
  type Target,
} from './expedition';
import { Inventory, whyKey } from './Inventory';
import { PanoramaView } from './PanoramaView';
import { deletePhoto, downloadBlob, listPhotos, photoFileName, type Photo } from './photos';
import { DRIVE } from './roverSim';
import { mainElements, POINTS } from './science';
import { GameSession, readQuality, writeQuality } from './session';
import { Spectrum } from './Spectrum';
import { useGame } from './store';
import { useTip } from './tips';
import { useTubePicture } from './useTubePicture';
import { ModeSwitch } from '../ui/ModeSwitch';
import { VideoPlayer } from '../ui/VideoPlayer';
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
      {session && phase === 'intro' && <LandingIntro session={session} />}
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
      {session && <VideoReplay />}
    </div>
  );
}

// ---------- main menu ----------

/** The UK and Spanish flags (drawn: Windows shows flag emoji as letters). */
function Flag({ lang }: { lang: string }) {
  const id = useId();
  if (lang === 'es')
    return (
      <svg viewBox="0 0 750 500" aria-hidden="true">
        <rect width="750" height="500" fill="#c60b1e" />
        <rect y="125" width="750" height="250" fill="#ffc400" />
      </svg>
    );
  return (
    <svg viewBox="0 0 60 30" aria-hidden="true">
      <clipPath id={`${id}s`}>
        <path d="M0 0v30h60V0z" />
      </clipPath>
      <clipPath id={`${id}t`}>
        <path d="M30 15h30v15zv15H0zH0V0zV0h30z" />
      </clipPath>
      <g clipPath={`url(#${id}s)`}>
        <path d="M0 0v30h60V0z" fill="#012169" />
        <path d="M0 0l60 30m0-30L0 30" stroke="#fff" strokeWidth="6" />
        <path d="M0 0l60 30m0-30L0 30" clipPath={`url(#${id}t)`} stroke="#c8102e" strokeWidth="4" />
        <path d="M30 0v30M0 15h60" stroke="#fff" strokeWidth="10" />
        <path d="M30 0v30M0 15h60" stroke="#c8102e" strokeWidth="6" />
      </g>
    </svg>
  );
}

const LANGUAGE_NAMES: Record<string, string> = { en: 'English', es: 'Español' };

function LanguageSwitch() {
  const { i18n } = useTranslation();
  return (
    <div className="game-lang" role="group" aria-label="Language / Idioma">
      {LANGUAGES.map((l) => (
        <button
          key={l}
          type="button"
          className={`game-flag ${i18n.language === l ? 'is-on' : ''}`}
          aria-pressed={i18n.language === l}
          aria-label={LANGUAGE_NAMES[l] ?? l}
          title={LANGUAGE_NAMES[l] ?? l}
          onClick={() => void i18n.changeLanguage(l)}
        >
          <Flag lang={l} />
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

/**
 * The mission slate, in the order Perseverance lived them (the research brief's twelve episodes).
 * Playable ones have a mission; the others are shown as coming soon. Each has a real NASA picture
 * (scripts/data/fetch-mission-cards.ts).
 */
const SLATE: Array<{ n: number; key: string; mission?: MissionId }> = [
  { n: 1, key: 'landing', mission: 'landing' },
  { n: 2, key: 'ingenuity', mission: 'ingenuity' },
  { n: 3, key: 'moxie' },
  { n: 4, key: 'firstSample' },
  { n: 5, key: 'chute' },
  { n: 6, key: 'delta', mission: 'delta' },
  { n: 7, key: 'lastFlight' },
  { n: 8, key: 'leopard' },
  { n: 9, key: 'rim' },
  { n: 10, key: 'sparks' },
  { n: 11, key: 'aiDrive' },
  { n: 12, key: 'record' },
];

/**
 * The game's home: the two modes of Copernico, the language, and the missions as cards of one
 * size, each with a single button (start, or continue where it was left). Options, photos,
 * restarting and the mission's video are in the pause menu; how to play is taught while playing.
 */
function MainMenu({ session }: { session: GameSession }) {
  const { t } = useTranslation();
  const saves = useGame((s) => s.saves);
  return (
    <div className="game-screen game-home">
      <section className="game-home-panel" aria-labelledby="game-title">
        <header className="game-home-head">
          <div className="game-home-modes">
            <a className="brand" href={HOME} title={t('modes.home')}>
              <span className="brand-mark" aria-hidden="true" />
              <span className="brand-name">{t('app.name')}</span>
            </a>
            <ModeSwitch current="game" />
          </div>
          <LanguageSwitch />
        </header>
        <h1 id="game-title">{t('game.title')}</h1>
        <p className="lede">{t('game.tagline')}</p>
        <ol className="game-missions-grid">
          {SLATE.map((m) => {
            const id = m.mission;
            const saved = id ? saves[id] : undefined;
            const chapters = id ? MISSIONS[id].chapters.length : 0;
            const title = t(`game.missions.${m.key}.title`);
            return (
              <li key={m.key} className={`game-mc ${id ? '' : 'is-soon'}`}>
                <div className="game-mc-img">
                  <img
                    src={dataUrl(`game/cards/${m.key}.webp?v=${DATA_VERSION}`)}
                    alt=""
                    loading="lazy"
                    width={640}
                    height={360}
                  />
                  <span className="game-mc-n">{m.n}</span>
                  {!id && <span className="game-mc-badge">{t('game.missions.soon')}</span>}
                  {saved !== undefined && (
                    <span className="game-mc-badge is-progress">
                      {t('game.missions.progress', { chapter: saved + 1, count: chapters })}
                    </span>
                  )}
                </div>
                <div className="game-mc-body">
                  <span className="game-mc-when">{t(`game.missions.${m.key}.when`)}</span>
                  <h2>{title}</h2>
                  <p>{t(`game.missions.${m.key}.desc`)}</p>
                  {id ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      aria-label={`${saved !== undefined ? t('game.missions.continue', { chapter: saved + 1 }) : t('game.missions.start')}: ${title}`}
                      onClick={() =>
                        void (saved !== undefined
                          ? session.continueExpedition(id)
                          : session.newExpedition(id))
                      }
                    >
                      {saved !== undefined
                        ? t('game.missions.continue', { chapter: saved + 1 })
                        : t('game.missions.start')}
                    </button>
                  ) : (
                    <button type="button" className="btn" disabled>
                      {t('game.missions.soon')}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        <p className="meta game-home-credit">{t('game.missions.credit')}</p>
      </section>
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

function Options({ session }: { session: GameSession }) {
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
              useGame.getState().set({ hasSave: false, saves: {} });
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

// ---------- chapter page ----------

function ChapterPage({ session }: { session: GameSession }) {
  const { t } = useTranslation();
  const exp = useGame((s) => s.expedition);
  const c = missionOf(exp).chapters[exp.chapter]!;
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
  const c = missionOf(exp).chapters[exp.chapter];
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
  let hint = false;
  const { here, action } = hud;
  const fraction = action?.fraction ?? hud.laser?.fraction ?? null;
  if (action && here) {
    text =
      action.kind === 'core'
        ? t('game.prompt.coring', { name: here.name })
        : action.kind === 'panorama'
          ? t('game.prompt.shooting', { name: here.name })
          : action.kind === 'deposit'
            ? t('game.prompt.dropping')
            : t(`game.prompt.doing.${action.kind}`);
  } else if (hud.laser) {
    text = t('game.prompt.lasering');
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
  } else if (here?.kind === 'station' && here.step) {
    text = t(`game.prompt.${here.stopped ? 'hold' : 'stop'}ToStep`, {
      action: t(`game.steps.${here.step}`),
    });
    tone = 'is-go';
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
    hint = true;
  }
  // How to play, a tip at a time, where the line is free (a tip outranks the AutoNav hint).
  const tip = useTip(hud, !text || hint);
  if (tip) {
    text = t(`game.tips.${tip}`);
    tone = 'is-tip';
  }
  return (
    <div className={`game-prompt ${tone}`} role="status" aria-live="polite">
      {text && (
        <span>
          {tone === 'is-tip' && <b className="game-tip-label">{t('game.tips.label')}</b>}
          {text}
        </span>
      )}
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
  const chapter = missionOf(exp).chapters[exp.chapter];
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
/** The larger map: at most this much bigger, and only as far as the HUD around it leaves room. */
const MAP_SCALE_LARGE = 1.5;
/** Half the width kept free at the bottom centre for the prompt, and the map bar's height (px). */
const PROMPT_HALF_PX = 230;
const MAP_BAR_PX = 40;

/** How much the map may grow without covering the objectives panel or the prompt. */
function largeMapScale(): number {
  const objectives = document.querySelector('.game-objectives')?.getBoundingClientRect().bottom ?? 140;
  const byWidth = (window.innerWidth / 2 - PROMPT_HALF_PX - 16) / MAP_W;
  const byHeight = (window.innerHeight - 16 - MAP_BAR_PX - objectives - 12) / MAP_H;
  return Math.max(1, Math.min(MAP_SCALE_LARGE, byWidth, byHeight));
}

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
  const [kLarge, setKLarge] = useState(MAP_SCALE_LARGE);
  useEffect(() => {
    if (!large) return;
    const fit = () => setKLarge(largeMapScale());
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [large]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const roverRef = useRef<SVGGElement>(null);
  const heliRef = useRef<SVGGElement>(null);
  const k = large ? kLarge : 1;
  const W = MAP_W * k;
  const H = MAP_H * k;

  // Extent: every place of the map, the start and the airfields, with a margin.
  const m = session.missionDef;
  const pts = [...session.places, m.start, ...m.flights, ...(m.hardware ?? [])];
  const lats = pts.map((p) => p.lat);
  const lons = pts.map((p) => p.lon);
  let lat0 = (Math.min(...lats) + Math.max(...lats)) / 2;
  let lon0 = (Math.min(...lons) + Math.max(...lons)) / 2;
  const spanX =
    (Math.max(...lons) - Math.min(...lons)) * Math.cos((lat0 * Math.PI) / 180) * M_PER_DEG + 160;
  const spanY = (Math.max(...lats) - Math.min(...lats)) * M_PER_DEG + 160;
  const base0 = session.mapImage;
  // The view stays inside the surface image (no empty bands): at most its size, and centred so
  // that it does not run past its edges.
  const fitM = base0 ? Math.min(base0.widthM / W, base0.heightM / H) : Infinity;
  const mPerPx = Math.min(Math.max(spanX / W, spanY / H), fitM);
  const area0 = session.world.frame;
  if (base0 && area0) {
    const [ax, ay] = toMap(lat0, lon0, area0.lat0, area0.lon0);
    const hx = Math.max(0, base0.widthM / 2 - (W / 2) * mPerPx);
    const hy = Math.max(0, base0.heightM / 2 - (H / 2) * mPerPx);
    const dx = Math.min(hx, Math.max(-hx, -ax));
    const dy = Math.min(hy, Math.max(-hy, -ay));
    lon0 = lon0 + (ax + dx) / (Math.cos((lat0 * Math.PI) / 180) * M_PER_DEG);
    lat0 = lat0 + (ay + dy) / M_PER_DEG;
  }
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
        <button
          type="button"
          className="game-map-toggle"
          aria-label={large ? t('game.map.smaller') : t('game.map.larger')}
          title={large ? t('game.map.smaller') : t('game.map.larger')}
          aria-pressed={large}
          onClick={() => setLarge(!large)}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            {large ? (
              <path d="M9.5 2.5v4h4M6.5 13.5v-4h-4M9.5 6.5l4.5-4.5M6.5 9.5L2 14" />
            ) : (
              <path d="M10 2h4v4M6 14H2v-4M14 2L9 7M2 14l5-5" />
            )}
          </svg>
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

/**
 * Paused: back to driving, the inventory, the mission's video, options, photos, restarting the
 * mission, and the main menu. Options and photos open in the same dialog, with a way back.
 */
function PauseMenu({ session }: { session: GameSession }) {
  const { t } = useTranslation();
  const [view, setView] = useState<'main' | 'options' | 'photos'>('main');
  const [confirmRestart, setConfirmRestart] = useState(false);
  if (view !== 'main')
    return (
      <div className="game-screen">
        <div
          className="game-dialog game-pause-sub"
          role="dialog"
          aria-modal="true"
          aria-labelledby="game-pause-sub"
        >
          <button type="button" className="game-video-back" autoFocus onClick={() => setView('main')}>
            {t('game.pause.backToPause')}
          </button>
          <h2 id="game-pause-sub">{t(`game.pause.${view}`)}</h2>
          {view === 'options' ? <Options session={session} /> : <Gallery />}
        </div>
      </div>
    );
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
          {session.missionDef.intro && (
            <button
              type="button"
              className="btn"
              onClick={() => useGame.getState().set({ video: session.missionDef.intro! })}
            >
              ▶ {t('game.video.watch')}
            </button>
          )}
          <button type="button" className="btn" onClick={() => setView('options')}>
            {t('game.pause.options')}
          </button>
          <button type="button" className="btn" onClick={() => setView('photos')}>
            {t('game.pause.photos')}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() =>
              confirmRestart ? void session.newExpedition() : setConfirmRestart(true)
            }
          >
            {confirmRestart ? t('game.pause.restartConfirm') : t('game.pause.restart')}
          </button>
          <button type="button" className="btn" onClick={() => session.quit()}>
            {t('game.pause.menu')}
          </button>
        </div>
        <p className="meta">{t('game.pause.saved')}</p>
      </div>
    </div>
  );
}

function SampleCard({ session }: { session: GameSession }) {
  const { t, i18n } = useTranslation();
  const card = useGame((s) => s.card);
  const tube = useTubePicture(true);
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
          {tube && (
            <figure className="game-card-tube">
              {numbers.map((n) => (
                <div key={n} className="game-card-tube-row">
                  <img src={tube} alt="" />
                  <span>{t('game.card.number', { number: n })}</span>
                </div>
              ))}
              <figcaption>{t('game.card.tubeCaption')}</figcaption>
            </figure>
          )}
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
  const exp = useGame((s) => s.expedition);
  if (!result) return null;
  const lang = i18n.language;
  const m = missionOf(exp);
  const chapters = m.chapters;
  const first = chapters[0]!.sols[0];
  const last = chapters[chapters.length - 1]!.sols[1];
  const sampling = m.id === 'delta';
  return (
    <div className="game-screen">
      <div
        className="game-dialog game-small"
        role="dialog"
        aria-modal="true"
        aria-labelledby="game-done"
      >
        <div className="game-panel-title">{t('game.title')}</div>
        <h2 id="game-done">{t(`game.missions.${m.id}.complete`)}</h2>
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
          {sampling && (
            <div>
              <dt>{t('game.complete.tubes')}</dt>
              <dd>{result.tubes}</dd>
            </div>
          )}
          {sampling && (
            <div>
              <dt>{t('game.complete.depot')}</dt>
              <dd>{result.depotTubes}</dd>
            </div>
          )}
          <div>
            <dt>{t('game.complete.science')}</dt>
            <dd>{result.science}</dd>
          </div>
          <div>
            <dt>{t('game.complete.rocks')}</dt>
            <dd>{result.rocks}</dd>
          </div>
          {sampling && (
            <div>
              <dt>{t('game.complete.panoramas')}</dt>
              <dd>{result.panoramas}/3</dd>
            </div>
          )}
          {sampling && (
            <div>
              <dt>{t('game.complete.flights')}</dt>
              <dd>{result.flights}</dd>
            </div>
          )}
          <div>
            <dt>{t('game.complete.wheels')}</dt>
            <dd>{Math.round(result.wheelsPct)}%</dd>
          </div>
        </dl>
        <p>
          {t(`game.missions.${m.id}.real`, {
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
          <button type="button" className="btn" onClick={() => void session.newExpedition()}>
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

// ---------- NASA videos ----------

/** NASA's landing video before the landing mission's first chapter. */
function LandingIntro({ session }: { session: GameSession }) {
  const { t } = useTranslation();
  return (
    <VideoPlayer
      id="landing"
      doneLabel={t('game.video.skip')}
      onDone={() => session.endIntro()}
      onBack={() => session.quit()}
      doneAtEnd
    />
  );
}

/** A video watched again (from the missions menu or the pause menu). */
function VideoReplay() {
  const { t } = useTranslation();
  const id = useGame((s) => s.video);
  if (!id) return null;
  return (
    <VideoPlayer
      id={id}
      doneLabel={t('game.video.close')}
      onDone={() => useGame.getState().set({ video: null })}
    />
  );
}
