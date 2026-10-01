import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { IconX } from '../ui/icons';
import { useApp } from './store';

/** Short status messages (saved, link copied, shared mission opened). Info auto-hides after 6 s. */
export function Toast() {
  const { t } = useTranslation();
  const notice = useApp((s) => s.notice);
  const setNotice = useApp((s) => s.setNotice);
  useEffect(() => {
    if (notice?.kind !== 'info') return;
    const id = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(id);
  }, [notice, setNotice]);
  if (!notice) return null;
  return (
    <div
      className={`toast toast-${notice.kind}`}
      role={notice.kind === 'error' ? 'alert' : 'status'}
    >
      <span>{notice.text}</span>
      <button
        type="button"
        className="notice-close"
        aria-label={t('app.dismissNotice')}
        onClick={() => setNotice(null)}
      >
        <IconX />
      </button>
    </div>
  );
}
