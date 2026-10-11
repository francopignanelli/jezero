import { useApp } from '../../app/store';
import { loadRover } from '../../data/surfaceData';

/** Close-up of the 3D Perseverance at its latest published position. */
export async function flyToRover(): Promise<void> {
  const rover = await loadRover();
  if (!rover) return;
  const s = useApp.getState();
  if (s.mode !== 'jezero') s.setMode('jezero');
  s.flyTo(rover.latest.lat, rover.latest.lon, {
    heightM: rover.latest.elevationM, // target at its published elevation above the areoid
    model: 'roverModel',
    // Three-quarter front view (the rover faces ~157°): at ~24 m the 3 m rover fills a useful part
    // of the view and the 25 cm HiRISE ground still reads as terrain.
    rangeM: 24,
    headingDeg: 297,
  });
}
