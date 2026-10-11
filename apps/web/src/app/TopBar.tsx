import { m2020Sol, mars24, solarPosition } from '@copernico/domain';
import { useTranslation } from 'react-i18next';
import { JEZERO } from '../config';
import { HelpMenu } from '../features/guide/HelpMenu';
import { LANGUAGES } from '../i18n';
import { formatHours } from '../lib/format';
import { useApp } from './store';

export function TopBar() {
  const { t, i18n } = useTranslation();
  const mode = useApp((s) => s.mode);
  const setTab = useApp((s) => s.setTab);
  const goTo = useApp((s) => s.goTo);
  // One time source for the whole app: the planned EVA start drives this chip, the scene lighting,
  // the sky and the Conditions panel. "Now" is shown only inside Conditions, labelled as such.
  const eva = useApp((s) => s.evaStartUtcMs);
  const s = mars24(eva);
  const sun = solarPosition(eva, JEZERO);

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <span className="brand-name">{t('app.name')}</span>
      </div>
      <nav aria-label="Breadcrumb">
        <ol className="breadcrumb">
          {mode === 'orbit' ? (
            <li aria-current="location">{t('breadcrumb.mars')}</li>
          ) : (
            <li>
              <button type="button" className="crumb-link" onClick={() => goTo('mars')}>
                {t('breadcrumb.mars')}
              </button>
            </li>
          )}
          {mode === 'jezero' && (
            <>
              <li>{t('breadcrumb.jezero')}</li>
              <li aria-current="location">{t('breadcrumb.operational')}</li>
            </>
          )}
        </ol>
      </nav>
      <div className="topbar-spacer" />
      <button
        type="button"
        className="time-chip"
        title={`${t('status.plannedEvaHint')} ${t('status.calculated')}`}
        onClick={() => setTab('conditions')}
      >
        <span className="tag tag-calculated">
          <span className="hide-sm">{t('status.plannedEva')}</span>
          <span className="show-sm">{t('status.plannedEvaShort')}</span>
        </span>
        <b>{t('status.sol', { sol: m2020Sol(eva) })}</b>
        <span>{t('status.ltstShort', { time: formatHours(sun.ltstHours) })}</span>
        <span className="hide-sm">{t('status.ls', { ls: s.lsDeg.toFixed(1) })}</span>
      </button>
      <HelpMenu />
      <div className="lang-switch" role="group" aria-label="Language / Idioma">
        {LANGUAGES.map((lng) => (
          <button
            key={lng}
            type="button"
            aria-pressed={i18n.language === lng}
            onClick={() => void i18n.changeLanguage(lng)}
          >
            {lng.toUpperCase()}
          </button>
        ))}
      </div>
    </header>
  );
}
