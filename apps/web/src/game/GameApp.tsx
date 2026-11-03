import { memo, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { DATA_VERSION, dataUrl } from '../config';
import { POIS, samplePhotos } from '../data/catalog';
import type { SampleSite } from '../data/surfaceData';
import { LANGUAGES } from '../i18n';
import { loadGroundBasemap, mapPx, type LocalMap } from '../lib/basemap';
import { formatClock, formatDegrees, formatDistance } from '../lib/format';
import { M_PER_DEG } from '../lib/math';
import { DRIVE } from './roverSim';
import { MISSIONS, missionTargets, realSols, type MissionId, type Target } from './missions';
import { GameSession, readQuality, writeQuality } from './session';
import type { Quality } from './world/world';
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
      {session && phase === 'briefing' && <Briefing session={session} />}
      {session && phase === 'loading' && (
        <div className="game-veil" role="status">
          {t('game.loadingMission')}
        </div>
      )}
      {session && ['playing', 'paused', 'card'].includes(phase) && <Hud session={session} />}
      {session && phase === 'paused' && <PauseMenu session={session} />}
      {session && phase === 'card' && <SampleCard session={session} />}
      {session && phase === 'complete' && <Complete session={session} />}
    </div>
  );
}

// ---------- mission menu ----------

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
    <label className="game-quality">
      <span>{t('game.quality.title')}</span>
      <select
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
    </label>
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

function Briefing({ session }: { session: GameSession }) {
  const { t } = useTranslation();
  const samples = session.sampleSites;
  return (
    <div className="game-screen">
      <section className="game-dialog game-briefing" aria-labelledby="game-title">
        <header className="game-briefing-head">
          <a className="btn btn-ghost" href={HOME}>
            ← {t('game.back')}
          </a>
          <div className="game-briefing-tools">
            <QualitySelect />
            <LanguageSwitch />
          </div>
        </header>
        <h1 id="game-title">{t('game.title')}</h1>
        <p className="lede">{t('game.tagline')}</p>
        <h2>{t('game.chooseMission')}</h2>
        <ul className="game-missions">
          {MISSIONS.map((m, i) => {
            const targets = missionTargets(m, samples).filter((x) => x.kind === 'sample');
            const tubes = targets.reduce((n, x) => n + x.tubes, 0);
            const best = bestTime(m.id);
            return (
              <li key={m.id}>
                <div>
                  <strong>{t(`game.missions.${m.id}.name`)}</strong>
                  <p>{t(`game.missions.${m.id}.desc`)}</p>
                  <p className="meta">
                    {t('game.sites', { count: targets.length })} ·{' '}
                    {t('game.tubes', { count: tubes })}
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
        <h2>{t('game.howTitle')}</h2>
        <ul className="game-how">
          {(['drive', 'core', 'slope', 'power', 'keys'] as const).map((k) => (
            <li key={k}>{t(`game.how.${k}`)}</li>
          ))}
        </ul>
        <p className="meta">{t('game.realNote')}</p>
      </section>
    </div>
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
        </dl>
        <div className="game-tools">
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
  if (action && here) {
    text =
      action.kind === 'core'
        ? t('game.prompt.coring', { name: here.name })
        : t('game.prompt.dropping');
  } else if (hud.blocked === 'power' || hud.recharging) {
    text = t('game.prompt.power');
    tone = 'is-warn';
  } else if (hud.blocked === 'steep') {
    text = t('game.prompt.steep');
    tone = 'is-warn';
  } else if (hud.blocked === 'edge') {
    text = t('game.prompt.edge');
    tone = 'is-warn';
  } else if (here) {
    if (here.kind === 'depot')
      text = here.stopped ? t('game.prompt.holdToDrop') : t('game.prompt.stopToDrop');
    else
      text = here.stopped
        ? t('game.prompt.holdToCore', { name: here.name })
        : t('game.prompt.stopToCore', { name: here.name });
    tone = 'is-go';
  } else if (hud.tiltDeg >= DRIVE.tiltWarnDeg) {
    text = t('game.prompt.tilt', { deg: `${Math.round(hud.tiltDeg)}°` });
    tone = 'is-warn';
  } else if (
    hud.next?.kind === 'depot' &&
    targets.filter((x) => x.kind === 'sample').every((x) => collected.includes(x.id))
  ) {
    text = t('game.prompt.toDepot');
  }
  return (
    <div className={`game-prompt ${tone}`} role="status" aria-live="polite">
      {text && <span>{text}</span>}
      {action && (
        <div className="game-bar game-action-bar" aria-hidden="true">
          <div style={{ width: `${action.fraction * 100}%` }} />
        </div>
      )}
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
