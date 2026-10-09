import { greatCircleDistance } from '@copernico/domain';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../app/store';
import { PANORAMAS, type Panorama } from '../../data/catalog';
import { formatDistance } from '../../lib/format';
import { buildTrack, pointAt } from '../../lib/routeTrack';
import { roundTrack, simplify } from '../../render/pathGeometry';
import { currentScene } from '../../render/sceneRegistry';
import { solText, useMissionData } from './PanoramaHud';

/** Panoramas in mission order: the tour visits them along the traverse. */
export const TOUR = [...PANORAMAS].sort((a, b) => a.sols[0] - b.sols[0]);

/** Seconds spent looking around each panorama, and the pan speed (° per second). */
export const TOUR_STAY_S = 14;
export const TOUR_PAN_DEG_S = 8;

/** Starts the tour at a panorama (or at the first one), looking around it. */
export function startTour(fromId?: string): void {
  const i = Math.max(
    0,
    TOUR.findIndex((p) => p.id === fromId),
  );
  const s = useApp.getState();
  s.setPanelOpen(false); // the drives between stops use the whole map
  s.setTour({ index: i, phase: 'view', paused: false });
  s.setPanoramaOpen(TOUR[i]!.id);
}

/** Drone camera for the drives: behind and above the rover position, looking ahead. */
const DRONE = { rangeM: 1_100, pitchDeg: -30 };

function legPath(
  from: Panorama,
  to: Panorama,
  waypoints: Array<[number, number, number, number, number]>,
) {
  const inner = waypoints
    .filter((w) => w[0] > from.sols[0] && w[0] <= to.sols[0])
    .map((w) => ({ lat: w[1], lon: w[2] }));
  const raw = [from.position, ...inner, to.position].map((p) => ({ lat: p.lat, lon: p.lon }));
  // Display smoothing only (corners within ~25 m): the camera glides instead of jerking.
  return roundTrack(simplify(raw, 15), 25);
}

/**
 * The travel phase of the auto-tour: the viewer has faded out facing the next stop, and the 3D map
 * flies a drone camera along Perseverance's real traverse between the two panoramas (draped on the
 * terrain), with a caption; then the next panorama opens facing the direction of travel. Any map
 * input stops the tour where it is.
 */
export function TourTravel() {
  const { t, i18n } = useTranslation();
  const tour = useApp((s) => s.tour);
  const { rover } = useMissionData();
  const [veil, setVeil] = useState(true);
  const legRef = useRef<{ from: Panorama; to: Panorama; km: number } | null>(null);

  const travelling = tour?.phase === 'travel';
  const from = travelling ? TOUR[tour.index] : undefined;
  const to = travelling ? TOUR[tour.index + 1] : undefined;

  useEffect(() => {
    if (!travelling || !from || !to) return;
    const scene = currentScene();
    const { setTour, setPanoramaOpen } = useApp.getState();
    if (!scene) {
      setTour(null);
      return;
    }
    let cancelled = false;
    let stop = () => {};
    setVeil(true);
    void (async () => {
      const points = legPath(from, to, rover?.waypoints ?? []);
      const heights = await scene.sampleTerrain(points);
      if (cancelled) return;
      const track = buildTrack(
        points.map((p, i) => ({ ...p, heightM: Number.isFinite(heights[i]!) ? heights[i]! : 0 })),
      );
      legRef.current = { from, to, km: track.totalM };
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const seconds = Math.min(10, Math.max(5, 3.5 + (track.totalM / 1000) * 0.9));
      const sample = (f: number) => ({
        at: pointAt(track, f * track.totalM),
        ahead: pointAt(track, Math.min(track.totalM, f * track.totalM + 250)),
      });
      // Start behind the first stop, let the tiles arrive under the veil, then reveal and fly.
      const first = sample(0);
      scene.lookAlong(first.at, first.ahead, DRONE);
      await scene.whenTilesLoaded(3_000);
      if (cancelled) return;
      setVeil(false);
      let completed = true;
      if (!reduced) {
        const run = scene.playPath(sample, seconds, () => {}, DRONE);
        stop = run.stop;
        completed = await run.done;
      } else {
        await new Promise((r) => window.setTimeout(r, 1200));
      }
      if (cancelled) return;
      if (!completed) {
        setTour(null); // the user took the controls
        return;
      }
      setVeil(true);
      await new Promise((r) => window.setTimeout(r, reduced ? 0 : 600));
      if (cancelled) return;
      setTour({ index: TOUR.indexOf(to), phase: 'view', paused: false });
      setPanoramaOpen(to.id);
    })();
    return () => {
      cancelled = true;
      stop();
    };
    // The leg is fully described by the stop index.
  }, [travelling, tour?.index, rover]);

  if (!travelling || !from || !to) return null;
  const leg = legRef.current?.to === to ? legRef.current : null;
  return (
    <>
      <div className={`tour-veil${veil ? ' is-on' : ''}`} aria-hidden="true" />
      <div className="tour-caption" role="status">
        <p className="tour-caption-kicker">
          {t('panorama.tour.driving', { n: TOUR.indexOf(to) + 1, total: TOUR.length })}
        </p>
        <p className="tour-caption-title">{to.title}</p>
        <p className="tour-caption-meta">
          {t('panorama.hud.sol')} {solText(from)} → {solText(to)}
          {leg ? ` · ${formatDistance(leg.km, i18n.language)} ${t('panorama.tour.driven')}` : ''}
          {' · '}
          {formatDistance(greatCircleDistance(from.position, to.position), i18n.language)}{' '}
          {t('panorama.tour.direct')}
        </p>
        <button type="button" className="tour-stop" onClick={() => useApp.getState().setTour(null)}>
          {t('panorama.tour.stop')}
        </button>
      </div>
    </>
  );
}
