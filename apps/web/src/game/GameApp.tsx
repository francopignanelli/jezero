import { memo, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { DATA_VERSION, dataUrl } from '../config';
import { POIS, samplePhotos } from '../data/catalog';
import type { SampleSite } from '../data/surfaceData';
import { LANGUAGES } from '../i18n';
import { loadGroundBasemap, mapPx, type LocalMap } from '../lib/basemap';
import { formatClock, formatDegrees, formatDistance } from '../lib/format';
import { M_PER_DEG } from '../lib/math';
import { readCareer, resetProgress, type Career } from './career';
import { DRIVE } from './roverSim';
import { MISSIONS, missionTargets, realSols, type MissionId, type Target } from './missions';
import { deletePhoto, downloadBlob, listPhotos, photoFileName, type Photo } from './photos';
import { LINES, POINTS, ROCK_TYPES, mainElements, spectrum, type RockType } from './science';
import { GameSession, readQuality, writeQuality } from './session';
import { PHOTO_FILTERS, type Quality } from './world/world';
import { useGame } from './store';

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
      {session && ['playing', 'paused', 'card'].includes(phase) && <Hud session={session} />}
      {session && phase === 'playing' && <FindingPanel />}
      {session && phase === 'paused' && <PauseMenu session={session} />}
      {session && phase === 'card' && <SampleCard session={session} />}
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

const bestTime = (id: MissionId): number | null => {
  try {
    const v = Number(localStorage.getItem(`copernico.game.best.${id}`));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
};

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

const TABS = ['missions', 'collection', 'photos', 'options', 'how'] as const;
type Tab = (typeof TABS)[number];

function MainMenu({ session }: { session: GameSession }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('missions');
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
          {tab === 'missions' && <MissionList session={session} career={career} />}
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

function MissionList({ session, career }: { session: GameSession; career: Career }) {
  const { t } = useTranslation();
  const samples = session.sampleSites;
  return (
    <ul className="game-missions">
      {MISSIONS.map((m, i) => {
        const targets = missionTargets(m, samples).filter((x) => x.kind === 'sample');
        const tubes = targets.reduce((n, x) => n + x.tubes, 0);
        const got = targets.filter((x) => career.samples.includes(x.id)).length;
        const best = bestTime(m.id);
        return (
          <li key={m.id}>
            <div>
              <strong>{t(`game.missions.${m.id}.name`)}</strong>
              <p>{t(`game.missions.${m.id}.desc`)}</p>
              <p className="meta">
                {t('game.sites', { count: targets.length })} · {t('game.tubes', { count: tubes })} ·{' '}
                {t('game.menu.found', { got, total: targets.length })}
                {best !== null && <> · {t('game.best', { time: formatClock(best) })}</>}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              autoFocus={i === 0}
              onClick={() => void session.start(m.id)}
            >
              {t('game.start')}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Samples cored (ever) per mission, and the rock types found with the laser. */
function Collection({ session, career }: { session: GameSession; career: Career }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === 'es' ? 'es' : 'en';
  const all = MISSIONS.flatMap((m) =>
    missionTargets(m, session.sampleSites).filter((x) => x.kind === 'sample'),
  );
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
      {MISSIONS.map((m) => (
        <section key={m.id}>
          <h2>{t(`game.missions.${m.id}.name`)}</h2>
          <ul className="game-samples">
            {missionTargets(m, session.sampleSites)
              .filter((x) => x.kind === 'sample' && x.site)
              .map((x) => {
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
                            <img src={dataUrl(`${photo.file}?v=${DATA_VERSION}`)} alt="" />
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
                        <p className="meta game-sample-more">
                          {t('game.collection.locked', {
                            mission: t(`game.missions.${m.id}.name`),
                          })}
                        </p>
                      )}
                    </details>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
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
        {(['drive', 'core', 'laser', 'photo', 'slope', 'power', 'keys'] as const).map((k) => (
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

// ---------- HUD ----------

function Hud({ session }: { session: GameSession }) {
  const { t, i18n } = useTranslation();
  const hud = useGame((s) => s.hud);
  const targets = useGame((s) => s.targets);
  const collected = useGame((s) => s.collected);
  const deposited = useGame((s) => s.deposited);
  const camera = useGame((s) => s.camera);
  const mapOpen = useGame((s) => s.mapOpen);
  const missionId = useGame((s) => s.missionId);
  const lang = i18n.language;
  const samples = targets.filter((x) => x.kind === 'sample');
  const depot = targets.find((x) => x.kind === 'depot');
  const done = (x: Target) => (x.kind === 'depot' ? deposited : collected.includes(x.id));

  return (
    <div className="game-hud">
      <section className="game-panel game-objectives" aria-label={t('game.hud.samples')}>
        <div className="game-panel-title">{missionId && t(`game.missions.${missionId}.name`)}</div>
        <ol>
          {samples.map((x) => (
            <li key={x.id} className={done(x) ? 'is-done' : ''}>
              <span aria-hidden="true">{done(x) ? '✓' : '○'}</span> {x.name}
            </li>
          ))}
          {depot && (
            <li className={`is-depot ${deposited ? 'is-done' : ''}`}>
              <span aria-hidden="true">{deposited ? '✓' : '◇'}</span> {t('game.hud.depot')}:{' '}
              {depot.name}
            </li>
          )}
        </ol>
        {hud.storm && (
          <p className={`game-storm ${hud.storm === 'active' ? 'is-active' : ''}`}>
            {t(hud.storm === 'active' ? 'game.hud.storm' : 'game.hud.stormSoon')}
          </p>
        )}
      </section>

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
            <dd>{hud.science}</dd>
          </div>
        </dl>
        <div className="game-tools">
          <button
            type="button"
            className="btn btn-icon"
            disabled={hud.laserTarget !== 'ready' || !!hud.laser}
            onClick={() => session.fireLaser()}
          >
            {t('game.hud.laser')}
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

      <Prompt />
      {mapOpen && <GameMap session={session} />}
      <TouchPad session={session} />
    </div>
  );
}

function Prompt() {
  const { t } = useTranslation();
  const hud = useGame((s) => s.hud);
  const targets = useGame((s) => s.targets);
  const collected = useGame((s) => s.collected);
  let text: string | null = null;
  let tone = '';
  const { here, action } = hud;
  const fraction = action?.fraction ?? hud.laser?.fraction ?? null;
  if (action && here) {
    text =
      action.kind === 'core'
        ? t('game.prompt.coring', { name: here.name })
        : t('game.prompt.dropping');
  } else if (hud.laser) {
    text = t('game.prompt.lasering');
  } else if (hud.stuck) {
    text = t('game.prompt.stuck');
    tone = 'is-warn';
  } else if (hud.blocked === 'power' || hud.recharging) {
    text = t('game.prompt.power');
    tone = 'is-warn';
  } else if (hud.blocked === 'steep') {
    text = t('game.prompt.steep');
    tone = 'is-warn';
  } else if (hud.blocked === 'tilt') {
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
    if (here.kind === 'depot')
      text = here.stopped ? t('game.prompt.holdToDrop') : t('game.prompt.stopToDrop');
    else
      text = here.stopped
        ? t('game.prompt.holdToCore', { name: here.name })
        : t('game.prompt.stopToCore', { name: here.name });
    tone = 'is-go';
  } else if (hud.laserTarget === 'ready') {
    text = t('game.prompt.laserReady');
  } else if (hud.laserTarget === 'done') {
    text = t('game.prompt.laserDone');
  } else if (hud.tiltDeg >= DRIVE.tiltWarnDeg) {
    text = t('game.prompt.tilt', { deg: `${Math.round(hud.tiltDeg)}°` });
    tone = 'is-warn';
  } else if (hud.storm === 'active') {
    text = t('game.prompt.storm');
  } else if (
    hud.next?.kind === 'depot' &&
    targets.filter((x) => x.kind === 'sample').every((x) => collected.includes(x.id))
  ) {
    text = t('game.prompt.toDepot');
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

// ---------- SuperCam read-out ----------

const SPEC_W = 260;
const SPEC_H = 70;

/** LIBS spectrum: intensity against wavelength (240–800 nm), the main lines labelled. */
function Spectrum({ type, seed }: { type: RockType; seed: string }) {
  const values = spectrum(type, seed);
  const max = Math.max(...values);
  const x = (nm: number) => ((nm - 240) / 560) * SPEC_W;
  const pts = values
    .map(
      (v, i) =>
        `${((i / (values.length - 1)) * SPEC_W).toFixed(1)},${(SPEC_H - 12 - (v / max) * (SPEC_H - 22)).toFixed(1)}`,
    )
    .join(' ');
  const main = mainElements(type, 4);
  const labelled = LINES.filter(
    (l, i) => main.includes(l.el) && LINES.findIndex((m) => m.el === l.el) === i,
  );
  return (
    <svg className="game-spectrum" viewBox={`0 0 ${SPEC_W} ${SPEC_H}`} aria-hidden="true">
      <polyline points={pts} />
      {labelled.map((l) => (
        <text key={l.el} x={x(l.nm)} y={9} textAnchor="middle">
          {l.el}
        </text>
      ))}
      <text x={0} y={SPEC_H - 1}>
        240 nm
      </text>
      <text x={SPEC_W} y={SPEC_H - 1} textAnchor="end">
        800 nm
      </text>
    </svg>
  );
}

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
  const missionId = useGame((s) => s.missionId);
  const [saved, setSaved] = useState<{ blob: Blob; name: string; kept: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const area = t(`game.missions.${missionId ?? 'floor'}.name`);
  const caption = `Perseverance · Jezero · ${area} · ${new Date().toLocaleDateString(i18n.language)} · Copernico`;
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

const MAP_PX = 220;

/** Re-rendered only when the mission or its progress changes, not with every HUD update. */
const GameMap = memo(function GameMap({ session }: { session: GameSession }) {
  const { t, i18n } = useTranslation();
  const targets = useGame((s) => s.targets);
  const collected = useGame((s) => s.collected);
  const deposited = useGame((s) => s.deposited);
  const missionId = useGame((s) => s.missionId);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const roverRef = useRef<SVGGElement>(null);

  // Mission area: the start and every target, with a margin, north up.
  const mission = MISSIONS.find((m) => m.id === missionId);
  const pts = [...targets, ...(mission ? [mission.start] : [])];
  const lats = pts.map((p) => p.lat);
  const lons = pts.map((p) => p.lon);
  const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2;
  const lon0 = (Math.min(...lons) + Math.max(...lons)) / 2;
  const spanM =
    Math.max(
      (Math.max(...lats) - Math.min(...lats)) * M_PER_DEG,
      (Math.max(...lons) - Math.min(...lons)) * M_PER_DEG * Math.cos((lat0 * Math.PI) / 180),
    ) + 500;
  const map: LocalMap = { lat0, lon0, widthPx: MAP_PX, heightPx: MAP_PX, mPerPx: spanM / MAP_PX };
  const key = `${missionId}`;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || targets.length === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = canvas.height = MAP_PX * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let live = true;
    // CTX at about the map's own scale (z13 ≈ 5 m/px … z11 ≈ 20 m/px).
    const z = map.mPerPx < 8 ? 13 : map.mPerPx < 16 ? 12 : 11;
    void loadGroundBasemap(map, z).then((draw) => live && draw(ctx));
    return () => {
      live = false;
    };
    // The map depends only on the mission.
  }, [key, targets.length]);

  // The rover arrow follows every animation frame (not through React).
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const p = session.roverPose;
      const [x, y] = mapPx(map, p.lat, p.lon);
      roverRef.current?.setAttribute(
        'transform',
        `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${((p.headingRad * 180) / Math.PI).toFixed(1)})`,
      );
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [key, targets.length]);

  const scaleM = spanM > 4000 ? 2000 : spanM > 1500 ? 500 : 200;
  return (
    <div className="game-map" role="img" aria-label={t('game.hud.map')}>
      <canvas ref={canvasRef} style={{ width: MAP_PX, height: MAP_PX }} aria-hidden="true" />
      <svg viewBox={`0 0 ${MAP_PX} ${MAP_PX}`} aria-hidden="true">
        {targets.map((x) => {
          const [cx, cy] = mapPx(map, x.lat, x.lon);
          const isDone = x.kind === 'depot' ? deposited : collected.includes(x.id);
          return x.kind === 'depot' ? (
            <rect
              key={x.id}
              x={cx - 5}
              y={cy - 5}
              width="10"
              height="10"
              transform={`rotate(45 ${cx} ${cy})`}
              className={`game-map-depot ${isDone ? 'is-done' : ''}`}
            />
          ) : (
            <circle
              key={x.id}
              cx={cx}
              cy={cy}
              r="5"
              className={`game-map-target ${isDone ? 'is-done' : ''}`}
            />
          );
        })}
        <g ref={roverRef}>
          <path d="M0 -8 L6 6 L0 3 L-6 6 Z" className="game-map-rover" />
        </g>
        <text x={MAP_PX / 2} y="14" textAnchor="middle" className="game-map-n">
          N
        </text>
        <g className="game-map-scale">
          <line x1="10" x2={10 + scaleM / map.mPerPx} y1={MAP_PX - 10} y2={MAP_PX - 10} />
          <text x="10" y={MAP_PX - 15}>
            {formatDistance(scaleM, i18n.language)}
          </text>
        </g>
      </svg>
    </div>
  );
});

// ---------- touch pad ----------

function TouchPad({ session }: { session: GameSession }) {
  const { t } = useTranslation();
  const [coarse] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches,
  );
  if (!coarse) return null;
  const touch = session.controls.touch;
  const hold = (apply: (on: boolean) => void) => ({
    onPointerDown: (e: ReactPointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      apply(true);
    },
    onPointerUp: () => apply(false),
    onPointerCancel: () => apply(false),
    onContextMenu: (e: { preventDefault(): void }) => e.preventDefault(),
  });
  return (
    <div className="game-touch">
      <div className="game-touch-steer">
        <button
          type="button"
          aria-label={t('game.touch.left')}
          {...hold((on) => (touch.steer = on ? -1 : 0))}
        >
          ◀
        </button>
        <button
          type="button"
          aria-label={t('game.touch.right')}
          {...hold((on) => (touch.steer = on ? 1 : 0))}
        >
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
          {...hold((on) => (touch.action = on))}
        >
          ⦿
        </button>
        <button
          type="button"
          aria-label={t('game.touch.boost')}
          {...hold((on) => (touch.boost = on))}
        >
          »
        </button>
        <button
          type="button"
          aria-label={t('game.touch.forward')}
          {...hold((on) => (touch.throttle = on ? 1 : 0))}
        >
          ▲
        </button>
        <button
          type="button"
          aria-label={t('game.touch.back')}
          {...hold((on) => (touch.throttle = on ? -1 : 0))}
        >
          ▼
        </button>
      </div>
    </div>
  );
}

// ---------- dialogs ----------

function PauseMenu({ session }: { session: GameSession }) {
  const { t } = useTranslation();
  const missionId = useGame((s) => s.missionId);
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
            onClick={() => missionId && void session.start(missionId)}
          >
            {t('game.pause.restart')}
          </button>
          <button type="button" className="btn" onClick={() => session.quit()}>
            {t('game.pause.missions')}
          </button>
          <a className="btn btn-ghost" href={HOME}>
            {t('game.back')}
          </a>
        </div>
      </div>
    </div>
  );
}

/** Kind of sample, for its explanation. */
function whyKey(site: SampleSite): string {
  if (site.sampleType === 'Atmospheric') return 'atmospheric';
  if (site.sampleType === 'Regolith') return 'regolith';
  if (/carbonate/i.test(site.rockType)) return 'carbonate';
  if (/mixed/i.test(site.rockType)) return 'mixed';
  if (/^igneous/i.test(site.rockType)) return 'igneous';
  return 'sedimentary';
}

function SampleCard({ session }: { session: GameSession }) {
  const { t, i18n } = useTranslation();
  const card = useGame((s) => s.card);
  const targets = useGame((s) => s.targets);
  const collected = useGame((s) => s.collected);
  const site = card?.site;
  if (!card || !site) return null;
  const photo = samplePhotos(site.sampleNumber)[0];
  const numbers: string[] = site.sampleNumber.match(/\d+/g) ?? [];
  const poi = POIS.find((p) => p.sampleNumbers.some((n) => numbers.includes(n)));
  const lang = i18n.language === 'es' ? 'es' : 'en';
  const last = targets.filter((x) => x.kind === 'sample').every((x) => collected.includes(x.id));
  const finishing = last && !targets.some((x) => x.kind === 'depot');
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
          <button
            type="button"
            className="btn btn-primary"
            autoFocus
            onClick={() => session.closeCard()}
          >
            {finishing ? t('game.card.finish') : t('game.card.continue')}
          </button>
        </div>
      </div>
    </div>
  );
}

function Complete({ session }: { session: GameSession }) {
  const { t, i18n } = useTranslation();
  const result = useGame((s) => s.result);
  const targets = useGame((s) => s.targets);
  if (!result) return null;
  const sols = realSols(targets);
  const lang = i18n.language;
  return (
    <div className="game-screen">
      <div
        className="game-dialog game-small"
        role="dialog"
        aria-modal="true"
        aria-labelledby="game-done"
      >
        <div className="game-panel-title">{t(`game.missions.${result.missionId}.name`)}</div>
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
            <dt>{t('game.complete.science')}</dt>
            <dd>{result.science}</dd>
          </div>
          <div>
            <dt>{t('game.complete.rocks')}</dt>
            <dd>{result.rocks}</dd>
          </div>
          <div>
            <dt>{t('game.complete.wheels')}</dt>
            <dd>{Math.round(result.wheelsPct)}%</dd>
          </div>
        </dl>
        {!result.newBest && result.bestS !== null && (
          <p className="meta">{t('game.complete.best', { time: formatClock(result.bestS) })}</p>
        )}
        {sols && (
          <p>
            {t('game.complete.real', {
              first: sols[0],
              last: sols[1],
              sols: sols[1] - sols[0],
              months: Math.round(((sols[1] - sols[0]) * 1.0275) / 30.44),
            })}
          </p>
        )}
        <div className="btn-stack">
          <button
            type="button"
            className="btn btn-primary"
            autoFocus
            onClick={() => void session.start(result.missionId)}
          >
            {t('game.complete.again')}
          </button>
          <button type="button" className="btn" onClick={() => session.quit()}>
            {t('game.complete.other')}
          </button>
          <a className="btn btn-ghost" href={HOME}>
            {t('game.back')}
          </a>
        </div>
      </div>
    </div>
  );
}
