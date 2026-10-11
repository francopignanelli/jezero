import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../app/store';
import { IconCheck, IconX } from '../../ui/icons';
import { TRY_ITEMS, useTried } from './tried';
import { stepIndex } from './steps';

/** "Things to try": every main feature, ticked once used, each with "Show me" (its tour step). */
export function Checklist() {
  const { t } = useTranslation();
  const open = useApp((s) => s.checklistOpen);
  const setOpen = useApp((s) => s.setChecklistOpen);
  const startTour = useApp((s) => s.setTourStep);
  const setAuto = useApp((s) => s.setTourAuto);
  const tried = useTried();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;
  return (
    <div className="checklist" role="dialog" aria-modal="false" aria-labelledby="checklist-title">
      <div className="checklist-head">
        <h2 id="checklist-title">{t('checklist.title')}</h2>
        <button
          ref={closeRef}
          type="button"
          className="popover-close"
          aria-label={t('checklist.close')}
          onClick={() => setOpen(false)}
        >
          <IconX />
        </button>
      </div>
      <p className="meta">
        {t('checklist.progress', { done: tried.size, total: TRY_ITEMS.length })}
      </p>
      <div className="checklist-bar" aria-hidden="true">
        <span style={{ transform: `scaleX(${tried.size / TRY_ITEMS.length})` }} />
      </div>
      <ul>
        {TRY_ITEMS.map(({ id, step }) => {
          const done = tried.has(id);
          return (
            <li key={id} data-done={done}>
              <span className="checklist-tick" aria-hidden="true">
                {done && <IconCheck width={13} height={13} />}
              </span>
              <span className="checklist-text">
                {t(`checklist.items.${id}`)}
                <span className="visually-hidden">
                  {done ? t('checklist.done') : t('checklist.todo')}
                </span>
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setOpen(false);
                  setAuto(false);
                  startTour(stepIndex(step));
                }}
              >
                {t('checklist.show')}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
