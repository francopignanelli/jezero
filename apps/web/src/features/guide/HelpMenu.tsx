import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../app/store';

/** "?" in the top bar: restart the guided tour, open the glossary, or see the welcome again. */
export function HelpMenu() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const startTour = useApp((s) => s.setTourStep);
  const openGlossary = useApp((s) => s.openGlossary);
  const setWelcome = useApp((s) => s.setWelcomeOpen);
  const root = useRef<HTMLDivElement>(null);

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
        ?
      </button>
      {open && (
        <div className="menu-items help-items" role="menu">
          <button type="button" role="menuitem" onClick={pick(() => startTour(0))}>
            {t('help.tour')}
          </button>
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
