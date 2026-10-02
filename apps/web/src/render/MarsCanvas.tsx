import { DEFAULT_EVA_PARAMS, type RouteResult } from '@copernico/domain';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp, type LayerId } from '../app/store';
import { DATA_VERSION, JEZERO_OPERATIONAL_VIEW, dataUrl } from '../config';
import { POIS } from '../data/catalog';
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
import { registerScene } from './sceneRegistry';
import { MarsScene, type LineSpec, type LonLatRect } from './marsScene';
import { densify, simplify, type LatLonPoint } from './pathGeometry';

/**
 * Imagery tiers, bottom to top. `toggle` is the layer-panel switch that controls the tier. The
 * Viking 232 m regional pyramid sharpens the descent from orbit; the colour wash re-uses it over
 * the greyscale CTX/HiRISE tiers (see marsScene.fadeImageryTiers).
 */
/**
 * The Viking colorized mosaics exaggerate blue in dark basaltic regions; a mild grade (less
 * saturation, slightly warmer and brighter) reads closer to Mars as seen in natural-colour images.
 * Colours remain illustrative, as the provenance card states.
 */
const VIKING_GRADE = { saturation: 0.5, hue: 0.06, gamma: 1.05, brightness: 1.1, contrast: 1.1 };
const IMAGERY: Array<{
  id: string;
  toggle: LayerId;
  credit: string;
  tiles?: string;
  rectangle?: LonLatRect;
  grade?: typeof VIKING_GRADE;
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
  },
  {
    id: 'hirise',
    toggle: 'hirise',
    credit: 'NASA/JPL/University of Arizona/USGS HiRISE (Mars 2020 TRN orthomosaic)',
  },
  {
    id: 'colour-wash',
    toggle: 'viking',
    tiles: 'viking-hd',
    credit: 'Colour from the Viking MDIM 2.1 mosaic over CTX/HiRISE (approximate)',
    rectangle: { west: 77.0, south: 17.6, east: 78.58, north: 19.28 },
    grade: VIKING_GRADE,
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
const JEZERO_LABEL = { lat: 18.41, lon: 77.69 };

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
        s.setTab('science');
        return;
      }
      if (s.mode === 'jezero') s.setInspected({ lat, lon });
    });

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
      for (const { id, toggle, credit, tiles, rectangle, grade } of IMAGERY) {
        const meta = await loadImageryLayer(tiles ?? id);
        if (scene.isDestroyed()) return;
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
        });
        scene.setLayerVisible(id, useApp.getState().layers[toggle]);
      }
      setLoading({ imagery: imageryOk ? 'done' : 'failed' });
      const tilesOk = await scene.whenTilesLoaded();
      setLoading({ tiles: tilesOk ? 'done' : 'failed' });
    })();

    const surface = loadSurfaceLayers(scene).then(
      () => setLoading({ surface: 'done' }),
      (error: unknown) => {
        console.error('[Copernico] surface data failed', error);
        setLoading({ surface: 'failed' });
      },
    );

    // Reveal when everything is in (or after a generous timeout; the loading screen explains).
    const timeout = new Promise((r) => window.setTimeout(r, 30_000));
    void Promise.race([Promise.all([sky, globe, surface]), timeout]).then(() => {
      if (!scene.isDestroyed()) setSceneReady(true);
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
      const v = JEZERO_OPERATIONAL_VIEW;
      void scene.flyToTarget(v.lat, v.lon, v.targetHeightM, v.rangeM, v.headingDeg, v.pitchDeg, 6);
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

  // Route fly-through ("Play mission"): ~30 s regardless of route length; the profile/timeline
  // cursor follows. Stops on any map input or when the request is cleared.
  useEffect(() => {
    const scene = sceneRef.current;
    const tr = trackRef.current;
    if (!scene || !tr || playRequest === null) return;
    const { setPlay, setRouteCursor } = useApp.getState();
    setPlay(playRequest, true);
    let last = 0;
    const run = scene.playPath(
      (f) => ({
        at: pointAt(tr.track, f * tr.track.totalM),
        ahead: pointAt(tr.track, Math.min(tr.track.totalM, f * tr.track.totalM + 60)),
      }),
      30,
      (f) => {
        const now = performance.now();
        if (now - last > 66) {
          last = now;
          setRouteCursor(f * tr.profileTotalM);
        }
      },
    );
    void run.done.then(() => {
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
    if (routeCursorM === null || !tr) {
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
      <div ref={host} className="cesium-host" aria-label={t('explore.title')} role="application" />
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

/** Semi-transparent mask over the crater with a clear window for the route-planning coverage. */
function coverageMask(outer: LonLatRect, inner: LonLatRect): HTMLCanvasElement {
  const w = 1024;
  const h = Math.round((w * (outer.north - outer.south)) / (outer.east - outer.west));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(6, 8, 12, 0.5)';
  ctx.fillRect(0, 0, w, h);
  const x0 = ((inner.west - outer.west) / (outer.east - outer.west)) * w;
  const x1 = ((inner.east - outer.west) / (outer.east - outer.west)) * w;
  const y0 = ((outer.north - inner.north) / (outer.north - outer.south)) * h;
  const y1 = ((outer.north - inner.south) / (outer.north - outer.south)) * h;
  ctx.clearRect(x0, y0, x1 - x0, y1 - y0);
  return canvas;
}

async function loadSurfaceLayers(scene: MarsScene): Promise<void> {
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

  if (coverage) {
    const rings = coverage.features.flatMap((f) =>
      f.geometry.coordinates.map((ring) => ring.map(([lon, lat]) => ({ lat, lon }))),
    );
    const lines = await Promise.all(
      rings.map(async (ring, i) => ({
        id: `ring${i}`,
        style: 'boundary' as const,
        points: await drape(scene, densify(ring, 40), 6),
      })),
    );
    scene.setLines('coverage', lines);
  }

  if (traverse) {
    // One continuous, display-simplified line in sol order instead of 556 overlapping drive segments.
    const drives = [...traverse.features].sort((a, b) => a.properties.sol - b.properties.sol);
    const path = drives.flatMap((f) => f.geometry.coordinates.map(([lon, lat]) => ({ lat, lon })));
    const clean = simplify(path, 2.5);
    scene.setLines('rover', [
      { id: 'traverse', style: 'traverse', points: await drape(scene, densify(clean, 20), 1.5) },
    ]);
  }

  if (rover) {
    const [latest] = await scene.withTerrainHeights(
      [
        {
          id: 'latest',
          lat: rover.latest.lat,
          lon: rover.latest.lon,
          color: '#f2b84b',
          size: 12,
          hideWithinM: 250, // the 3D model takes over up close
        },
      ],
      2,
    );
    scene.setMarkers('roverLatest', [latest!]);
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
      heightM: latest!.heightM - 2, // marker lift removed: wheels on the rendered terrain
      headingRad: heading,
      url: dataUrl(`models/perseverance.glb?v=${DATA_VERSION}`),
    });
    scene.setAnnotations('rover', [
      {
        id: 'perseverance',
        lat: latest!.lat,
        lon: latest!.lon,
        heightM: latest!.heightM,
        text: `Perseverance · sol ${rover.latest.sol}`,
        kind: 'rover',
        priority: 80,
        maxCameraDistanceM: 350_000,
        minCameraDistanceM: 250,
      },
    ]);
  }

  if (samples) {
    scene.setMarkers(
      'samples',
      await scene.withTerrainHeights(
        samples.samples.map((s) => ({
          id: s.sampleNumber,
          lat: s.lat,
          lon: s.lon,
          color: '#ff9ad5',
          size: 7,
        })),
        2,
      ),
    );
  }

  const pois = await scene.withTerrainHeights(
    POIS.map((p) => ({ id: p.id, lat: p.lat, lon: p.lon, color: '#b69cff', size: 9 })),
    2,
  );
  scene.setMarkers('pois', pois);
  scene.setAnnotations(
    'pois',
    pois.map((p, i): Annotation => ({
      id: p.id,
      lat: p.lat,
      lon: p.lon,
      heightM: p.heightM,
      text: POIS[i]!.name,
      dedupeKey: `poi:${p.id}`,
      kind: 'poi',
      priority: 50 - i,
      maxCameraDistanceM: 140_000,
    })),
  );

  if (ingenuity) {
    scene.setMarkers(
      'ingenuity',
      await scene.withTerrainHeights(
        ingenuity.flights.map((f) => ({
          id: String(f.flight),
          lat: f.lat,
          lon: f.lon,
          color: '#9fe3ff',
          size: 5,
        })),
        2,
      ),
    );
  }
}
