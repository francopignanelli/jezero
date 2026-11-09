import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { DATA_VERSION, dataUrl } from '../config';
import './video.css';

/** The missions' NASA videos, served with the game's data (no third-party request). */
const VIDEOS = {
  landing: {
    src: 'game/media/landing.mp4',
    captions: 'game/media/landing.en.vtt',
    key: 'landing',
  },
} as const;
export type VideoId = keyof typeof VIDEOS;

const clock = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

/**
 * A video player in a panel over the game (the HUD still shows behind it): the title, the date
 * and a line of context; play and pause, the time, a seek bar, volume, captions, full screen;
 * and a button to skip (or close). Keyboard: Space/K play, ←/→ 5 s, M mute, C captions, F full
 * screen. Keys stay in the player (the game's shortcuts do not fire behind it).
 */
export function VideoPlayer({
  id,
  onDone,
  doneLabel,
  onBack,
  doneAtEnd = false,
}: {
  id: VideoId;
  /** Skip / close. */
  onDone: () => void;
  doneLabel: string;
  onBack?: () => void;
  /** Go on by itself when the video ends (the landing intro). */
  doneAtEnd?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const v = VIDEOS[id];
  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [cc, setCc] = useState(i18n.language !== 'en');
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    // Starting with sound needs the page to have been clicked (the button that opened it was).
    el.play().catch(() => setBlocked(true));
  }, []);
  useEffect(() => {
    const track = video.current?.textTracks[0];
    if (track) track.mode = cc ? 'showing' : 'hidden';
  }, [cc, duration]);

  const toggle = () => {
    const el = video.current;
    if (!el) return;
    setBlocked(false);
    if (el.paused) void el.play();
    else el.pause();
  };
  const seek = (to: number) => {
    const el = video.current;
    if (el) el.currentTime = Math.max(0, Math.min(el.duration || 0, to));
  };
  const setVol = (x: number) => {
    const el = video.current;
    if (!el) return;
    el.volume = x;
    el.muted = x === 0;
  };
  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void frame.current?.requestFullscreen?.().catch(() => {});
  };
  const onKey = (e: ReactKeyboardEvent) => {
    const k = e.code;
    const handled = ['Space', 'KeyK', 'ArrowLeft', 'ArrowRight', 'KeyM', 'KeyC', 'KeyF'];
    // The game's own shortcuts listen on the window: keep the keys here.
    e.stopPropagation();
    if (!handled.includes(k)) return;
    // Space on a focused button presses it: leave it to the button.
    if (k === 'Space' && (e.target as HTMLElement).tagName === 'BUTTON') return;
    e.preventDefault();
    if (k === 'Space' || k === 'KeyK') toggle();
    else if (k === 'ArrowLeft') seek(time - 5);
    else if (k === 'ArrowRight') seek(time + 5);
    else if (k === 'KeyM') setVol(muted ? volume || 1 : 0);
    else if (k === 'KeyC') setCc(!cc);
    else fullscreen();
  };

  const pct = duration ? (time / duration) * 100 : 0;
  return (
    <div className="game-video-veil">
      <section
        className="game-video"
        role="dialog"
        aria-modal="true"
        aria-labelledby="game-video-title"
        onKeyDown={onKey}
      >
        {onBack && (
          <button type="button" className="game-video-back" onClick={onBack}>
            ← {t('game.video.back')}
          </button>
        )}
        <h2 id="game-video-title">{t(`game.video.${v.key}.title`)}</h2>
        <p className="game-video-date">{t(`game.video.${v.key}.date`)}</p>
        <p className="game-video-context">{t(`game.video.${v.key}.context`)}</p>
        <div className="game-video-frame" ref={frame}>
          <video
            ref={video}
            src={dataUrl(`${v.src}?v=${DATA_VERSION}`)}
            playsInline
            preload="auto"
            onClick={toggle}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            onVolumeChange={(e) => {
              setVolume(e.currentTarget.volume);
              setMuted(e.currentTarget.muted);
            }}
            onEnded={() => {
              setPlaying(false);
              if (doneAtEnd) onDone();
            }}
          >
            <track
              kind="captions"
              src={dataUrl(`${v.captions}?v=${DATA_VERSION}`)}
              srcLang="en"
              label="English"
            />
          </video>
          <button type="button" className="game-video-skip" autoFocus onClick={onDone}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d={doneAtEnd ? "M3 3l5 5-5 5M8.5 3l5 5-5 5" : "M4 4l8 8M12 4l-8 8"} />
            </svg>
            {doneLabel}
          </button>
          {blocked && (
            <button type="button" className="game-video-big-play" onClick={toggle}>
              {t('game.video.play')}
            </button>
          )}
          <div className="game-video-controls">
            <button
              type="button"
              className="game-video-btn"
              aria-label={playing ? t('game.video.pause') : t('game.video.play')}
              title={playing ? t('game.video.pause') : t('game.video.play')}
              onClick={toggle}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                {playing ? <path d="M5 3v10M11 3v10" /> : <path d="M4.5 2.5l9 5.5-9 5.5z" className="is-fill" />}
              </svg>
            </button>
            <span className="game-video-time">
              {clock(time)} / {clock(duration)}
            </span>
            <input
              type="range"
              className="game-video-seek"
              min={0}
              max={duration || 0}
              step={0.1}
              value={time}
              aria-label={t('game.video.seek')}
              style={{ ['--pct' as string]: `${pct}%` }}
              onChange={(e) => seek(Number(e.target.value))}
            />
            <button
              type="button"
              className="game-video-btn"
              aria-label={muted ? t('game.video.unmute') : t('game.video.mute')}
              title={muted ? t('game.video.unmute') : t('game.video.mute')}
              onClick={() => setVol(muted ? volume || 1 : 0)}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M2.5 6h2.5l3.5-3v10L5 10H2.5z" className="is-fill" />
                {muted ? <path d="M11 6l4 4M15 6l-4 4" /> : <path d="M11 5.5c1.2 1.4 1.2 3.6 0 5M12.8 3.8c2.2 2.4 2.2 6 0 8.4" />}
              </svg>
            </button>
            <input
              type="range"
              className="game-video-volume"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              aria-label={t('game.video.volume')}
              style={{ ['--pct' as string]: `${(muted ? 0 : volume) * 100}%` }}
              onChange={(e) => setVol(Number(e.target.value))}
            />
            <button
              type="button"
              className={`game-video-btn game-video-cc ${cc ? 'is-on' : ''}`}
              aria-pressed={cc}
              aria-label={t('game.video.captions')}
              title={t('game.video.captions')}
              onClick={() => setCc(!cc)}
            >
              CC
            </button>
            <button
              type="button"
              className="game-video-btn"
              aria-label={t('game.video.fullscreen')}
              title={t('game.video.fullscreen')}
              onClick={fullscreen}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />
              </svg>
            </button>
          </div>
        </div>
        <p className="game-video-credit">{t('game.video.credit')}</p>
      </section>
    </div>
  );
}

