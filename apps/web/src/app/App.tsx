import type { ComponentType, SVGProps } from 'react';
import { useTranslation } from 'react-i18next';
import { AssistantDock } from '../features/assistant/AssistantDock';
import { EnvironmentPanel } from '../features/environment/EnvironmentPanel';
import { ExplorePanel } from '../features/exploration/ExplorePanel';
import { InspectorCard } from '../features/inspector/InspectorCard';
import { LayersControl } from '../features/layers/LayersControl';
import { MapLegend } from '../features/layers/Legends';
import { MissionsPanel } from '../features/missions/MissionsPanel';
import { RoutePanel } from '../features/routes/RoutePanel';
import { SciencePanel } from '../features/science/SciencePanel';
import { FEATURES } from '../config';
import { MarsCanvas } from '../render/MarsCanvas';
import { IconFolder, IconGlobe, IconRoute, IconScience, IconSun, IconX } from '../ui/icons';
import { LoadingScreen } from './LoadingScreen';
import { PrototypeNotice } from './PrototypeNotice';
import { TopBar } from './TopBar';
import { useApp, type Tab } from './store';

const ALL_TABS: Array<{
  id: Tab;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  panel: ComponentType;
}> = [
  { id: 'explore', icon: IconGlobe, panel: ExplorePanel },
  { id: 'route', icon: IconRoute, panel: RoutePanel },
  { id: 'science', icon: IconScience, panel: SciencePanel },
  { id: 'environment', icon: IconSun, panel: EnvironmentPanel },
  { id: 'missions', icon: IconFolder, panel: MissionsPanel },
];
const TABS = ALL_TABS.filter((x) => x.id !== 'missions' || FEATURES.missions);

export function App() {
  const { t } = useTranslation();
  const tab = useApp((s) => s.tab);
  const setTab = useApp((s) => s.setTab);
  const panelOpen = useApp((s) => s.panelOpen);
  const setPanelOpen = useApp((s) => s.setPanelOpen);
  const picking = useApp((s) => s.picking);
  const Panel = (TABS.find((x) => x.id === tab) ?? TABS[0]!).panel;

  return (
    <div className="app" data-panel={panelOpen ? 'open' : 'closed'}>
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
              title={tab === id && panelOpen ? t('nav.hidePanel') : undefined}
              // Selecting the open tab again hides the panel and gives the map the full width.
              onClick={() => (tab === id && panelOpen ? setPanelOpen(false) : setTab(id))}
            >
              <Icon />
              {t(`nav.${id}`)}
            </button>
          ))}
        </div>
      </nav>
      <main
        id="panel"
        className="panel"
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
        tabIndex={-1}
      >
        <button
          type="button"
          className="panel-close"
          aria-label={t('nav.hidePanel')}
          onClick={() => setPanelOpen(false)}
        >
          <IconX />
        </button>
        <Panel />
      </main>
      <div className="canvas-area">
        <MarsCanvas />
        <LayersControl />
        <MapLegend />
        <InspectorCard />
        {picking && (
          <div className="picking-banner" role="status">
            {t('route.picking')}
          </div>
        )}
        <PrototypeNotice />
        {FEATURES.assistant && <AssistantDock />}
      </div>
      <LoadingScreen />
    </div>
  );
}
