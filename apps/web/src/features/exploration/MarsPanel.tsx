import type { ComponentType, SVGProps } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp, type Tab } from '../../app/store';
import { MISSIONS } from '../../data/catalog';
import { Icon360, IconRoute, IconSun, IconSurface } from '../../ui/icons';

/** What each of the other tabs is for, so every part of the app can be reached from here. */
const NEXT: Array<{ tab: Tab; icon: ComponentType<SVGProps<SVGSVGElement>> }> = [
  { tab: 'surface', icon: IconSurface },
  { tab: 'panoramas', icon: Icon360 },
  { tab: 'marswalk', icon: IconRoute },
  { tab: 'conditions', icon: IconSun },
];

/** Mars tab: the planet from orbit, why Jezero, and the way into it. */
export function MarsPanel() {
  const { t } = useTranslation();
  const goTo = useApp((s) => s.goTo);

  return (
    <section aria-labelledby="mars-title">
      <h2 id="mars-title">{t('explore.title')}</h2>
      <p className="lede">{t('explore.intro')}</p>
      <div className="btn-row">
        <button
          type="button"
          className="btn btn-primary"
          data-tour="explore-jezero"
          onClick={() => goTo('surface')}
        >
          {t('explore.exploreJezero')}
        </button>
      </div>

      <div className="card why-jezero">
        <div className="card-title">{t('explore.whyTitle')}</div>
        <p className="lede">{t('explore.why')}</p>
      </div>

      <h3>{t('explore.nextTitle')}</h3>
      <ul className="next-tabs" data-tour="next-tabs">
        {NEXT.map(({ tab, icon: Icon }) => (
          <li key={tab}>
            <button type="button" className="next-tab" onClick={() => goTo(tab)}>
              <Icon />
              <span>
                <strong>{t(`nav.${tab}`)}</strong>
                <span>{t(`explore.next.${tab}`)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>

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
