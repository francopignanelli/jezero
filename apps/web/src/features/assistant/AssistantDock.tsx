import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from './Avatar';

/**
 * Collapsible assistant corner. The Gemini gateway is not connected yet (milestone M8), so the
 * panel states that plainly and never pretends to answer.
 */
export function AssistantDock() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="assistant">
      {open && (
        <div className="assistant-panel" role="dialog" aria-labelledby="assistant-title">
          <div className="card-title">
            <span id="assistant-title">{t('assistant.title')}</span>
            <span className="tag tag-out">{t('assistant.notConnected')}</span>
          </div>
          <p className="lede" role="status">
            {t('assistant.disabled')}
          </p>
          <label className="field">
            <span className="visually-hidden">{t('assistant.placeholder')}</span>
            <input disabled placeholder={t('assistant.placeholder')} />
          </label>
        </div>
      )}
      <button
        type="button"
        className="assistant-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? t('assistant.close') : t('assistant.open')}
      >
        <Avatar state="disabled" />
        {t('assistant.title')}
      </button>
    </div>
  );
}
