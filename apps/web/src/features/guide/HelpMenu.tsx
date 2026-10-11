import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../app/store';
import { TRY_ITEMS, useTried } from './tried';
import { CHAPTERS, chapterStart, TOUR } from './steps';
import { RESUME_KEY } from './Tour';

function resumeAt(): number | null {
  try {
    const v = Number(window.localStorage.getItem(RESUME_KEY));
    return Number.isInteger(v) && v > 0 && v < TOUR.length ? v : null;
  } catch {
    return null;
  }
}

/**
 * "?" in the top bar: the tour (from the start, resumed, or one chapter), "Things to try", the
 * hands-free demo, the glossary and the welcome screen.
 */
export function HelpMenu() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const startTour = useApp((s) => s.setTourStep);
  const setAuto = useApp((s) => s.setTourAuto);
  const openGlossary = useApp((s) => s.openGlossary);
  const setWelcome = useApp((s) => s.setWelcomeOpen);
  const openChecklist = useApp((s) => s.setChecklistOpen);
  const tried = useTried();
  const root = useRef<HTMLDivElement>(null);
  const resume = open ? resumeAt() : null;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  const tour = (step: number, auto = false) => {
    setAuto(auto);
    startTour(step);
  };
  const remaining = TRY_ITEMS.length - tried.size;

  return (
    <div className="help-menu" ref={root}>
      <button
        type="button"
        className="help-button"
        data-tour="help"
        aria-label={t('help.label')}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(!open)}
      >
        ?{remaining > 0 && <span className="help-dot" aria-hidden="true" />}
      </button>
      {open && (
        <div className="menu-items help-items" role="menu">
          {resume !== null && (
            <button type="button" role="menuitem" onClick={pick(() => tour(resume))}>
              {t('help.resume', {
                chapter: t(`nav.${TOUR[resume]!.chapter}`),
                n: TOUR.filter((s, i) => s.chapter === TOUR[resume]!.chapter && i <= resume).length,
              })}
            </button>
          )}
          <button type="button" role="menuitem" onClick={pick(() => tour(0))}>
            {t('help.tour')}
          </button>
          <div className="menu-label" aria-hidden="true">
            {t('help.chapters')}
          </div>
          <div className="menu-chips">
            {CHAPTERS.map((c) => (
              <button
                key={c}
                type="button"
                role="menuitem"
                aria-label={t('help.chapter', { chapter: t(`nav.${c}`) })}
                onClick={pick(() => tour(chapterStart(c)))}
              >
                {t(`nav.${c}`)}
              </button>
            ))}
          </div>
          <button type="button" role="menuitem" onClick={pick(() => openChecklist(true))}>
            {t('help.checklist', { done: tried.size, total: TRY_ITEMS.length })}
          </button>
          <button type="button" role="menuitem" onClick={pick(() => tour(0, true))}>
            {t('help.demo')}
          </button>
          <hr />
          <button type="button" role="menuitem" onClick={pick(() => openGlossary())}>
            {t('help.glossary')}
          </button>
          <button type="button" role="menuitem" onClick={pick(() => setWelcome(true))}>
            {t('help.about')}
          </button>
        </div>
      )}
    </div>
  );
}
