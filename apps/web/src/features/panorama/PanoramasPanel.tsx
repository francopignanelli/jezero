import { useTranslation } from 'react-i18next';
import { useApp } from '../../app/store';
import { dataUrl, DATA_VERSION } from '../../config';
import { PANORAMAS, type Panorama } from '../../data/catalog';
import { startTour, TOUR } from './PanoramaTour';

/**
 * 360° tab: the real Mastcam-Z panoramas in mission order, each a card that opens it, and the
 * auto-tour that flies from one to the next.
 */
export function PanoramasPanel() {
  const { t, i18n } = useTranslation();
  const open = useApp((s) => s.setPanoramaOpen);
  const card = (p: Panorama, i: number) => (
    <li key={p.id}>
      <button type="button" className="pano-card" onClick={() => open(p.id)}>
        <img
          src={dataUrl(`${p.file.replace('_8k.webp', '_thumb.webp')}?v=${DATA_VERSION}`)}
          alt=""
          loading="lazy"
          decoding="async"
          width={480}
          height={160}
          onError={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')}
        />
        <span className="pano-card-text">
          <strong>
            <span className="pano-card-n" aria-hidden="true">
              {i + 1}
            </span>
            {p.title}
          </strong>
          <span>
            {t('surface.panoSol', {
              sol: p.sols[0],
              date: new Date(p.date).toLocaleDateString(i18n.language, {
                year: 'numeric',
                month: 'short',
              }),
            })}
          </span>
        </span>
      </button>
    </li>
  );
  return (
    <section aria-labelledby="panoramas-title" data-tour="panoramas">
      <h2 id="panoramas-title">{t('surface.panoramas', { count: PANORAMAS.length })}</h2>
      <p className="lede">{t('panoramasTab.intro')}</p>
      <button type="button" className="btn btn-primary btn-block" onClick={() => startTour()}>
        {t('panorama.tour.startAll', { count: PANORAMAS.length })}
      </button>
      <p className="meta">{t('surface.panoramasNote')}</p>
      <ul className="pano-cards pano-cards-wide">{TOUR.map(card)}</ul>
    </section>
  );
}
