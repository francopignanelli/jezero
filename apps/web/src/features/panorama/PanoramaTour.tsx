import { greatCircleDistance, initialBearingDeg, normalizeLon180 } from '@copernico/domain';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../app/store';
import { PANORAMAS, type Panorama } from '../../data/catalog';
import { formatDistance } from '../../lib/format';
import { simplify } from '../../render/pathGeometry';
import { currentScene } from '../../render/sceneRegistry';
import { solText, useMissionData } from './PanoramaHud';
import { prefersReducedMotion } from '../../lib/motion';

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

/**
 * The flight between two stops is straight, like a helicopter: it takes off above the first
 * panorama, climbs over the middle and comes down looking onto the next one, keeping one heading.
 * Heights and angles favour sharp imagery: from a few hundred metres, looking down, the 0.64 m
 * HiRISE tiles are drawn near their resolution and fewer tiles have to stream in mid-flight (a
 * low, shallow view magnifies them and loads far-off terrain, which looked blurred).
 */
const FLIGHT = {
  takeOffM: 250, // camera height above the ground at the first stop
  landM: 380, // and when it arrives looking down at the next one
  landPitchDeg: 50, // the next stop is centred at this angle below the horizon on arrival
  climbPerM: 0.12, // mid-flight rise per metre covered (before terrain clearance)
  clearanceM: 120, // never closer than this to the ground on the way
  maxPeakM: 1_500,
  pitchDeg: [-30, -55] as [number, number], // shallowest and steepest view while aiming ahead
  samples: 40,
};

/** Distance Perseverance drove between two panoramas (its published waypoints), for the caption. */
function drivenM(
  from: Panorama,
  to: Panorama,
  waypoints: Array<[number, number, number, number, number]>,
): number {
  const inner = waypoints
    .filter((w) => w[0] > from.sols[0] && w[0] <= to.sols[0])
    .map((w) => ({ lat: w[1], lon: w[2] }));
  const path = simplify([from.position, ...inner, to.position], 15);
  let m = 0;
  for (let i = 1; i < path.length; i++) m += greatCircleDistance(path[i - 1]!, path[i]!);
  return m;
}

/**
 * Straight flight plan: ground heights along the line give the take-off and landing heights and the
 * mid-flight rise that keeps FLIGHT.clearanceM above every sampled point.
 */
async function planFlight(
  scene: NonNullable<ReturnType<typeof currentScene>>,
  from: Panorama,
  to: Panorama,
) {
  const a = from.position;
  const dLon = normalizeLon180(to.position.lon - a.lon);
  const n = FLIGHT.samples;
  const line = Array.from({ length: n }, (_, i) => {
    const f = i / (n - 1);
    return { lat: a.lat + (to.position.lat - a.lat) * f, lon: a.lon + dLon * f };
  });
  const raw = await scene.sampleTerrain(line);
  const ground = raw.map((h, i) => (Number.isFinite(h) ? h : (raw[i - 1] ?? 0)));
  const h0 = ground[0]! + FLIGHT.takeOffM;
  const distanceM = greatCircleDistance(a, to.position);
  // Arrive short of the next stop, so it is centred below at FLIGHT.landPitchDeg.
  const shortM = Math.min(
    0.8 * distanceM,
    FLIGHT.landM / Math.tan((FLIGHT.landPitchDeg * Math.PI) / 180),
  );
  const fEnd = distanceM > 0 ? 1 - shortM / distanceM : 1;
  const end = { lat: a.lat + (to.position.lat - a.lat) * fEnd, lon: a.lon + dLon * fEnd };
  const groundEnd = ground[Math.round(fEnd * (n - 1))]!;
  const h1 = Math.max(groundEnd, ground[n - 1]!) + FLIGHT.landM;
  let peakM = Math.max(40, FLIGHT.climbPerM * distanceM);
  // Ground samples are along the whole line; the flight covers it up to fEnd.
  for (let i = 1; i < n - 1; i++) {
    const f = i / (n - 1) / fEnd;
    if (f >= 1) break;
    const need = (ground[i]! + FLIGHT.clearanceM - (h0 + (h1 - h0) * f)) / Math.sin(Math.PI * f);
    peakM = Math.max(peakM, need);
  }
  return {
    from: { ...line[0]!, heightM: h0 },
    to: { ...end, heightM: h1 },
    aimAt: { ...to.position, heightM: ground[n - 1]! },
    headingDeg: initialBearingDeg(a, to.position), // the direction the viewer turned to
    peakM: Math.min(FLIGHT.maxPeakM, peakM),
    // ~3 s for a short hop, at most 6 s.
    seconds: Math.min(6, Math.max(3, 2.8 + (distanceM / 1000) * 0.45)),
  };
}

/**
 * The travel phase of the auto-tour: the viewer has faded out facing the next stop, and the 3D map
 * flies straight to it (see FLIGHT), with a caption; then the next panorama opens facing the
 * direction of travel. Any map input stops the tour where it is.
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
    let release = () => {};
    setVeil(true);
    void (async () => {
      legRef.current = { from, to, km: drivenM(from, to, rover?.waypoints ?? []) };
      const plan = await planFlight(scene, from, to);
      if (cancelled) return;
      const reduced = prefersReducedMotion();
      // Take off just above the first stop; the veil lifts once the tiles there have loaded.
      const run = scene.flyLine({
        ...plan,
        pitchDeg: FLIGHT.pitchDeg,
        seconds: reduced ? 0.01 : plan.seconds,
        onTakeOff: () => !cancelled && setVeil(false),
      });
      stop = run.stop;
      release = run.release;
      const completed = await run.done;
      if (reduced) await new Promise((r) => window.setTimeout(r, 1200));
      if (cancelled) return;
      if (!completed) {
        setTour(null); // the user took the controls
        return;
      }
      setVeil(true);
      await new Promise((r) => window.setTimeout(r, reduced ? 0 : 450));
      if (cancelled) return;
      setTour({ index: TOUR.indexOf(to), phase: 'view', paused: false });
      setPanoramaOpen(to.id);
      release(); // the next view now covers the map
    })();
    return () => {
      cancelled = true;
      stop();
      release();
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
