import { DEFAULT_EVA_PARAMS, type RouteResult } from '@copernico/domain';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp, type LayerId } from '../app/store';
import { DATA_VERSION, JEZERO_OPERATIONAL_VIEW, dataUrl } from '../config';
import { PANORAMAS, POIS, panoramaForPoi } from '../data/catalog';
import { MARS_FEATURES } from '../data/marsFeatures';
import {
  loadCoverage,
  loadCrism,
  loadImageryLayer,
  loadIngenuity,
  loadRover,
  loadSamples,
  loadTraverse,
} from '../data/surfaceData';
import { ensureGrid } from '../features/routes/ensureGrid';
import { routingClient } from '../features/routes/routingClient';
import type { OverlayKind } from '../features/routes/overlays';
import { arrowsAlong, buildTrack, pointAt, slopeRuns, type Track } from '../lib/routeTrack';
import type { Annotation } from './annotations';
import { walkControls, walkFeed } from '../features/routes/walkFeed';
import { registerScene } from './sceneRegistry';
import type { Tint } from './tint';
import { MarsScene, type LayerGrade, type LineSpec, type LonLatRect } from './marsScene';
import { densify, removeSpikes, roundTrack, simplify, type LatLonPoint } from './pathGeometry';
import { smoothstep } from '../lib/math';

/**
 * Imagery tiers, bottom to top. `toggle` is the layer-panel switch that controls the tier. The
 * Viking 232 m regional pyramid sharpens the descent from orbit; the colour wash re-uses it over
 * the greyscale CTX/HiRISE tiers (see marsScene.fadeImageryTiers).
 */
/**
 * Grade for the Viking colorized mosaics: warmer (hue toward orange) and moderately saturated, with a
 * little more contrast so albedo features read as in true-colour views of Mars from orbit, without the
 * exaggerated blue of the raw colorization. Colours remain illustrative, as the provenance card states.
 */
const VIKING_GRADE = { saturation: 0.82, hue: 0.09, gamma: 1.0, brightness: 1.08, contrast: 1.18 };
/** The colour wash only adds regional hue variation over the tinted CTX/HiRISE. */
const WASH_GRADE = { saturation: 0.8, hue: 0.06, gamma: 1.0, brightness: 1.1, contrast: 1.0 };
/**
 * CTX and HiRISE are greyscale. They are multiplied by the average ground colour of the Mastcam-Z
 * panorama PIA26699 (R:G:B ≈ 148:100:65, natural colour) so the surface reads as Mars without
 * blurring the detail. Approximate colour; the brightness lift offsets the multiply.
 */
const GROUND_TINT: Tint = [1, 0.676, 0.439];
const TINTED_GRADE: LayerGrade = { brightness: 1.25 };
const IMAGERY: Array<{
  id: string;
  toggle: LayerId;
  credit: string;
  tiles?: string;
  rectangle?: LonLatRect;
  grade?: LayerGrade;
  tint?: Tint;
}> = [
  {
    id: 'viking',
    toggle: 'viking',
    credit: 'NASA/USGS Viking Orbiter colorized mosaic',
    grade: VIKING_GRADE,
  },
  {
    id: 'viking-hd',
    toggle: 'viking',
    credit: 'NASA/USGS Viking MDIM 2.1 colorized mosaic (232 m)',
    grade: VIKING_GRADE,
  },
  {
    id: 'ctx',
    toggle: 'ctx',
    credit: 'NASA/JPL/MSSS/USGS CTX (Mars 2020 science investigation mosaic)',
    tint: GROUND_TINT,
    grade: TINTED_GRADE,
  },
  {
    id: 'hirise',
    toggle: 'hirise',
    credit: 'NASA/JPL/University of Arizona/USGS HiRISE (Mars 2020 TRN orthomosaic)',
    tint: GROUND_TINT,
    grade: TINTED_GRADE,
  },
  {
    // The crater rim west of the TRN mosaic (Witch Hazel Hill, Crocodile Bridge), tone-matched to it.
    id: 'hirise-west',
    toggle: 'hirise',
    credit: 'NASA/JPL/University of Arizona HiRISE ESP_085859_1985 (2024-11-19)',
    tint: GROUND_TINT,
    grade: TINTED_GRADE,
  },
  {
    id: 'hirise-rover',
    toggle: 'hirise',
    credit: 'NASA/JPL/University of Arizona HiRISE ESP_085859_1985 (2024-11-19)',
    tint: GROUND_TINT,
    grade: TINTED_GRADE,
  },
  {
    id: 'colour-wash',
    toggle: 'viking',
    tiles: 'viking-hd',
    credit: 'Colour from the Viking MDIM 2.1 mosaic over CTX/HiRISE (approximate)',
    rectangle: { west: 77.0, south: 17.6, east: 78.58, north: 19.28 },
    grade: WASH_GRADE,
  },
];
const OVERLAYS: OverlayKind[] = ['slope', 'elevation', 'thermalInertia'];
/** Reach bands: every hour up to the EVA limit minus ingress (7.5 h with eva-params@1). */
const REACH_MAX_H = DEFAULT_EVA_PARAMS.evaCapHours - DEFAULT_EVA_PARAMS.ingressHours;
export const REACH_BANDS_H = [
  ...Array.from({ length: Math.floor(REACH_MAX_H) }, (_, i) => i + 1),
  ...(REACH_MAX_H % 1 ? [REACH_MAX_H] : []),
];
/** Crater-scale rectangle used to dim terrain outside route-planning coverage. */
const CRATER_RECT: LonLatRect = { west: 77.0, south: 17.6, east: 78.58, north: 19.28 };
/** Jezero centre and label (USGS Gazetteer). */
/** Jezero crater centre (IAU Gazetteer). */
const JEZERO_LABEL = { lat: 18.38, lon: 77.58 };

export function MarsCanvas() {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<MarsScene | null>(null);
  const [failed, setFailed] = useState(false);
  const [gridRect, setGridRect] = useState<LonLatRect | null>(null);
  const overlaysBuilt = useRef(new Set<OverlayKind>());
  /** Drawn primary route (for the profile cursor) and the result the camera last framed. */
  const trackRef = useRef<{ track: Track; profileTotalM: number } | null>(null);
  const framedRef = useRef<unknown>(null);

  const mode = useApp((s) => s.mode);
  const layers = useApp((s) => s.layers);
  const waypoints = useApp((s) => s.waypoints);
  const result = useApp((s) => s.result);
  const profile = useApp((s) => s.profile);
  const picking = useApp((s) => s.picking);
  const evaStart = useApp((s) => s.evaStartUtcMs);
  const flyRequest = useApp((s) => s.flyRequest);
  const sceneReady = useApp((s) => s.sceneReady);
  const routeCursorM = useApp((s) => s.routeCursorM);
  const inspected = useApp((s) => s.inspected);
  const playRequest = useApp((s) => s.playRequest);
  const slopeColours = useApp((s) => s.routeSlopeColours);
  const crismComposite = useApp((s) => s.crismComposite);

  // Create the scene once and load everything the first view needs before revealing it.
  useEffect(() => {
    if (!host.current) return;
    let scene: MarsScene;
    try {
      scene = new MarsScene(host.current);
    } catch {
      setFailed(true);
      useApp.getState().setSceneReady(true);
      return;
    }
    sceneRef.current = scene;
    registerScene(scene);
    if (import.meta.env.DEV) (window as unknown as { __copernico?: MarsScene }).__copernico = scene;
    const { setLoading, setSceneReady } = useApp.getState();
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    scene.setReducedMotion(media.matches);
    const onMotion = (e: MediaQueryListEvent) => scene.setReducedMotion(e.matches);
    media.addEventListener('change', onMotion);
    scene.setSunTime(useApp.getState().evaStartUtcMs);

    scene.onPick((lat, lon, entityId) => {
      const s = useApp.getState();
      if (s.picking) {
        s.addWaypoint({ lat, lon });
        return;
      }
      // A science marker opens its card; any other click in Jezero inspects the terrain there.
      if (entityId?.startsWith('pois:')) {
        s.selectPoi(entityId.slice('pois:'.length));
        s.setTab('surface');
        return;
      }
      if (s.mode === 'jezero') s.setInspected({ lat, lon });
    });

    // The 8K Milky Way waits until the scene is revealed: it must not slow the first tiles.
    let revealed = () => {};
    const shown = new Promise<void>((r) => (revealed = r));
    const sky = scene
      .loadSky(
        dataUrl(`sky/stars.json?v=${DATA_VERSION}`),
        {
          hd: dataUrl(`sky/milkyway_8k.webp?v=${DATA_VERSION}`),
          sd: dataUrl(`sky/milkyway_4k.webp?v=${DATA_VERSION}`),
        },
        (quality) => {
          if (quality === 'hd') setLoading({ sky: 'hd' });
        },
        shown,
      )
      .then((r) =>
        setLoading({
          stars: r.stars ? 'done' : 'failed',
          sky: r.quality === 'none' ? 'failed' : r.quality,
        }),
      );

    const globe = (async () => {
      const terrainOk = await scene.loadTerrain(dataUrl('tiles/terrain'), DATA_VERSION);
      setLoading({ terrain: terrainOk ? 'done' : 'failed' });
      let imageryOk = true;
      // Layer metadata in parallel; layers are still added in IMAGERY order (it is the draw order).
      const metas = await Promise.all(IMAGERY.map((l) => loadImageryLayer(l.tiles ?? l.id)));
      if (scene.isDestroyed()) return;
      for (const [i, { id, toggle, credit, tiles, rectangle, grade, tint }] of IMAGERY.entries()) {
        const meta = metas[i];
        if (!meta) {
          imageryOk = false;
          continue;
        }
        scene.addTiledLayer({
          id,
          url: dataUrl(`tiles/imagery/${tiles ?? id}/{z}/{x}/{y}.webp?v=${DATA_VERSION}`),
          rectangle: rectangle ?? meta.rectangle,
          minLevel: meta.minLevel,
          maxLevel: meta.maxLevel,
          credit,
          ...(grade ? { grade } : {}),
          ...(tint ? { tint } : {}),
        });
        scene.setLayerVisible(id, useApp.getState().layers[toggle]);
      }
      setLoading({ imagery: imageryOk ? 'done' : 'failed' });
      const tilesOk = await scene.whenTilesLoaded();
      setLoading({ tiles: tilesOk ? 'done' : 'failed' });
    })();

    const surface = loadSurfaceLayers(scene, shown).then(
      () => setLoading({ surface: 'done' }),
      (error: unknown) => {
        console.error('[Copernico] surface data failed', error);
        setLoading({ surface: 'failed' });
      },
    );

    // Reveal when everything is in (or after a generous timeout; the loading screen explains).
    const timeout = new Promise((r) => window.setTimeout(r, 30_000));
    void Promise.race([Promise.all([sky, globe, surface]), timeout]).then(() => {
      if (scene.isDestroyed()) return; // a discarded scene loads nothing more
      setSceneReady(true);
      revealed();
    });

    return () => {
      media.removeEventListener('change', onMotion);
      registerScene(null);
      scene.destroy();
      sceneRef.current = null;
    };
  }, []);

  // Enter/leave Jezero: camera transition and lazy loading of the routing grid.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !sceneReady) return;
    if (mode === 'jezero') {
      // A fly-to requested together with entering Jezero (e.g. "Show on map") takes precedence over
      // the default operational view, which would otherwise override it.
      const fly = useApp.getState().flyRequest;
      if (!fly || Date.now() - fly.nonce > 1500) {
        const v = JEZERO_OPERATIONAL_VIEW;
        void scene.flyToTarget(
          v.lat,
          v.lon,
          v.targetHeightM,
          v.rangeM,
          v.headingDeg,
          v.pitchDeg,
          6,
        );
      }
      void ensureGrid().then((summary) => summary && setGridRect(summary.rectangle));
    } else {
      void scene.flyTo(18.44, 77.45, 9_500_000, 0, -90, 4);
    }
  }, [mode, sceneReady]);

  // Coverage boundary: dim the crater outside route-planning coverage in the operational view.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !gridRect) return;
    if (mode === 'jezero' && layers.coverage) {
      void scene.setImageOverlay('coverageMask', coverageMask(CRATER_RECT, gridRect), CRATER_RECT);
    } else {
      scene.removeLayer('coverageMask');
    }
  }, [mode, gridRect, layers.coverage]);

  // Scientific overlays are computed from the routing grid in the worker, then draped.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !gridRect) return;
    for (const kind of OVERLAYS) {
      const visible = layers[kind];
      if (visible && !overlaysBuilt.current.has(kind)) {
        overlaysBuilt.current.add(kind);
        void routingClient.overlay(kind).then((o) => {
          if (o.range) useApp.getState().setOverlayRange(kind, o.range);
          const canvas = document.createElement('canvas');
          canvas.width = o.width;
          canvas.height = o.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          ctx.putImageData(new ImageData(new Uint8ClampedArray(o.rgba), o.width, o.height), 0, 0);
          void scene.setImageOverlay(kind, canvas, gridRect).then(() => {
            scene.setLayerVisible(kind, useApp.getState().layers[kind]);
          });
        });
      } else {
        scene.setLayerVisible(kind, visible);
      }
    }
  }, [layers, gridRect]);

  // Layer visibility (vector groups and annotations share layer ids).
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    for (const [id, visible] of Object.entries(layers)) {
      if (!OVERLAYS.includes(id as OverlayKind) && id !== 'reach' && id !== 'crism')
        scene.setLayerVisible(id, visible);
    }
    scene.setLayerVisible('roverLatest', layers.rover);
    scene.setLayerVisible('roverModel', layers.rover);
    scene.setLayerVisible('viking-hd', layers.viking);
    scene.setLayerVisible('colour-wash', layers.viking && (layers.ctx || layers.hirise));
    scene.setSkyVisible(layers.sky);
  }, [layers]);

  // Waypoints: dots at exact positions + numbered badges (highest label priority).
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    void scene
      .withTerrainHeights(
        waypoints.map((w) => ({ id: w.id, lat: w.lat, lon: w.lon, color: '#3ff0c0', size: 11 })),
        2,
      )
      .then((markers) => {
        scene.setMarkers('waypoints', markers);
        scene.setAnnotations(
          'waypoints',
          markers.map((m, i): Annotation => {
            const w = waypoints[i]!;
            return {
              id: w.id,
              lat: w.lat,
              lon: w.lon,
              heightM: m.heightM,
              badge: String(i + 1),
              text: w.label ?? '',
              ...(w.poiId ? { dedupeKey: `poi:${w.poiId}` } : {}),
              kind: 'waypoint',
              priority: 100 - i,
              maxCameraDistanceM: 600_000,
            };
          }),
        );
      });
  }, [waypoints]);

  // Routes: the exact computed geometry, densified and draped on the rendered terrain. The selected
  // route becomes the focus: direction chevrons, camera framing on a new result, muted context.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const selected = profile === 'lower-risk' ? result?.lowerRisk : result?.shortest;
    const other = profile === 'lower-risk' ? result?.shortest : result?.lowerRisk;
    const lines: Array<{ route: RouteResult; style: LineSpec['style'] }> = [];
    if (other?.status === 'ok') lines.push({ route: other, style: 'route-alternative' });
    if (selected?.status === 'ok') lines.push({ route: selected, style: 'route-primary' });
    let cancelled = false;
    void (async () => {
      const specs = await Promise.all(
        lines.map(async ({ route, style }) => ({
          id: style,
          style,
          points: await drape(
            scene,
            densify(route.displayPoints ?? route.points, 12),
            style === 'route-primary' ? 2.5 : 3,
          ),
        })),
      );
      if (cancelled || scene.isDestroyed()) return;
      const primary = specs.find((l) => l.style === 'route-primary');
      if (primary && selected?.metrics && slopeColours) {
        // Casing for the whole route, then one coloured core per slope-band run.
        const runs = slopeRuns(buildTrack(primary.points), selected.metrics.profile, {
          mild: DEFAULT_EVA_PARAMS.slopeBands[0]!.upToDeg,
          moderate: DEFAULT_EVA_PARAMS.slopeBands[1]!.upToDeg,
        });
        scene.setLines('route', [
          ...specs.filter((l) => l !== primary),
          { id: 'primary-casing', style: 'route-casing', points: primary.points },
          ...runs.map((r, i) => ({
            id: `band${i}`,
            style: `route-band-${r.band}` as const,
            points: r.points,
          })),
        ]);
      } else {
        scene.setLines('route', specs);
      }
      if (primary && selected?.metrics) {
        const track = buildTrack(primary.points);
        const profileTotal = selected.metrics.profile.distanceM.at(-1) ?? track.totalM;
        trackRef.current = { track, profileTotalM: profileTotal };
        scene.setArrows('routeArrows', arrowsAlong(track, 250));
        if (framedRef.current !== result) {
          framedRef.current = result;
          void scene.flyToPath(primary.points);
        }
      } else {
        trackRef.current = null;
        scene.clearGroup('routeArrows');
        scene.clearGroup('cursor');
      }
      const focus = primary !== undefined;
      scene.restyleLines('rover', (st) =>
        st === 'traverse' || st === 'traverse-muted' ? (focus ? 'traverse-muted' : 'traverse') : st,
      );
      for (const group of ['pois', 'rover']) scene.setAnnotationsMuted(group, focus);
    })();
    return () => {
      cancelled = true;
    };
  }, [result, profile, slopeColours]);

  // Round-trip reach from the first waypoint, recomputed when the start moves.
  const start = waypoints[0];
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !gridRect) return;
    if (!layers.reach || !start) {
      scene.removeLayer('reach');
      useApp.getState().setReach(null);
      return;
    }
    let cancelled = false;
    void routingClient.reach(start.lat, start.lon, REACH_BANDS_H).then((r) => {
      if (cancelled || !r.rgba || scene.isDestroyed()) return;
      const canvas = document.createElement('canvas');
      canvas.width = r.width;
      canvas.height = r.height;
      canvas
        .getContext('2d')
        ?.putImageData(new ImageData(new Uint8ClampedArray(r.rgba), r.width, r.height), 0, 0);
      void scene.setImageOverlay('reach', canvas, gridRect);
      useApp
        .getState()
        .setReach({ bandsH: REACH_BANDS_H, areaKm2: r.areaKm2, elapsedMs: r.elapsedMs });
    });
    return () => {
      cancelled = true;
    };
  }, [layers.reach, start?.lat, start?.lon, start, gridRect]);

  // Walk simulation ("Play mission"): a crew marker walks the selected route with a glowing trail
  // and a smoothed follow camera (render/walkSim.ts); the HUD and the profile cursor follow.
  // Stops on any map input or when the request is cleared.
  useEffect(() => {
    const scene = sceneRef.current;
    const tr = trackRef.current;
    if (!scene || !tr || playRequest === null) return;
    const { setPlay, setRouteCursor, result, profile } = useApp.getState();
    const selected = profile === 'lower-risk' ? result?.lowerRisk : result?.shortest;
    setPlay(playRequest, true);
    const toTrack = tr.track.totalM / Math.max(1, tr.profileTotalM);
    let acc = 0;
    const stops = (selected?.legs ?? []).map((leg) => {
      acc += leg.horizontalDistanceM;
      return { distanceM: acc, waypoint: leg.toWaypoint };
    });
    // ~20 s plus 3.5 s per km (24–50 s): long enough to read, short enough for a demo.
    const durationS = Math.min(50, Math.max(24, 20 + 3.5 * (tr.track.totalM / 1000)));
    let last = 0;
    const run = scene.startWalk({
      track: tr.track,
      stops: stops.map((x) => x.distanceM * toTrack),
      durationS,
      onFrame: (frame) => {
        walkFeed.publish({ ...frame, toProfile: 1 / toTrack, stops });
        const now = performance.now();
        if (now - last > 50) {
          last = now;
          setRouteCursor(frame.phase === 'intro' ? null : frame.distanceM / toTrack);
        }
      },
    });
    walkControls.setPaused = run.setPaused;
    void run.done.then(() => {
      walkFeed.publish(null);
      walkControls.setPaused = () => {};
      setRouteCursor(null);
      useApp.getState().setPlay(null, false);
    });
    return () => run.stop();
  }, [playRequest]);

  // CRISM mineral-indicator composites: one draped image per observation, oldest first.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    for (const id of scene.rasterIds('crism:')) scene.removeLayer(id);
    if (!layers.crism) return;
    let cancelled = false;
    void loadCrism().then(async (m) => {
      for (const o of m?.observations ?? []) {
        const c = o.composites[crismComposite];
        if (!c || cancelled) continue;
        const img = await signalOnly(dataUrl(`crism/${c.file}?v=${DATA_VERSION}`));
        if (img && !cancelled) await scene.setImageOverlay(`crism:${o.id}`, img, o);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [layers.crism, crismComposite]);

  // Inspected point marker.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (!inspected) {
      scene.clearGroup('inspect');
      return;
    }
    void scene
      .withTerrainHeights(
        [{ id: 'inspect', lat: inspected.lat, lon: inspected.lon, color: '#ffd166', size: 12 }],
        2,
      )
      .then((m) => scene.setMarkers('inspect', m));
  }, [inspected]);

  // Leaving Jezero closes the inspector.
  useEffect(() => {
    if (mode !== 'jezero') useApp.getState().setInspected(null);
  }, [mode]);

  // Profile ↔ map: the distance under the profile cursor, shown as a marker on the 3D route.
  useEffect(() => {
    const scene = sceneRef.current;
    const tr = trackRef.current;
    if (!scene) return;
    // During the walk simulation its crew marker replaces the profile cursor.
    if (routeCursorM === null || !tr || useApp.getState().playing) {
      scene.clearGroup('cursor');
      return;
    }
    const p = pointAt(tr.track, (routeCursorM * tr.track.totalM) / Math.max(1, tr.profileTotalM));
    scene.setMarkers('cursor', [
      { id: 'cursor', lat: p.lat, lon: p.lon, heightM: p.heightM + 1, color: '#ffffff', size: 14 },
    ]);
  }, [routeCursorM]);

  useEffect(() => {
    sceneRef.current?.setSunTime(evaStart);
  }, [evaStart]);

  useEffect(() => {
    // Jezero surface is ~2.5 km below the reference sphere; look at the site from 1.8 km away.
    if (flyRequest?.model) {
      void sceneRef.current?.flyToModel(flyRequest.model, flyRequest.rangeM, flyRequest.headingDeg);
      return;
    }
    if (flyRequest)
      void sceneRef.current?.flyToTarget(
        flyRequest.lat,
        flyRequest.lon,
        flyRequest.heightM ?? -2500,
        flyRequest.rangeM ?? 1800,
        flyRequest.headingDeg ?? 0,
        flyRequest.pitchDeg ?? -40,
        3,
      );
  }, [flyRequest]);

  if (failed) {
    return (
      <div className="canvas-wrap" role="alert">
        <div className="notice" style={{ position: 'static', margin: 20 }}>
          {t('errors.webgl')}
        </div>
      </div>
    );
  }

  return (
    <div className="canvas-wrap" data-picking={picking} data-ready={sceneReady}>
      <div
        ref={host}
        className="cesium-host"
        data-mode={mode}
        aria-label={t('explore.title')}
        role="application"
      />
    </div>
  );
}

/** Rendered-terrain heights for a polyline, lifted slightly so it never z-fights the surface. */
async function drape(scene: MarsScene, points: LatLonPoint[], liftM: number) {
  const heights = await scene.sampleTerrain(points);
  return points.map((p, i) => ({
    ...p,
    heightM: (Number.isFinite(heights[i]!) ? heights[i]! : 0) + liftM,
  }));
}

/**
 * CRISM browse composite with opacity proportional to signal: the brightest channel sets alpha, so
 * weak or absent indicators let the imagery show through and strong ones stand out. Colours are the
 * published ones; non-scene pixels (alpha 0 in the PNG) stay transparent.
 */
async function signalOnly(url: string): Promise<HTMLCanvasElement | null> {
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const peak = Math.max(d[i]!, d[i + 1]!, d[i + 2]!) / 255;
    d[i + 3] = Math.round(255 * Math.min(0.9, Math.max(0, (peak - 0.12) * 1.6)));
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

/**
 * Mask over the crater outside route-planning coverage: dark and soft-edged outside, with a faint
 * warm light just inside the boundary, fading out toward the crater mosaic edge (no seam there).
 */
function coverageMask(outer: LonLatRect, inner: LonLatRect): HTMLCanvasElement {
  const w = 2048; // ≈ 46 m per pixel over the crater mosaic
  const h = Math.round((w * (outer.north - outer.south)) / (outer.east - outer.west));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const x0 = ((inner.west - outer.west) / (outer.east - outer.west)) * w;
  const x1 = ((inner.east - outer.west) / (outer.east - outer.west)) * w;
  const y0 = ((outer.north - inner.north) / (outer.north - outer.south)) * h;
  const y1 = ((outer.north - inner.south) / (outer.north - outer.south)) * h;
  const edgeFade = 0.14 * Math.min(w, h);
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Signed distance (px) to the coverage rectangle: > 0 outside, < 0 inside.
      const ox = Math.max(x0 - x, x - x1, 0);
      const oy = Math.max(y0 - y, y - y1, 0);
      const outside = Math.hypot(ox, oy);
      const inside = Math.min(x - x0, x1 - x, y - y0, y1 - y);
      const i = (y * w + x) * 4;
      if (outside > 0) {
        const toEdge = Math.min(x, w - 1 - x, y, h - 1 - y);
        // Dark from ≈ 90 m outside the line: a wider ramp made the terrain just outside look included.
        const a = 0.7 * smoothstep(0, 2, outside) * smoothstep(0, edgeFade, toEdge);
        d.set([10, 8, 7, Math.round(a * 255)], i);
      } else {
        const a = 0.16 * (1 - smoothstep(0, 50, inside));
        d.set([255, 204, 150, Math.round(a * 255)], i);
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * Surface data for the loading screen; the markers and lines are placed once the scene is shown.
 * They sit on the most detailed terrain tiles (hundreds along the ~45 km of traverse), and none of
 * them shows from orbit. Their tile requests are not throttled by Cesium, so issued earlier they
 * would queue ahead of the globe's own tiles and delay the reveal.
 */
async function loadSurfaceLayers(scene: MarsScene, shown: Promise<void>): Promise<void> {
  const [coverage, rover, traverse, samples, ingenuity] = await Promise.all([
    loadCoverage(),
    loadRover(),
    loadTraverse(),
    loadSamples(),
    loadIngenuity(),
  ]);
  if (scene.isDestroyed()) return;

  scene.setAnnotations('region', [
    {
      id: 'jezero',
      ...JEZERO_LABEL,
      heightM: -2500,
      text: 'Jezero Crater',
      kind: 'region',
      priority: 200,
      minCameraDistanceM: 350_000,
    },
  ]);
  // Context from orbit: the major named features, under Jezero (it always wins an overlap).
  scene.setAnnotations(
    'features',
    MARS_FEATURES.map((f): Annotation => ({
      id: f.id,
      lat: f.lat,
      lon: f.lon,
      heightM: f.heightM,
      text: f.name,
      kind: 'feature',
      priority: 120 - 20 * f.rank,
      minCameraDistanceM: 900_000,
    })),
  );

  void shown
    .then(async () => {
      await placeSurfaceMarkers(scene, rover, samples, ingenuity);
      await drapeSurfaceLines(scene, coverage, traverse);
    })
    .catch((error: unknown) => console.error('[Copernico] surface overlays failed', error));
}

/** Rover, panoramas, samples, places and Ingenuity flights, on the rendered terrain. */
async function placeSurfaceMarkers(
  scene: MarsScene,
  rover: Awaited<ReturnType<typeof loadRover>>,
  samples: Awaited<ReturnType<typeof loadSamples>>,
  ingenuity: Awaited<ReturnType<typeof loadIngenuity>>,
): Promise<void> {
  if (scene.isDestroyed()) return;
  // Every marker in one terrain query: they share tiles, and separate queries would each wait.
  const standalone = PANORAMAS.filter((p) => !p.poiId);
  const points: Array<{ lat: number; lon: number }> = [
    ...(rover ? [rover.latest] : []),
    ...standalone.map((p) => p.position),
    ...(samples?.samples ?? []),
    ...POIS,
    ...(ingenuity?.flights ?? []),
  ];
  const heights = await scene.sampleTerrain(points.map(({ lat, lon }) => ({ lat, lon })));
  if (scene.isDestroyed()) return;
  let k = 0;
  /** Next sampled height, lifted 2 m so markers never sink into the surface. */
  const next = () => {
    const h = heights[k++]!;
    return (Number.isFinite(h) ? h : 0) + 2;
  };

  if (rover) {
    const heightM = next();
    // 3D Perseverance at its latest published position, facing along its last drive.
    const [prev] = rover.waypoints.slice(-2);
    const heading = prev
      ? Math.atan2(
          (rover.latest.lon - prev[2]) * Math.cos((rover.latest.lat * Math.PI) / 180),
          rover.latest.lat - prev[1],
        )
      : 0;
    void scene.setModel('roverModel', {
      lat: rover.latest.lat,
      lon: rover.latest.lon,
      heightM: heightM - 2, // marker lift removed: wheels on the rendered terrain
      headingRad: heading,
      url: dataUrl(`models/perseverance.glb?v=${DATA_VERSION}`),
    });
    scene.setAnnotations('rover', [
      {
        id: 'perseverance',
        lat: rover.latest.lat,
        lon: rover.latest.lon,
        heightM,
        text: `Perseverance · sol ${rover.latest.sol}`,
        kind: 'rover',
        priority: 95, // above the panorama pin next to it
        maxCameraDistanceM: 350_000,
        minCameraDistanceM: 250, // the 3D model takes over up close
        onClick: () => useApp.getState().setTab('surface'),
      },
    ]);
  }

  // Real 360° panoramas, at the rover position where they were taken. One at a POI becomes a "360°"
  // chip on that POI's pin; the others get their own pin.
  scene.setAnnotations(
    'panoramas',
    standalone.map((p): Annotation => ({
      id: p.id,
      lat: p.position.lat,
      lon: p.position.lon,
      heightM: next(),
      text: `360° · ${p.title}`,
      kind: 'panorama',
      priority: 90,
      maxCameraDistanceM: 60_000,
      onClick: () => useApp.getState().setPanoramaOpen(p.id),
    })),
  );

  if (samples) {
    scene.setMarkers(
      'samples',
      samples.samples.map((s) => ({
        id: s.sampleNumber,
        lat: s.lat,
        lon: s.lon,
        heightM: next(),
        color: '#ff9ad5',
        size: 7,
      })),
    );
  }

  scene.setAnnotations(
    'pois',
    POIS.map((p, i): Annotation => ({
      id: p.id,
      lat: p.lat,
      lon: p.lon,
      heightM: next(),
      text: p.name,
      dedupeKey: `poi:${p.id}`,
      kind: 'poi',
      priority: 50 - i,
      maxCameraDistanceM: 140_000,
      ...(panoramaForPoi(p.id)
        ? {
            chip: {
              text: '360°',
              onClick: () => useApp.getState().setPanoramaOpen(panoramaForPoi(p.id)!.id),
            },
          }
        : {}),
      onClick: () => {
        const s = useApp.getState();
        s.selectPoi(p.id);
        s.setTab('surface');
      },
    })),
  );

  if (ingenuity) {
    scene.setMarkers(
      'ingenuity',
      ingenuity.flights.map((f) => ({
        id: String(f.flight),
        lat: f.lat,
        lon: f.lon,
        heightM: next(),
        color: '#9fe3ff',
        size: 5,
      })),
    );
  }
}

/** Coverage outline and the rover traverse, draped on the rendered terrain in one query. */
async function drapeSurfaceLines(
  scene: MarsScene,
  coverage: Awaited<ReturnType<typeof loadCoverage>>,
  traverse: Awaited<ReturnType<typeof loadTraverse>>,
): Promise<void> {
  const rings = (coverage?.features ?? []).flatMap((f) =>
    f.geometry.coordinates.map((ring) =>
      densify(
        ring.map(([lon, lat]) => ({ lat, lon })),
        40,
      ),
    ),
  );
  let near: LatLonPoint[] = [];
  let far: LatLonPoint[] = [];
  if (traverse) {
    // One continuous, display-simplified line in sol order instead of 556 overlapping drive segments.
    const drives = [...traverse.features].sort((a, b) => a.properties.sol - b.properties.sol);
    const path = drives.flatMap((f) => f.geometry.coordinates.map(([lon, lat]) => ({ lat, lon })));
    // Display only, two levels of detail: up close the track (re-localization spikes removed,
    // simplified to 6 m, corners rounded within 8 m); beyond 15 km a cleaner line (15 m / 20 m),
    // whose offsets are under ~1.5 px there.
    const base = removeSpikes(path, 25);
    near = densify(roundTrack(simplify(base, 6), 8), 20);
    far = densify(roundTrack(simplify(base, 15), 20), 50);
  }
  // A single query: the two traverse versions cross the same tiles, and parallel queries would each
  // download them.
  const heights = await scene.sampleTerrain([...rings.flat(), ...near, ...far]);
  if (scene.isDestroyed()) return;
  let k = 0;
  const lift = (pts: LatLonPoint[], liftM: number) =>
    pts.map((p) => {
      const h = heights[k++]!;
      return { ...p, heightM: (Number.isFinite(h) ? h : 0) + liftM };
    });
  const ringLines = rings.map((pts, i) => ({
    id: `ring${i}`,
    style: 'boundary' as const,
    points: lift(pts, 6),
  }));
  if (ringLines.length) scene.setLines('coverage', ringLines);
  if (!traverse) return;
  const nearPts = lift(near, 1.5);
  const farPts = lift(far, 3);
  // Cut into ~2 km pieces: Cesium judges a line's display distance from its bounding-sphere centre,
  // and the whole track is ~40 km long.
  const pieces = <T,>(pts: T[], n: number) =>
    Array.from({ length: Math.ceil((pts.length - 1) / n) }, (_, i) =>
      pts.slice(i * n, i * n + n + 1),
    );
  // A route computed meanwhile mutes the traverse (see the route effect).
  const s = useApp.getState();
  const selected = s.profile === 'lower-risk' ? s.result?.lowerRisk : s.result?.shortest;
  const style = selected?.status === 'ok' ? ('traverse-muted' as const) : ('traverse' as const);
  scene.setLines('rover', [
    ...pieces(nearPts, 100).map((points, i) => ({
      id: `traverse-${i}`,
      style,
      points,
      farM: 15_000,
    })),
    ...pieces(farPts, 40).map((points, i) => ({
      id: `traverse-far-${i}`,
      style,
      points,
      nearM: 15_000,
    })),
  ]);
}
