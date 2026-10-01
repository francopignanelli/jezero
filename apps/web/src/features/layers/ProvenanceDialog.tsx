import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { datasetById } from '../../data/catalog';
import type { LayerDef } from '../../data/layers';

/** Source, date, resolution, units, CRS, datum, uncertainty and license for a layer's datasets. */
export function ProvenanceDialog({ layer, onClose }: { layer: LayerDef | null; onClose: () => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (layer && !d.open) d.showModal();
    if (!layer && d.open) d.close();
  }, [layer]);

  return (
    <dialog ref={ref} className="provenance" onClose={onClose} aria-labelledby="prov-title">
      {layer && (
        <>
          <h2 id="prov-title">{t(`layers.items.${layer.id}`)}</h2>
          {layer.derivation && (
            <p className="lede">
              {t('provenance.derived')} {layer.derivation}
            </p>
          )}
          {layer.datasets.map((id) => {
            const d = datasetById(id);
            if (!d) return null;
            return (
              <dl key={id}>
                <dt>{t('provenance.mission')}</dt>
                <dd>{d.mission}</dd>
                <dt>{t('provenance.instrument')}</dt>
                <dd>{d.instrument}</dd>
                <dt>{t('provenance.product')}</dt>
                <dd>{d.productId}</dd>
                <dt>{t('provenance.published')}</dt>
                <dd>{d.published}</dd>
                {d.resolution && (
                  <>
                    <dt>{t('provenance.resolution')}</dt>
                    <dd>
                      {d.resolution.value} {d.resolution.unit}
                    </dd>
                  </>
                )}
                <dt>{t('provenance.units')}</dt>
                <dd>{d.units}</dd>
                <dt>{t('provenance.crs')}</dt>
                <dd>{d.crs}</dd>
                {d.verticalDatum && (
                  <>
                    <dt>{t('provenance.datum')}</dt>
                    <dd>{d.verticalDatum}</dd>
                  </>
                )}
                <dt>{t('provenance.uncertainty')}</dt>
                <dd>{d.uncertainty}</dd>
                <dt>{t('provenance.license')}</dt>
                <dd>{d.license}</dd>
                <dt>{t('provenance.citation')}</dt>
                <dd>{d.citation}</dd>
                <dt>{t('provenance.source')}</dt>
                <dd>
                  <a href={d.landingPage} target="_blank" rel="noreferrer noopener" style={{ color: 'var(--info)' }}>
                    {d.publisher}
                  </a>
                </dd>
              </dl>
            );
          })}
          <div className="btn-row">
            <button type="button" className="btn" onClick={onClose} autoFocus>
              {t('provenance.close')}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
