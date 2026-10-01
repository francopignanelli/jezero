import { m2020Sol, mars24, marsYear, solarPosition } from '@copernico/domain';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { JEZERO } from '../config';
import { LANGUAGES } from '../i18n';
import { formatHours } from '../lib/format';
import { useApp } from './store';

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function TopBar() {
  const { t, i18n } = useTranslation();
  const mode = useApp((s) => s.mode);
  const now = useNow(30_000);
  const s = mars24(now);
  const sun = solarPosition(now, JEZERO);

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <span>{t('app.name')}</span>
      </div>
      <nav aria-label="Breadcrumb">
        <ol className="breadcrumb">
          <li aria-current={mode === 'orbit' ? 'location' : undefined}>{t('breadcrumb.mars')}</li>
          {mode === 'jezero' && (
            <>
              <li>{t('breadcrumb.jezero')}</li>
              <li aria-current="location">{t('breadcrumb.operational')}</li>
            </>
          )}
        </ol>
      </nav>
      <div className="topbar-spacer" />
      <div className="time-chip" title={t('status.calculated')}>
        <span className="tag tag-calculated">{t('environment.kinds.calculated')}</span>
        <span>
          <b>{t('status.sol', { sol: m2020Sol(now) })}</b>
        </span>
        <span className="hide-sm">{t('status.ls', { ls: s.lsDeg.toFixed(1) })}</span>
        <span className="hide-sm">{t('status.marsYear', { my: marsYear(s) })}</span>
        <span className="hide-sm">{t('status.ltst', { time: formatHours(sun.ltstHours) })}</span>
      </div>
      <div className="lang-switch" role="group" aria-label="Language / Idioma">
        {LANGUAGES.map((lng) => (
          <button key={lng} type="button" aria-pressed={i18n.language === lng} onClick={() => void i18n.changeLanguage(lng)}>
            {lng.toUpperCase()}
          </button>
        ))}
      </div>
    </header>
  );
}
