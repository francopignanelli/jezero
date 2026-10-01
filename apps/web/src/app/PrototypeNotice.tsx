import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconX } from '../ui/icons';

const KEY = 'copernico.noticeDismissed';

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** Compact, dismissible disclaimer chip on the canvas. The full text also lives in Explore and route results. */
export function PrototypeNotice() {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(readDismissed);
  if (dismissed) return null;
  return (
    <p className="notice">
      <span>{t('app.prototypeShort')}</span>
      <button
        type="button"
        className="notice-close"
        aria-label={t('app.dismissNotice')}
        title={t('app.dismissNotice')}
        onClick={() => {
          setDismissed(true);
          try {
            window.localStorage.setItem(KEY, '1');
          } catch {
            /* storage unavailable: dismiss for this session only */
          }
        }}
      >
        <IconX />
      </button>
    </p>
  );
}
