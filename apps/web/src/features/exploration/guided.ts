import { useApp } from '../../app/store';
import { GUIDED_MISSION, POIS } from '../../data/catalog';

/** Loads the guided Marswalk (landing site → Three Forks → Hawksbill Gap → back) into the planner. */
export function loadGuidedMarswalk(): void {
  const s = useApp.getState();
  const byId = new Map(POIS.map((p) => [p.id, p]));
  s.setWaypoints(
    GUIDED_MISSION.waypoints.map((id) => {
      const p = byId.get(id)!;
      return { lat: p.lat, lon: p.lon, label: p.name, poiId: p.id };
    }),
  );
  s.setReturnToStart(GUIDED_MISSION.returnToStart);
  if (s.mode !== 'jezero') s.setMode('jezero');
  s.setTab('route');
}
