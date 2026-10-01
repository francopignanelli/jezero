import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../app/store';
import { LAYERS, type LayerDef } from '../../data/layers';
import { IconInfo } from '../../ui/icons';
import { ProvenanceDialog } from './ProvenanceDialog';

const GROUPS = ['imagery', 'terrain', 'science', 'surface'] as const;

/** Layer list with provenance; rendered inside the map's Layers popover. */
export function LayersList() {
  const { t } = useTranslation();
  const layers = useApp((s) => s.layers);
  const setLayer = useApp((s) => s.setLayer);
  const gridStatus = useApp((s) => s.gridStatus);
  const [about, setAbout] = useState<LayerDef | null>(null);

  return (
    <section aria-labelledby="layers-title">
      <h2 id="layers-title">{t('layers.title')}</h2>
      <p className="lede">{t('layers.intro')}</p>
      {GROUPS.map((group) => (
        <div key={group}>
          <h3>{t(`layers.groups.${group}`)}</h3>
          {LAYERS.filter((l) => l.group === group).map((l) => {
            const needsGrid = l.kind === 'overlay' && gridStatus !== 'ready';
            const id = `layer-${l.id}`;
            return (
              <div key={l.id} className="layer-row">
                <input
                  id={id}
                  type="checkbox"
                  checked={layers[l.id]}
                  onChange={(e) => setLayer(l.id, e.target.checked)}
                  disabled={needsGrid}
                  aria-describedby={needsGrid ? `${id}-note` : undefined}
                />
                <label htmlFor={id}>
                  <span
                    className="swatch"
                    style={{
                      background: l.swatch,
                      display: 'inline-block',
                      marginRight: 8,
                      verticalAlign: 'middle',
                    }}
                  />
                  {t(`layers.items.${l.id}`)}
                  {needsGrid && (
                    <span id={`${id}-note`} className="meta" style={{ display: 'block' }}>
                      {t('layers.loadGridFirst')}
                    </span>
                  )}
                </label>
                <button
                  type="button"
                  className="btn btn-ghost btn-icon"
                  onClick={() => setAbout(l)}
                  aria-label={`${t('layers.about')}: ${t(`layers.items.${l.id}`)}`}
                >
                  <IconInfo width={18} height={18} />
                </button>
              </div>
            );
          })}
        </div>
      ))}
      <ProvenanceDialog layer={about} onClose={() => setAbout(null)} />
    </section>
  );
}
