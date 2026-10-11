import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../app/store';
import { IconX } from '../../ui/icons';
import { TOUR } from './steps';

const DONE_KEY = 'copernico.tourDone';
/** Step to resume from when the tour was closed part-way. */
export const RESUME_KEY = 'copernico.tourAt';
const store = {
  set(key: string, value: string | null) {
    try {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch {
      /* storage unavailable */
    }
  },
};
/** Demo mode: reading time for a step (ms) from the length of its text. */
const readingMs = (text: string) => Math.min(9_000, Math.max(5_000, 2_500 + 25 * text.length));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const anchor = (id: string) => document.querySelector<HTMLElement>(`[data-tour="${id}"]`);

async function waitForAnchor(id: string, timeoutMs = 8000): Promise<HTMLElement | null> {
  const t0 = performance.now();
  for (;;) {
    const el = anchor(id);
    if (el && el.getClientRects().length > 0) return el;
    if (performance.now() - t0 > timeoutMs) return null;
    await sleep(100);
  }
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Where the card goes: beside the target if there is room, otherwise below/above, else centred. */
function placeCard(target: Box | null, card: { w: number; h: number }): React.CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const m = 12;
  if (vw < 820) {
    // Phones: dock at the top, or at the bottom when the target sits in the upper half.
    const lowTarget = !target || target.top > vh * 0.45;
    return lowTarget ? { top: 56, left: m, right: m } : { bottom: 76, left: m, right: m };
  }
  if (!target) return { top: Math.max(m, (vh - card.h) / 2), left: Math.max(m, (vw - card.w) / 2) };
  const clampTop = (t: number) => Math.min(Math.max(t, 60), vh - card.h - m);
  const clampLeft = (l: number) => Math.min(Math.max(l, m), vw - card.w - m);
  // Large targets (the map): put the card inside, top-left corner.
  if (target.width > vw * 0.5 && target.height > vh * 0.5) {
    return { top: clampTop(target.top + 16), left: clampLeft(target.left + 16) };
  }
  if (target.left + target.width + 16 + card.w < vw - m) {
    return { top: clampTop(target.top), left: target.left + target.width + 16 };
  }
  if (target.left - 16 - card.w > m)
    return { top: clampTop(target.top), left: target.left - 16 - card.w };
  if (target.top + target.height + 12 + card.h < vh - m) {
    return { top: target.top + target.height + 12, left: clampLeft(target.left) };
  }
  return { top: Math.max(m, target.top - 12 - card.h), left: clampLeft(target.left) };
}

/**
 * Guided tour overlay. The highlighted element stays interactive (the dimmed backdrop is a shadow,
 * not a blocking layer), so users can follow along or let the tour do each step for them.
 */
export function Tour() {
  const { t } = useTranslation();
  const stepIndex = useApp((s) => s.tourStep);
  const setStep = useApp((s) => s.setTourStep);
  const auto = useApp((s) => s.tourAuto);
  const setAuto = useApp((s) => s.setTourAuto);
  const sceneReady = useApp((s) => s.sceneReady);
  const [paused, setPaused] = useState(false);
  const [box, setBox] = useState<Box | null>(null);
  const [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardSize, setCardSize] = useState({ w: 340, h: 220 });
  const step = stepIndex === null ? null : (TOUR[stepIndex] ?? null);
  const last = stepIndex === TOUR.length - 1;
  const inChapter = step ? TOUR.filter((x) => x.chapter === step.chapter) : [];
  const nextStep = stepIndex === null ? undefined : TOUR[stepIndex + 1];
  const chapterEnds = Boolean(step && nextStep && nextStep.chapter !== step.chapter);
  const dwellMs = step
    ? (step.demoMs ??
      readingMs(`${t(`tour.steps.${step.id}.title`)} ${t(`tour.steps.${step.id}.body`)}`))
    : 0;

  /** Closing part-way remembers the step (Help → Resume); finishing clears it. */
  const end = (finished = false) => {
    if (finished || last) {
      store.set(DONE_KEY, '1');
      store.set(RESUME_KEY, null);
    } else if (stepIndex !== null) store.set(RESUME_KEY, String(stepIndex));
    setStep(null);
    setAuto(false);
    setPaused(false);
  };
  const go = (delta: 1 | -1) => {
    if (stepIndex === null) return;
    const next = stepIndex + delta;
    if (next < 0) return;
    if (next >= TOUR.length) end(true);
    else setStep(next);
  };

  // A recording or presentation link (?demo) plays the whole tour hands-free once loaded.
  useEffect(() => {
    if (!sceneReady || !new URLSearchParams(window.location.search).has('demo')) return;
    setAuto(true);
    setStep(0);
  }, [sceneReady, setAuto, setStep]);

  // Enter a step: prepare the app, let the map settle, wait for the anchor, bring it into view.
  useEffect(() => {
    if (!step) return;
    let cancelled = false;
    setReady(false);
    setBox(null);
    void (async () => {
      await step.prepare?.();
      if (step.settleMs && !reducedMotion()) await sleep(step.settleMs);
      const el = step.target ? await waitForAnchor(step.target) : null;
      if (cancelled) return;
      el?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [step]);

  // Follow the anchor (panels scroll, the window resizes, the map flies).
  useEffect(() => {
    if (!step?.target) return;
    const update = () => {
      const el = anchor(step.target!);
      const r = el?.getBoundingClientRect();
      setBox(
        r && r.width > 0 ? { top: r.top, left: r.left, width: r.width, height: r.height } : null,
      );
    };
    update();
    const id = window.setInterval(update, 150);
    return () => window.clearInterval(id);
  }, [step]);

  // Demo mode: do the step's action, give time to read, then move on.
  useEffect(() => {
    if (!auto || paused || !ready || !step) return;
    let cancelled = false;
    let timer = 0;
    void (async () => {
      if (step.action) {
        setRunning(true);
        try {
          await step.action();
        } finally {
          setRunning(false);
        }
      }
      if (cancelled) return;
      timer = window.setTimeout(() => !cancelled && go(1), dwellMs);
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // go/t change identity every render; the step, readiness and pause decide.
  }, [auto, paused, ready, step]);

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (el) setCardSize({ w: el.offsetWidth, h: el.offsetHeight });
  }, [step, ready]);

  // Keyboard: Esc closes, arrows move between steps; focus moves to the card on each step.
  useEffect(() => {
    if (!step) return;
    cardRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') end();
      else if (auto && e.key === ' ') {
        e.preventDefault();
        setPaused((p) => !p);
      } else if (e.key === 'ArrowRight' && (e.target as HTMLElement).tagName !== 'INPUT') go(1);
      else if (e.key === 'ArrowLeft' && (e.target as HTMLElement).tagName !== 'INPUT') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!step || stepIndex === null) return null;
  const pad = 6;
  const doIt = async () => {
    if (!step.action) return;
    setRunning(true);
    try {
      await step.action();
    } finally {
      setRunning(false);
    }
    go(1);
  };

  return (
    <div className="tour" aria-live="polite">
      {box && ready && (
        <div
          className="tour-spotlight"
          aria-hidden="true"
          style={{
            top: box.top - pad,
            left: box.left - pad,
            width: box.width + 2 * pad,
            height: box.height + 2 * pad,
          }}
        />
      )}
      {!step.target && <div className="tour-backdrop" aria-hidden="true" />}
      <div
        ref={cardRef}
        className="tour-card"
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        tabIndex={-1}
        style={placeCard(box && ready ? box : null, cardSize)}
      >
        <div className="tour-head">
          <span className="tour-count">
            {auto && <span className="tour-demo">{t('tour.demo')}</span>}
            {t(`nav.${step.chapter}`)} ·{' '}
            {t('tour.stepOf', { n: inChapter.indexOf(step) + 1, total: inChapter.length })}
          </span>
          <button
            type="button"
            className="popover-close"
            aria-label={t('tour.close')}
            onClick={() => end()}
          >
            <IconX />
          </button>
        </div>
        <h2 id="tour-title">{t(`tour.steps.${step.id}.title`)}</h2>
        <div id="tour-body" className="tour-body">
          {String(t(`tour.steps.${step.id}.body`))
            .split('\n')
            .map((p, i) => (
              <p key={i}>{p}</p>
            ))}
        </div>
        {!ready && step.target && <p className="meta">{t('tour.preparing')}</p>}
        <div className="tour-progress" aria-hidden="true">
          {TOUR.map((s, i) => (
            <span
              key={s.id}
              className={[
                i === stepIndex ? 'on' : i < stepIndex ? 'done' : '',
                i > 0 && TOUR[i - 1]!.chapter !== s.chapter ? 'chapter-start' : '',
              ].join(' ')}
            />
          ))}
        </div>
        {auto && !paused && ready && !running && (
          <div
            className="tour-timer"
            key={stepIndex}
            aria-hidden="true"
            style={{ animationDuration: `${dwellMs}ms` }}
          />
        )}
        <div className="tour-actions">
          {auto && (
            <button
              type="button"
              className="btn btn-sm"
              aria-pressed={paused}
              onClick={() => setPaused(!paused)}
            >
              {paused ? t('tour.resume') : t('tour.pause')}
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => go(-1)}
            disabled={stepIndex === 0}
          >
            {t('tour.back')}
          </button>
          <span className="tour-spacer" />
          {step.action && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void doIt()}
              disabled={running || !ready}
            >
              {running ? t('tour.working') : t('tour.doIt')}
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => go(1)}
            disabled={running}
          >
            {last
              ? t('tour.finish')
              : chapterEnds && nextStep
                ? t('tour.nextChapter', { chapter: t(`nav.${nextStep.chapter}`) })
                : t('tour.next')}
          </button>
        </div>
      </div>
    </div>
  );
}
