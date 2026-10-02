import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../app/store';
import { IconX } from '../../ui/icons';
import { TOUR } from './steps';

const DONE_KEY = 'copernico.tourDone';
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
  const [box, setBox] = useState<Box | null>(null);
  const [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardSize, setCardSize] = useState({ w: 340, h: 220 });
  const step = stepIndex === null ? null : (TOUR[stepIndex] ?? null);
  const last = stepIndex === TOUR.length - 1;

  const end = () => {
    setStep(null);
    try {
      window.localStorage.setItem(DONE_KEY, '1');
    } catch {
      /* storage unavailable */
    }
  };
  const go = (delta: 1 | -1) => {
    if (stepIndex === null) return;
    const next = stepIndex + delta;
    if (next < 0) return;
    if (next >= TOUR.length) end();
    else setStep(next);
  };

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
      else if (e.key === 'ArrowRight' && (e.target as HTMLElement).tagName !== 'INPUT') go(1);
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
            {t('tour.stepOf', { n: stepIndex + 1, total: TOUR.length })}
          </span>
          <button
            type="button"
            className="popover-close"
            aria-label={t('tour.close')}
            onClick={end}
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
            <span key={s.id} className={i === stepIndex ? 'on' : i < stepIndex ? 'done' : ''} />
          ))}
        </div>
        <div className="tour-actions">
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
            {last ? t('tour.finish') : t('tour.next')}
          </button>
        </div>
      </div>
    </div>
  );
}
