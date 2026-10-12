import type { ComponentType, SVGProps } from 'react';
import { useTranslation } from 'react-i18next';
import { AssistantDock } from '../features/assistant/AssistantDock';
import { EnvironmentPanel } from '../features/environment/EnvironmentPanel';
import { MarsPanel } from '../features/exploration/MarsPanel';
import { Checklist } from '../features/guide/Checklist';
import { Glossary } from '../features/guide/Glossary';
import { Tour } from '../features/guide/Tour';
import { TourTravel } from '../features/panorama/PanoramaTour';
import { PanoramaViewer } from '../features/panorama/PanoramaViewer';
import { PanoramasPanel } from '../features/panorama/PanoramasPanel';
import { Welcome } from '../features/guide/Welcome';
import { InspectorCard } from '../features/inspector/InspectorCard';
import { LayersControl } from '../features/layers/LayersControl';
import { ViewControl } from '../features/view/ViewControl';
import { SimulateButton, WalkHud } from '../features/routes/WalkHud';
import { MapLegend } from '../features/layers/Legends';
import { useShareLinkLoader } from '../features/missions/MissionControls';
import { RoutePanel } from '../features/routes/RoutePanel';
import { SurfacePanel } from '../features/science/SurfacePanel';
import { FEATURES } from '../config';
import { MarsCanvas } from '../render/MarsCanvas';
import { Icon360, IconGlobe, IconRoute, IconSun, IconSurface, IconX } from '../ui/icons';
import { LoadingScreen } from './LoadingScreen';
import { PrototypeNotice } from './PrototypeNotice';
import { Toast } from './Toast';
import { TopBar } from './TopBar';
import { useApp, type Tab } from './store';

const TABS: Array<{
  id: Tab;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  panel: ComponentType;
}> = [
  { id: 'mars', icon: IconGlobe, panel: MarsPanel },
  { id: 'surface', icon: IconSurface, panel: SurfacePanel },
  { id: 'panoramas', icon: Icon360, panel: PanoramasPanel },
  { id: 'marswalk', icon: IconRoute, panel: RoutePanel },
  { id: 'conditions', icon: IconSun, panel: EnvironmentPanel },
];

export function App() {
  const { t } = useTranslation();
  const tab = useApp((s) => s.tab);
  const goTo = useApp((s) => s.goTo);
  const panelOpen = useApp((s) => s.panelOpen);
  const setPanelOpen = useApp((s) => s.setPanelOpen);
  const picking = useApp((s) => s.picking);
  useShareLinkLoader();
  const Panel = (TABS.find((x) => x.id === tab) ?? TABS[0]!).panel;

  return (
    <div className="app" data-panel={panelOpen ? 'open' : 'closed'}>
      <a className="skip-link" href="#panel">
        {t('app.skipToMain')}
      </a>
      <TopBar />
      <nav className="rail" aria-label={t('nav.label')} data-tour="tabs">
        <div role="tablist" aria-orientation="vertical" style={{ display: 'contents' }}>
          {TABS.map(({ id, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              data-tour={`tab-${id}`}
              id={`tab-${id}`}
              aria-selected={tab === id}
              aria-controls="panel"
              title={tab === id && panelOpen ? t('nav.hidePanel') : undefined}
              // Selecting the open tab again hides the panel and gives the map the full width;
              // another tab also takes the camera to its place (orbit for Mars, Jezero otherwise).
              onClick={() => (tab === id && panelOpen ? setPanelOpen(false) : goTo(id))}
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
      <div className="canvas-area" data-tour="map">
        <MarsCanvas />
        <LayersControl />
        <ViewControl />
        <MapLegend />
        <WalkHud />
        <SimulateButton />
        <InspectorCard />
        <Toast />
        {picking && (
          <div className="picking-banner" role="status">
            {t('route.picking')}
          </div>
        )}
        <PrototypeNotice />
        {FEATURES.assistant && <AssistantDock />}
      </div>
      <LoadingScreen />
      <Welcome />
      <Tour />
      <Glossary />
      <Checklist />
      <PanoramaViewer />
      <TourTravel />
    </div>
  );
}
