import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../app/store';
import { IconGlobe, IconRoute, IconScience } from '../../ui/icons';

const WELCOMED_KEY = 'copernico.welcomed';

function alreadyWelcomed(): boolean {
  try {
    return window.localStorage.getItem(WELCOMED_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberWelcomed(): void {
  try {
    window.localStorage.setItem(WELCOMED_KEY, '1');
  } catch {
    /* storage unavailable: the welcome shows again next visit */
  }
}

/** First-visit welcome: what Copernico is, in plain words, and an offer to take the guided tour. */
export function Welcome() {
  const { t } = useTranslation();
  const open = useApp((s) => s.welcomeOpen);
  const setOpen = useApp((s) => s.setWelcomeOpen);
  const sceneReady = useApp((s) => s.sceneReady);
  const startTour = useApp((s) => s.setTourStep);
  const openGlossary = useApp((s) => s.openGlossary);
  const primary = useRef<HTMLButtonElement>(null);

  // Show once, after the scene has loaded, unless a shared mission link is being opened.
  useEffect(() => {
    if (sceneReady && !alreadyWelcomed() && !window.location.hash.startsWith('#m=')) setOpen(true);
  }, [sceneReady, setOpen]);

  useEffect(() => {
    if (!open) return;
    primary.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!open) return null;
  const close = () => {
    rememberWelcomed();
    setOpen(false);
  };

  const cards = [
    { icon: IconGlobe, key: 'explore' },
    { icon: IconRoute, key: 'plan' },
    { icon: IconScience, key: 'science' },
  ] as const;

  return (
    <div className="welcome-backdrop">
      <div className="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
        <p className="welcome-kicker">{t('welcome.kicker')}</p>
        <h2 id="welcome-title">{t('welcome.title')}</h2>
        <p className="welcome-lede">{t('welcome.lede')}</p>
        <ul className="welcome-cards">
          {cards.map(({ icon: Icon, key }) => (
            <li key={key}>
              <Icon />
              <strong>{t(`welcome.cards.${key}.title`)}</strong>
              <span>{t(`welcome.cards.${key}.body`)}</span>
            </li>
          ))}
        </ul>
        <div className="welcome-actions">
          <button
            ref={primary}
            type="button"
            className="btn btn-primary"
            onClick={() => {
              close();
              startTour(0);
            }}
          >
            {t('welcome.tour')}
          </button>
          <button type="button" className="btn" onClick={close}>
            {t('welcome.explore')}
          </button>
        </div>
        <p className="meta">
          {t('welcome.later')}{' '}
          <button
            type="button"
            className="link"
            onClick={() => {
              close();
              openGlossary();
            }}
          >
            {t('welcome.glossary')}
          </button>
        </p>
        <p className="meta">{t('app.prototypeNotice')}</p>
      </div>
    </div>
  );
}
