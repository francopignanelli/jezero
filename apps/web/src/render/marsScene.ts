import {
  ArcType,
  BoundingSphere,
  Cartesian3,
  Cartographic,
  CesiumTerrainProvider,
  CesiumWidget,
  Color,
  DirectionalLight,
  DistanceDisplayCondition,
  EasingFunction,
  Ellipsoid,
  EllipsoidTerrainProvider,
  Entity,
  GeographicTilingScheme,
  Globe,
  HeadingPitchRange,
  ImageryLayer,
  Math as CesiumMath,
  NearFarScalar,
  PolylineDashMaterialProperty,
  PolylineGlowMaterialProperty,
  PolylineOutlineMaterialProperty,
  Rectangle,
  Resource,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  SingleTileImageryProvider,
  UrlTemplateImageryProvider,
  sampleTerrainMostDetailed,
  type ImageryProvider,
  type MaterialProperty,
  type TerrainProvider,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/CesiumWidget/CesiumWidget.css';
import {
  MARS_SPHERE_RADIUS_M,
  normalizeLon180,
  normalizeLon360,
  sunDirectionBodyFixed,
  type Mat3,
} from '@copernico/domain';
import { AnnotationLayer, type Annotation } from './annotations';
import { installCameraConstraints } from './cameraConstraints';
import { SkyRenderer, type SkyQuality } from './sky';

/**
 * The render body is the IAU 2015 Mars reference SPHERE (R = 3 396 190 m), not Cesium's flattened
 * Ellipsoid.MARS: our data is planetocentric, and on an ellipsoid Cesium would treat latitude as
 * planetographic (≈12 km north–south error at Jezero). Heights are metres above the MOLA areoid;
 * the areoid's departure from the sphere is not rendered (visual simplification only).
 */
export const MARS_SPHERE = new Ellipsoid(
  MARS_SPHERE_RADIUS_M,
  MARS_SPHERE_RADIUS_M,
  MARS_SPHERE_RADIUS_M,
);
Ellipsoid.default = MARS_SPHERE;

/**
 * Sphere fix (CesiumJS 1.145): Globe.getHeight and the quadtree's height callbacks start their pick
 * ray where the surface normal meets the z-axis. On an exact sphere that is the body centre, a
 * degenerate origin that yields no height. Reporting "no intersection" for these buffered calls makes
 * Cesium use its documented fallback (ray from 11.5 km below the surface). Unbuffered calls (local
 * curvature) keep the exact answer. Patched on the prototype: ellipsoids are cloned into workers.
 */
const zAxisIntersection = Ellipsoid.prototype.getSurfaceNormalIntersectionWithZAxis;
Ellipsoid.prototype.getSurfaceNormalIntersectionWithZAxis = function sphereAware(
  this: Ellipsoid,
  position: Cartesian3,
  buffer?: number,
  result?: Cartesian3,
) {
  const isSphere = this.radii.x === this.radii.z;
  if (isSphere && buffer !== undefined && buffer > 0) return undefined;
  return zAxisIntersection.call(this, position, buffer, result);
};

/** Belt and braces: never let a failed camera-height lookup stop the render loop. */
const cesiumGetHeight = Globe.prototype.getHeight;
Globe.prototype.getHeight = function getHeightOnSphere(this: Globe, cartographic: Cartographic) {
  try {
    return cesiumGetHeight.call(this, cartographic);
  } catch {
    return undefined;
  }
};

export interface LonLatRect {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface RasterLayerSpec {
  id: string;
  url: string;
  rectangle: LonLatRect;
  minLevel: number;
  maxLevel: number;
  credit: string;
}

export interface MarkerSpec {
  id: string;
  lat: number;
  lon: number;
  /** Metres above the areoid (sampled from terrain by the caller). Never ground-clamped by Cesium. */
  heightM: number;
  color: string;
  size?: number;
}

export type LineStyle = 'route-primary' | 'route-alternative' | 'traverse' | 'boundary';

export interface LineSpec {
  id: string;
  points: Array<{ lat: number; lon: number; heightM: number }>;
  style: LineStyle;
}

const toCartesian = (lat: number, lon: number, h: number): Cartesian3 =>
  Cartesian3.fromDegrees(normalizeLon180(lon), lat, h, MARS_SPHERE);

const COLOURS = {
  route: Color.fromCssColorString('#5fd4c4'),
  alternative: Color.fromCssColorString('#e8e2d6'),
  traverse: Color.fromCssColorString('#f2b84b'),
  boundary: Color.fromCssColorString('#6cc6e6'),
  outline: Color.fromCssColorString('#0b0e13'),
};

function lineMaterials(style: LineStyle): {
  width: number;
  material: MaterialProperty;
  depthFail: MaterialProperty;
} {
  switch (style) {
    case 'route-primary':
      return {
        width: 14,
        material: new PolylineGlowMaterialProperty({
          color: COLOURS.route,
          glowPower: 0.22,
          taperPower: 1,
        }),
        // Coarser terrain LODs can sit above the route (heights come from the 1 m model): keep it
        // clearly visible through terrain instead of breaking into fragments.
        depthFail: new PolylineGlowMaterialProperty({
          color: COLOURS.route.withAlpha(0.75),
          glowPower: 0.22,
          taperPower: 1,
        }),
      };
    case 'route-alternative':
      return {
        width: 3,
        material: new PolylineDashMaterialProperty({
          color: COLOURS.alternative.withAlpha(0.9),
          dashLength: 18,
        }),
        depthFail: new PolylineDashMaterialProperty({
          color: COLOURS.alternative.withAlpha(0.6),
          dashLength: 18,
        }),
      };
    case 'traverse':
      return {
        width: 3,
        material: new PolylineOutlineMaterialProperty({
          color: COLOURS.traverse.withAlpha(0.9),
          outlineColor: COLOURS.outline.withAlpha(0.7),
          outlineWidth: 1,
        }),
        depthFail: new PolylineOutlineMaterialProperty({
          color: COLOURS.traverse.withAlpha(0.55),
          outlineColor: COLOURS.outline.withAlpha(0.4),
          outlineWidth: 1,
        }),
      };
    case 'boundary':
      return {
        width: 7,
        material: new PolylineGlowMaterialProperty({
          color: COLOURS.boundary,
          glowPower: 0.3,
          taperPower: 1,
        }),
        depthFail: new PolylineGlowMaterialProperty({
          color: COLOURS.boundary.withAlpha(0.55),
          glowPower: 0.3,
          taperPower: 1,
        }),
      };
  }
}

export class MarsScene {
  readonly widget: CesiumWidget;
  readonly annotations: AnnotationLayer;
  private readonly tilingScheme = new GeographicTilingScheme({ ellipsoid: MARS_SPHERE });
  private readonly rasters = new Map<string, ImageryLayer>();
  private readonly groups = new Map<string, Entity[]>();
  private readonly hiddenGroups = new Set<string>();
  private handler: ScreenSpaceEventHandler;
  private sky: SkyRenderer | null = null;
  private terrain: TerrainProvider = new EllipsoidTerrainProvider({ ellipsoid: MARS_SPHERE });
  private constraints: ReturnType<typeof installCameraConstraints>;
  reducedMotion = false;

  constructor(container: HTMLElement) {
    const credits = document.createElement('div');
    credits.hidden = true; // data credits are shown in Copernico's own provenance UI
    this.widget = new CesiumWidget(container, {
      ellipsoid: MARS_SPHERE,
      globe: new Globe(MARS_SPHERE),
      baseLayer: false,
      terrainProvider: this.terrain,
      skyBox: false,
      skyAtmosphere: false,
      scene3DOnly: true,
      requestRenderMode: true,
      maximumRenderTimeChange: Number.POSITIVE_INFINITY,
      creditContainer: credits,
      msaaSamples: 4,
      useBrowserRecommendedResolution: false,
      // Transparent canvas: the scientifically positioned sky is drawn behind it (see sky.ts).
      contextOptions: { webgl: { alpha: true } },
    });
    // Crisp on HiDPI screens without paying for more than 1.5× the pixels.
    this.widget.resolutionScale = Math.min(window.devicePixelRatio || 1, 1.5);
    const scene = this.widget.scene;
    const globe = scene.globe;
    globe.baseColor = Color.fromCssColorString('#4a2618');
    globe.depthTestAgainstTerrain = true;
    globe.showGroundAtmosphere = false;
    globe.enableLighting = true;
    globe.dynamicAtmosphereLighting = false;
    globe.maximumScreenSpaceError = 1.5;
    globe.tileCacheSize = 400;
    scene.fog.enabled = false;
    scene.postProcessStages.fxaa.enabled = true;
    if (scene.sun) scene.sun.show = false;
    if (scene.moon) scene.moon.show = false;
    scene.backgroundColor = new Color(0, 0, 0, 0);

    scene.renderError.addEventListener((_scene: unknown, error: unknown) => {
      console.error(
        '[Copernico] Cesium render error',
        error instanceof Error ? error.stack : error,
      );
    });
    this.handler = new ScreenSpaceEventHandler(scene.canvas);
    try {
      this.sky = new SkyRenderer(container);
    } catch {
      this.sky = null; // no WebGL2 for the sky: plain dark background
      scene.backgroundColor = Color.fromCssColorString('#020306');
    }
    this.annotations = new AnnotationLayer(container, scene);
    scene.postRender.addEventListener(() => {
      this.renderSky();
      if (this.sky?.animating) window.requestAnimationFrame(() => this.requestRender());
      this.annotations.update();
    });
    this.constraints = installCameraConstraints(scene);
    this.setSunTime(Date.now());
    this.setView(18.44, 77.45, 9_500_000, 0, -90);
  }

  // ---------- loading ----------

  /** Loads the quantized-mesh terrain; on failure keeps the smooth sphere and reports it. */
  async loadTerrain(url: string, version: string): Promise<boolean> {
    try {
      this.terrain = await CesiumTerrainProvider.fromUrl(
        new Resource({ url, queryParameters: { v: version } }),
        {
          ellipsoid: MARS_SPHERE,
          requestVertexNormals: true,
        },
      );
      if (this.isDestroyed()) return false;
      this.widget.scene.terrainProvider = this.terrain;
      this.requestRender();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Loads the star catalog and the 4K Milky Way (resolves then), and upgrades to 8K in the
   * background when the GPU supports it (`onQuality` reports the upgrade).
   */
  async loadSky(
    starsUrl: string,
    milkyWay: { hd: string; sd: string },
    onQuality?: (quality: SkyQuality) => void,
  ): Promise<{ stars: boolean; quality: SkyQuality }> {
    if (!this.sky) return { stars: false, quality: 'none' };
    const result = await this.sky.load(starsUrl, milkyWay, (q) => {
      onQuality?.(q);
      this.requestRender(); // starts the cross-fade; postRender keeps it going
    });
    this.requestRender();
    return result;
  }

  /** Resolves once every globe tile needed for the current view has loaded (or after `timeoutMs`). */
  whenTilesLoaded(timeoutMs = 20_000): Promise<boolean> {
    const scene = this.widget.scene;
    return new Promise((resolve) => {
      let frames = 0;
      const timer = window.setTimeout(() => done(false), timeoutMs);
      const check = () => {
        frames++;
        if (frames > 3 && scene.globe.tilesLoaded) done(true);
        else scene.requestRender();
      };
      const done = (ok: boolean) => {
        window.clearTimeout(timer);
        scene.postRender.removeEventListener(check);
        resolve(ok);
      };
      scene.postRender.addEventListener(check);
      scene.requestRender();
    });
  }

  // ---------- sky and lighting ----------

  setSkyVisible(visible: boolean): void {
    if (this.sky) this.sky.enabled = visible;
    this.requestRender();
  }

  private renderSky(): void {
    if (!this.sky || this.isDestroyed()) return;
    const camera = this.widget.camera;
    const m = camera.viewMatrix; // column-major Matrix4; take the rotation block, row-major
    const viewRotation: Mat3 = [m[0]!, m[4]!, m[8]!, m[1]!, m[5]!, m[9]!, m[2]!, m[6]!, m[10]!];
    const frustum = camera.frustum as { fovy?: number; aspectRatio?: number };
    const p = camera.positionWC;
    const r = Math.hypot(p.x, p.y, p.z);
    this.sky.render({
      viewRotation,
      fovyRad: frustum.fovy ?? Math.PI / 3,
      aspect: frustum.aspectRatio ?? 1,
      up: [p.x / r, p.y / r, p.z / r],
      heightM: r - MARS_SPHERE_RADIUS_M,
    });
  }

  /** Calculated sun direction (Mars24 subsolar point) and sky orientation for a UTC instant. */
  setSunTime(utcMs: number): void {
    this.sky?.setTime(utcMs);
    const [x, y, z] = sunDirectionBodyFixed(utcMs);
    this.widget.scene.light = new DirectionalLight({
      direction: new Cartesian3(-x, -y, -z),
      intensity: 2.2,
    });
    this.requestRender();
  }

  // ---------- rasters ----------

  addTiledLayer(spec: RasterLayerSpec): void {
    const provider = new UrlTemplateImageryProvider({
      url: spec.url,
      tilingScheme: this.tilingScheme,
      minimumLevel: 0,
      maximumLevel: spec.maxLevel,
      rectangle: Rectangle.fromDegrees(
        spec.rectangle.west,
        spec.rectangle.south,
        spec.rectangle.east,
        spec.rectangle.north,
      ),
      credit: spec.credit,
      tileWidth: 256,
      tileHeight: 256,
    });
    this.addProvider(spec.id, provider, spec.minLevel);
  }

  /** Drapes an RGBA image whose pixels are aligned with lon/lat (equirectangular grid). */
  async setImageOverlay(id: string, image: HTMLCanvasElement, rect: LonLatRect): Promise<void> {
    this.removeLayer(id);
    const provider = await SingleTileImageryProvider.fromUrl(image.toDataURL('image/png'), {
      rectangle: Rectangle.fromDegrees(rect.west, rect.south, rect.east, rect.north),
      ellipsoid: MARS_SPHERE,
    });
    this.addProvider(id, provider, 0);
  }

  private addProvider(id: string, provider: ImageryProvider, minLevel: number): void {
    if (this.isDestroyed()) return;
    this.removeLayer(id);
    const layer = new ImageryLayer(provider, minLevel > 0 ? { minimumTerrainLevel: minLevel } : {});
    this.widget.scene.imageryLayers.add(layer);
    this.rasters.set(id, layer);
    this.requestRender();
  }

  removeLayer(id: string): void {
    const layer = this.rasters.get(id);
    if (layer) {
      this.widget.scene.imageryLayers.remove(layer, true);
      this.rasters.delete(id);
    }
  }

  // ---------- vector groups ----------

  setLayerVisible(id: string, visible: boolean): void {
    if (this.isDestroyed()) return;
    const raster = this.rasters.get(id);
    if (raster) raster.show = visible;
    if (visible) this.hiddenGroups.delete(id);
    else this.hiddenGroups.add(id);
    for (const e of this.groups.get(id) ?? []) e.show = visible;
    this.annotations.setGroupVisible(id, visible);
    this.requestRender();
  }

  private group(id: string): Entity[] {
    let g = this.groups.get(id);
    if (!g) {
      g = [];
      this.groups.set(id, g);
    }
    return g;
  }

  /** Replaces a group of point markers placed at explicit heights (no Cesium ground clamping). */
  setMarkers(groupId: string, markers: MarkerSpec[]): void {
    if (this.isDestroyed()) return;
    this.clearGroup(groupId);
    const g = this.group(groupId);
    const show = !this.hiddenGroups.has(groupId);
    for (const m of markers) {
      const entity = new Entity({
        id: `${groupId}:${m.id}`,
        show,
        position: toCartesian(m.lat, m.lon, m.heightM),
        point: {
          pixelSize: m.size ?? 9,
          color: Color.fromCssColorString(m.color),
          outlineColor: Color.fromCssColorString('#f3efe9').withAlpha(0.9),
          outlineWidth: 1.5,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scaleByDistance: new NearFarScalar(1.5e3, 1.25, 8e5, 0.55),
          // Surface detail belongs to the operational view; from orbit, the crater label stands in.
          distanceDisplayCondition: new DistanceDisplayCondition(0, 450_000),
        },
      });
      g.push(entity);
      this.widget.entities.add(entity);
    }
    this.requestRender();
  }

  /** Replaces a group of styled polylines. */
  setLines(groupId: string, lines: LineSpec[]): void {
    if (this.isDestroyed()) return;
    this.clearGroup(groupId);
    const g = this.group(groupId);
    const show = !this.hiddenGroups.has(groupId);
    for (const line of lines) {
      if (line.points.length < 2) continue;
      const { width, material, depthFail } = lineMaterials(line.style);
      const entity = new Entity({
        id: `${groupId}:${line.id}`,
        show,
        polyline: {
          positions: line.points.map((p) => toCartesian(p.lat, p.lon, p.heightM)),
          width,
          arcType: ArcType.NONE, // vertices are already dense and draped on the rendered terrain
          distanceDisplayCondition: new DistanceDisplayCondition(0, 300_000),
          material,
          depthFailMaterial: depthFail,
        },
      });
      g.push(entity);
      this.widget.entities.add(entity);
    }
    this.requestRender();
  }

  setAnnotations(groupId: string, items: Annotation[]): void {
    if (this.isDestroyed()) return;
    this.annotations.set(groupId, items);
    this.annotations.setGroupVisible(groupId, !this.hiddenGroups.has(groupId));
  }

  clearGroup(groupId: string): void {
    const g = this.groups.get(groupId);
    if (!g) return;
    for (const e of g) this.widget.entities.remove(e);
    g.length = 0;
    this.requestRender();
  }

  // ---------- terrain queries ----------

  /** Adds rendered-terrain heights (+ lift) to items, in one batched request. */
  async withTerrainHeights<T extends { lat: number; lon: number }>(
    items: T[],
    liftM: number,
  ): Promise<Array<T & { heightM: number }>> {
    const h = await this.sampleTerrain(items);
    return items.map((it, i) => ({ ...it, heightM: (Number.isFinite(h[i]!) ? h[i]! : 0) + liftM }));
  }

  /** Terrain heights (m above areoid, as rendered) for positions, using the most detailed tiles. */
  async sampleTerrain(points: Array<{ lat: number; lon: number }>): Promise<number[]> {
    if (points.length === 0) return [];
    const cartos = points.map((p) => Cartographic.fromDegrees(normalizeLon180(p.lon), p.lat));
    try {
      const out = await sampleTerrainMostDetailed(this.terrain, cartos);
      return out.map((c) => c.height ?? Number.NaN);
    } catch {
      return points.map(() => Number.NaN);
    }
  }

  // ---------- interaction and camera ----------

  onPick(callback: (lat: number, lon: number) => void): void {
    this.handler.setInputAction((e: ScreenSpaceEventHandler.PositionedEvent) => {
      const scene = this.widget.scene;
      const position = scene.pickPositionSupported ? scene.pickPosition(e.position) : undefined;
      const cart = position ?? scene.camera.pickEllipsoid(e.position, MARS_SPHERE);
      if (!cart) return;
      const c = Cartographic.fromCartesian(cart, MARS_SPHERE);
      callback(
        CesiumMath.toDegrees(c.latitude),
        normalizeLon360(CesiumMath.toDegrees(c.longitude)),
      );
    }, ScreenSpaceEventType.LEFT_CLICK);
  }

  setView(lat: number, lon: number, heightM: number, headingDeg: number, pitchDeg: number): void {
    this.widget.camera.setView({
      destination: toCartesian(lat, lon, heightM),
      orientation: {
        heading: CesiumMath.toRadians(headingDeg),
        pitch: CesiumMath.toRadians(pitchDeg),
        roll: 0,
      },
    });
    this.requestRender();
  }

  /** Scripted flights follow safe paths, so the exploration constraints are suspended meanwhile. */
  private flight(start: (complete: () => void) => void): Promise<void> {
    this.constraints.suspend(true);
    return new Promise((resolve) => {
      start(() => {
        this.constraints.suspend(false);
        resolve();
      });
    });
  }

  flyTo(
    lat: number,
    lon: number,
    heightM: number,
    headingDeg: number,
    pitchDeg: number,
    seconds: number,
  ): Promise<void> {
    return this.flight((done) =>
      this.widget.camera.flyTo({
        destination: toCartesian(lat, lon, heightM),
        orientation: {
          heading: CesiumMath.toRadians(headingDeg),
          pitch: CesiumMath.toRadians(pitchDeg),
          roll: 0,
        },
        duration: this.reducedMotion ? 0 : seconds,
        easingFunction: EasingFunction.QUADRATIC_IN_OUT,
        maximumHeight: 6_000_000,
        complete: done,
        cancel: done,
      }),
    );
  }

  /** Flies to look at a target point from a heading/pitch/range offset (orbit-to-surface transition). */
  flyToTarget(
    lat: number,
    lon: number,
    heightM: number,
    rangeM: number,
    headingDeg: number,
    pitchDeg: number,
    seconds: number,
  ): Promise<void> {
    return this.flight((done) =>
      this.widget.camera.flyToBoundingSphere(
        new BoundingSphere(toCartesian(lat, lon, heightM), 1),
        {
          offset: new HeadingPitchRange(
            CesiumMath.toRadians(headingDeg),
            CesiumMath.toRadians(pitchDeg),
            rangeM,
          ),
          duration: this.reducedMotion ? 0 : seconds,
          easingFunction: EasingFunction.QUADRATIC_IN_OUT,
          maximumHeight: 6_000_000,
          complete: done,
          cancel: done,
        },
      ),
    );
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
    const c = this.widget.scene.screenSpaceCameraController;
    c.inertiaSpin = reduced ? 0 : 0.9;
    c.inertiaTranslate = reduced ? 0 : 0.9;
    c.inertiaZoom = reduced ? 0 : 0.8;
  }

  requestRender(): void {
    if (!this.isDestroyed()) this.widget.scene.requestRender();
  }

  isDestroyed(): boolean {
    return this.widget.isDestroyed();
  }

  destroy(): void {
    this.constraints.dispose();
    this.handler.destroy();
    this.annotations.destroy();
    this.widget.destroy();
    this.sky?.destroy();
  }
}
