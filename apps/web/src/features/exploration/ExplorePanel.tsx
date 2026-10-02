import { useTranslation } from 'react-i18next';
import { useApp } from '../../app/store';
import { MISSIONS } from '../../data/catalog';
import { loadGuidedMarswalk } from './guided';

export function ExplorePanel() {
  const { t } = useTranslation();
  const mode = useApp((s) => s.mode);
  const setMode = useApp((s) => s.setMode);
  const loadGuided = loadGuidedMarswalk;

  return (
    <section aria-labelledby="explore-title">
      <h2 id="explore-title">{t('explore.title')}</h2>
      <p className="lede">{t('explore.intro')}</p>
      <div className="btn-row">
        {mode === 'orbit' ? (
          <button
            type="button"
            className="btn btn-primary"
            data-tour="explore-jezero"
            onClick={() => setMode('jezero')}
          >
            {t('explore.exploreJezero')}
          </button>
        ) : (
          <button type="button" className="btn" onClick={() => setMode('orbit')}>
            {t('explore.backToOrbit')}
          </button>
        )}
      </div>

      <ol className="steps">
        <li>{t('explore.steps.one')}</li>
        <li>{t('explore.steps.two')}</li>
        <li>{t('explore.steps.three')}</li>
        <li>{t('explore.steps.four')}</li>
      </ol>

      <div className="card">
        <div className="card-title">{t('explore.guided')}</div>
        <p className="lede">{t('explore.guidedDescription')}</p>
        <button type="button" className="btn" data-tour="guided" onClick={loadGuided}>
          {t('explore.startGuided')}
        </button>
      </div>

      <h3>{t('explore.coverage')}</h3>
      <p className="lede">{t('explore.coverageNote')}</p>

      <h3>{t('explore.missions')}</h3>
      <ul className="lede">
        {MISSIONS.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
      <p className="meta">{t('app.prototypeNotice')}</p>
    </section>
  );
}
