import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconLayers, IconX } from '../../ui/icons';
import { LayersList } from './LayersList';

/**
 * Layers as a map control (top-right of the canvas) instead of a tab: a non-modal popover with the
 * layer list and provenance. Escape or the close button dismisses it and returns focus to the button.
 */
export function LayersControl() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    popover.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      // The provenance <dialog> handles its own Escape first.
      if (e.key === 'Escape' && !document.querySelector('dialog[open]')) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="layers-control">
      <button
        ref={button}
        type="button"
        className="map-button"
        aria-expanded={open}
        aria-controls="layers-popover"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <IconLayers />
        <span>{t('nav.layers')}</span>
      </button>
      {open && (
        <div
          ref={popover}
          id="layers-popover"
          className="layers-popover"
          role="dialog"
          aria-labelledby="layers-title"
          tabIndex={-1}
        >
          <button
            type="button"
            className="popover-close"
            aria-label={t('layers.close')}
            onClick={close}
          >
            <IconX />
          </button>
          <LayersList />
        </div>
      )}
    </div>
  );
}
