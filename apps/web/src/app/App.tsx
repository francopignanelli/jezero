import type { ComponentType, SVGProps } from 'react';
import { useTranslation } from 'react-i18next';
import { AssistantDock } from '../features/assistant/AssistantDock';
import { EnvironmentPanel } from '../features/environment/EnvironmentPanel';
import { ExplorePanel } from '../features/exploration/ExplorePanel';
import { LayersPanel } from '../features/layers/LayersPanel';
import { MissionsPanel } from '../features/missions/MissionsPanel';
import { RoutePanel } from '../features/routes/RoutePanel';
import { SciencePanel } from '../features/science/SciencePanel';
import { MarsCanvas } from '../render/MarsCanvas';
import { IconFolder, IconGlobe, IconLayers, IconRoute, IconScience, IconSun } from '../ui/icons';
import { LoadingScreen } from './LoadingScreen';
import { TopBar } from './TopBar';
import { useApp, type Tab } from './store';

const TABS: Array<{ id: Tab; icon: ComponentType<SVGProps<SVGSVGElement>>; panel: ComponentType }> = [
  { id: 'explore', icon: IconGlobe, panel: ExplorePanel },
  { id: 'layers', icon: IconLayers, panel: LayersPanel },
  { id: 'route', icon: IconRoute, panel: RoutePanel },
  { id: 'science', icon: IconScience, panel: SciencePanel },
  { id: 'environment', icon: IconSun, panel: EnvironmentPanel },
  { id: 'missions', icon: IconFolder, panel: MissionsPanel },
];

export function App() {
  const { t } = useTranslation();
  const tab = useApp((s) => s.tab);
  const setTab = useApp((s) => s.setTab);
  const picking = useApp((s) => s.picking);
  const Panel = TABS.find((x) => x.id === tab)!.panel;

  return (
    <div className="app">
      <a className="skip-link" href="#panel">
        {t('app.skipToMain')}
      </a>
      <TopBar />
      <nav className="rail" aria-label={t('nav.label')}>
        <div role="tablist" aria-orientation="vertical" style={{ display: 'contents' }}>
          {TABS.map(({ id, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`tab-${id}`}
              aria-selected={tab === id}
              aria-controls="panel"
              onClick={() => setTab(id)}
            >
              <Icon />
              {t(`nav.${id}`)}
            </button>
          ))}
        </div>
      </nav>
      <main id="panel" className="panel" role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={-1}>
        <Panel />
      </main>
      <div className="canvas-area">
        <MarsCanvas />
        {picking && (
          <div className="picking-banner" role="status">
            {t('route.picking')}
          </div>
        )}
        <p className="notice">{t('app.prototypeNotice')}</p>
        <AssistantDock />
      </div>
      <LoadingScreen />
    </div>
  );
}
