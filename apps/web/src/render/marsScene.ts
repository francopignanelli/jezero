import {
  ArcType,
  BoundingSphere,
  Cartesian2,
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
  Matrix4,
  HeadingPitchRoll,
  Transforms,
  NearFarScalar,
  PolylineDashMaterialProperty,
  PolylineGlowMaterialProperty,
  PolylineOutlineMaterialProperty,
  Rectangle,
  Resource,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  SingleTileImageryProvider,
  SkyAtmosphere,
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

/** Display grading of a colour layer (Cesium ImageryLayer adjustments). */
export interface LayerGrade {
  saturation?: number;
  hue?: number;
  gamma?: number;
  brightness?: number;
  contrast?: number;
}

export interface RasterLayerSpec {
  id: string;
  grade?: LayerGrade;
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
  /** Hide the marker when the camera is closer than this (m), e.g. where a 3D model takes over. */
  hideWithinM?: number;
}

export type LineStyle =
  | 'route-primary'
  | 'route-casing'
  | 'route-band-mild'
  | 'route-band-moderate'
  | 'route-band-steep'
  | 'route-alternative'
  | 'traverse'
  | 'traverse-muted'
  | 'boundary';

/** Slope-band colours of the route core (same as the slope legend). */
const BAND_COLOURS = {
  'route-band-mild': Color.fromCssColorString('#3ff0c0'),
  'route-band-moderate': Color.fromCssColorString('#fde725'),
  'route-band-steep': Color.fromCssColorString('#f89540'),
} as const;

export interface LineSpec {
  id: string;
  points: Array<{ lat: number; lon: number; heightM: number }>;
  style: LineStyle;
}

const toCartesian = (lat: number, lon: number, h: number): Cartesian3 =>
  Cartesian3.fromDegrees(normalizeLon180(lon), lat, h, MARS_SPHERE);

export const COLOURS = {
  route: Color.fromCssColorString('#3ff0c0'),
  alternative: Color.fromCssColorString('#e8e2d6'),
  traverse: Color.fromCssColorString('#f2b84b'),
  boundary: Color.fromCssColorString('#8fb4d6'),
  outline: Color.fromCssColorString('#0b0e13'),
};

interface LineLayer {
  width: number;
  material: MaterialProperty;
  /** Drawn where terrain hides the line; undefined hides it there. */
  depthFail?: MaterialProperty;
}

/**
 * Each style is one or more stacked polylines. The planned route is the hero: a soft halo, a dark
 * casing and a bright core keep it readable on grey HiRISE imagery and over every other line.
 */
function lineMaterials(style: LineStyle): LineLayer[] {
  switch (style) {
    case 'route-primary':
      return [
        {
          width: 26,
          material: new PolylineGlowMaterialProperty({
            color: COLOURS.route.withAlpha(0.45),
            glowPower: 0.12,
            taperPower: 1,
          }),
        },
        {
          width: 9,
          material: new PolylineOutlineMaterialProperty({
            color: COLOURS.route,
            outlineColor: COLOURS.outline.withAlpha(0.85),
            outlineWidth: 2.5,
          }),
          // Coarser terrain LODs can sit above the route (heights come from the 1 m model): keep it
          // visible through terrain instead of breaking into fragments.
          depthFail: new PolylineOutlineMaterialProperty({
            color: COLOURS.route.withAlpha(0.7),
            outlineColor: COLOURS.outline.withAlpha(0.5),
            outlineWidth: 2.5,
          }),
        },
      ];
    case 'route-casing':
      // Halo and dark casing only; the coloured core is drawn per slope band on top.
      return [
        {
          width: 26,
          material: new PolylineGlowMaterialProperty({
            color: COLOURS.route.withAlpha(0.35),
            glowPower: 0.12,
            taperPower: 1,
          }),
        },
        {
          width: 10,
          material: new PolylineOutlineMaterialProperty({
            color: COLOURS.outline.withAlpha(0.9),
            outlineWidth: 0,
          }),
          depthFail: new PolylineOutlineMaterialProperty({
            color: COLOURS.outline.withAlpha(0.55),
            outlineWidth: 0,
          }),
        },
      ];
    case 'route-band-mild':
    case 'route-band-moderate':
    case 'route-band-steep':
      return [
        {
          width: 5,
          material: new PolylineOutlineMaterialProperty({
            color: BAND_COLOURS[style],
            outlineWidth: 0,
          }),
          depthFail: new PolylineOutlineMaterialProperty({
            color: BAND_COLOURS[style].withAlpha(0.7),
            outlineWidth: 0,
          }),
        },
      ];
    case 'route-alternative':
      return [
        {
          width: 3.5,
          material: new PolylineDashMaterialProperty({
            color: COLOURS.alternative.withAlpha(0.85),
            gapColor: COLOURS.outline.withAlpha(0.35),
            dashLength: 16,
          }),
        },
      ];
    case 'traverse':
    case 'traverse-muted': {
      const a = style === 'traverse' ? 1 : 0.35;
      return [
        {
          width: style === 'traverse' ? 3 : 2,
          material: new PolylineOutlineMaterialProperty({
            color: COLOURS.traverse.withAlpha(0.9 * a),
            outlineColor: COLOURS.outline.withAlpha(0.7 * a),
            outlineWidth: 1,
          }),
        },
      ];
    }
    case 'boundary':
      return [
        {
          width: 5,
          material: new PolylineGlowMaterialProperty({
            color: COLOURS.boundary.withAlpha(0.9),
            glowPower: 0.3,
            taperPower: 1,
          }),
        },
      ];
  }
}

let chevron: HTMLCanvasElement | null = null;
/** White chevron pointing "up" with a dark edge (drawn once, shared by every arrow billboard). */
function chevronImage(): HTMLCanvasElement {
  if (chevron) return chevron;
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const ctx = c.getContext('2d')!;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(7, 22);
  ctx.lineTo(16, 10);
  ctx.lineTo(25, 22);
  ctx.strokeStyle = 'rgba(11,14,19,0.9)';
  ctx.lineWidth = 9;
  ctx.stroke();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 4.5;
  ctx.stroke();
  chevron = c;
  return c;
}

export interface ArrowSpec {
  lat: number;
  lon: number;
  heightM: number;
  /** A point a little further along the path (gives the direction). */
  next: { lat: number; lon: number; heightM: number };
}

export class MarsScene {
  readonly widget: CesiumWidget;
  readonly annotations: AnnotationLayer;
  private readonly tilingScheme = new GeographicTilingScheme({ ellipsoid: MARS_SPHERE });
  private readonly rasters = new Map<string, ImageryLayer>();
  private readonly groups = new Map<string, Entity[]>();
  private readonly hiddenGroups = new Set<string>();
  private readonly lineSpecs = new Map<string, LineSpec[]>();
  /** Where each placed model is (its centre, for camera close-ups). */
  readonly modelTargets = new Map<string, { lat: number; lon: number; heightM: number }>();
  /** Lines without their own see-through style, and the material to use when looking down. */
  private readonly seeThrough = new Map<Entity, MaterialProperty>();
  private overhead = true;
  private nearModel = false;
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
    // Thin, dusty Mars atmosphere seen at the limb from orbit: scale height ~11 km, scattering
    // coefficients with red > green > blue (dust-dominated, the reverse of Earth's Rayleigh sky).
    // Shown only from altitude (see updateAtmosphere); illustrative, not a radiative-transfer model.
    const sky = new SkyAtmosphere(MARS_SPHERE);
    sky.atmosphereRayleighCoefficient = new Cartesian3(19.9e-6, 13.6e-6, 5.75e-6);
    sky.atmosphereMieCoefficient = new Cartesian3(21e-6, 21e-6, 21e-6);
    sky.atmosphereRayleighScaleHeight = 11_000;
    sky.atmosphereMieScaleHeight = 11_000;
    sky.atmosphereMieAnisotropy = 0.76;
    sky.atmosphereLightIntensity = 14;
    sky.perFragmentAtmosphere = true;
    scene.skyAtmosphere = sky;
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
    scene.preRender.addEventListener(() => {
      this.updateAtmosphere();
      this.fadeImageryTiers();
      this.updateLineOcclusion();
      this.updateCloseUpDeclutter();
    });
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

  /**
   * CTX and HiRISE are greyscale mosaics over the colour Viking globe. Seen from far away their
   * footprints read as grey squares, so each tier fades in only once it fills most of the view.
   */
  /**
   * Looking steeply down, coarser terrain tiles can sit a few metres above lines draped on the 1 m
   * model, so lines stay visible through terrain there. In low, grazing views ridges really do hide
   * them, so they are depth-tested (otherwise they float over the horizon).
   */
  private updateLineOcclusion(): void {
    const overhead = this.widget.camera.pitch < CesiumMath.toRadians(-35);
    if (overhead === this.overhead) return;
    this.overhead = overhead;
    for (const [entity, material] of this.seeThrough) {
      if (entity.polyline)
        entity.polyline.depthFailMaterial = overhead
          ? material
          : (undefined as unknown as MaterialProperty);
    }
    this.requestRender();
  }

  /**
   * Near a placed model the long, display-simplified rover traverse (drawn 1.5 m above the ground)
   * would cut through the model as a thick zigzag, so it is hidden within ~400 m of any model.
   */
  private updateCloseUpDeclutter(): void {
    const camera = this.widget.camera.positionWC;
    let near = false;
    for (const t of this.modelTargets.values()) {
      if (Cartesian3.distance(camera, toCartesian(t.lat, t.lon, t.heightM)) < 400) near = true;
    }
    if (near === this.nearModel) return;
    this.nearModel = near;
    const show = !near && !this.hiddenGroups.has('rover');
    for (const e of this.groups.get('rover') ?? []) if (e.polyline) e.show = show;
    this.requestRender();
  }

  /** Limb haze only when the planet is seen from above ~150 km; near the surface our sky layer draws the sky. */
  private updateAtmosphere(): void {
    const sky = this.widget.scene.skyAtmosphere;
    if (!sky) return;
    const show = this.widget.camera.positionCartographic.height > 150_000;
    if (sky.show !== show) {
      sky.show = show;
      this.requestRender();
    }
  }

  private fadeImageryTiers(): void {
    const h = this.widget.camera.positionCartographic.height + 2_500; // above the Jezero floor
    const fade = (layer: ImageryLayer | undefined, far: number, near: number) => {
      if (!layer) return;
      const a = Math.min(1, Math.max(0, (far - h) / (far - near)));
      if (Math.abs(layer.alpha - a) > 0.01) {
        layer.alpha = a;
        this.requestRender();
      }
    };
    fade(this.rasters.get('ctx'), 160_000, 70_000);
    fade(this.rasters.get('hirise'), 25_000, 12_000);
    fade(this.rasters.get('hirise-rover'), 25_000, 12_000);
    // Viking colour washed over the grey tiers (alpha blend ≈ colour from 232 m, detail from 5 m /
    // 25 cm). It follows the CTX fade so the globe and the crater blend without a seam.
    const wash = this.rasters.get('colour-wash');
    const ctx = this.rasters.get('ctx');
    if (wash && ctx) {
      // A little more colour near the ground, where the grey HiRISE/CTX fill the view.
      const nearGround = 1 - Math.min(1, Math.max(0, (h - 3_000) / 27_000));
      const a = (0.45 + 0.15 * nearGround) * ctx.alpha;
      if (Math.abs(wash.alpha - a) > 0.01) wash.alpha = a;
    }
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
    const layer = this.rasters.get(spec.id);
    if (layer && spec.grade) Object.assign(layer, spec.grade);
  }

  /** Ids of raster layers starting with `prefix` (for removing a family of overlays). */
  rasterIds(prefix: string): string[] {
    return [...this.rasters.keys()].filter((k) => k.startsWith(prefix));
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
          // Always on top only up close; from afar terrain hides points behind ridges.
          disableDepthTestDistance: 3_000,
          scaleByDistance: new NearFarScalar(1.5e3, 1.25, 8e5, 0.55),
          // Surface detail belongs to the operational view; from orbit, the crater label stands in.
          distanceDisplayCondition: new DistanceDisplayCondition(m.hideWithinM ?? 0, 450_000),
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
    this.lineSpecs.set(groupId, lines);
    for (const line of lines) {
      if (line.points.length < 2) continue;
      const positions = line.points.map((p) => toCartesian(p.lat, p.lon, p.heightM));
      lineMaterials(line.style).forEach(({ width, material, depthFail }, k) => {
        const entity = new Entity({
          id: `${groupId}:${line.id}:${k}`,
          show,
          polyline: {
            positions,
            width,
            arcType: ArcType.NONE, // vertices are already dense and draped on the rendered terrain
            distanceDisplayCondition: new DistanceDisplayCondition(0, 300_000),
            material,
            ...(depthFail
              ? { depthFailMaterial: depthFail }
              : this.overhead
                ? { depthFailMaterial: material }
                : {}),
          },
        });
        if (!depthFail) this.seeThrough.set(entity, material);
        g.push(entity);
        this.widget.entities.add(entity);
      });
    }
    this.requestRender();
  }

  /** Re-applies a group's lines with another style (e.g. mute the traverse while a route is shown). */
  restyleLines(groupId: string, style: (current: LineStyle) => LineStyle): void {
    const specs = this.lineSpecs.get(groupId);
    if (!specs) return;
    const next = specs.map((l) => ({ ...l, style: style(l.style) }));
    if (next.every((l, i) => l.style === specs[i]!.style)) return;
    this.setLines(groupId, next);
  }

  /**
   * Direction chevrons along a path: billboards whose up axis follows the local path direction,
   * so they point along the route from any camera angle at a constant screen size.
   */
  setArrows(groupId: string, arrows: ArrowSpec[]): void {
    if (this.isDestroyed()) return;
    this.clearGroup(groupId);
    const g = this.group(groupId);
    const show = !this.hiddenGroups.has(groupId);
    const image = chevronImage();
    arrows.forEach((a, i) => {
      const p = toCartesian(a.lat, a.lon, a.heightM);
      const q = toCartesian(a.next.lat, a.next.lon, a.next.heightM);
      const axis = Cartesian3.normalize(
        Cartesian3.subtract(q, p, new Cartesian3()),
        new Cartesian3(),
      );
      const entity = new Entity({
        id: `${groupId}:${i}`,
        show,
        position: p,
        billboard: {
          image,
          width: 14,
          height: 14,
          alignedAxis: axis,
          // Always on top only up close; from afar terrain hides points behind ridges.
          disableDepthTestDistance: 3_000,
          distanceDisplayCondition: new DistanceDisplayCondition(0, 40_000),
        },
      });
      g.push(entity);
      this.widget.entities.add(entity);
    });
    this.requestRender();
  }

  /** Frames a path: the whole route in view, seen obliquely from behind its start. */
  flyToPath(
    points: Array<{ lat: number; lon: number; heightM: number }>,
    seconds = 2.5,
  ): Promise<void> {
    if (points.length === 0) return Promise.resolve();
    const sphere = BoundingSphere.fromPoints(
      points.map((p) => toCartesian(p.lat, p.lon, p.heightM)),
    );
    const start = points[0]!;
    const centre = Cartographic.fromCartesian(sphere.center, MARS_SPHERE);
    // Heading from the start towards the route centre (a flat bearing is fine over a few km).
    const dLon =
      (CesiumMath.toDegrees(centre.longitude) - normalizeLon180(start.lon)) *
      Math.cos(CesiumMath.toRadians(start.lat));
    const dLat = CesiumMath.toDegrees(centre.latitude) - start.lat;
    const heading = Math.atan2(dLon, dLat);
    // Fit the sphere inside the narrower field of view (short, wide canvases have a small vertical FOV).
    const frustum = this.widget.camera.frustum as { fovy?: number; aspectRatio?: number };
    const fovy = frustum.fovy ?? Math.PI / 3;
    const fovx = 2 * Math.atan(Math.tan(fovy / 2) * (frustum.aspectRatio ?? 1));
    const range = Math.max(1_400, (1.15 * sphere.radius) / Math.sin(Math.min(fovx, fovy) / 2));
    return this.flight((done) =>
      this.widget.camera.flyToBoundingSphere(sphere, {
        offset: new HeadingPitchRange(heading, CesiumMath.toRadians(-52), range),
        duration: this.reducedMotion ? 0 : seconds,
        easingFunction: EasingFunction.QUADRATIC_IN_OUT,
        complete: done,
        cancel: done,
      }),
    );
  }

  /**
   * Follow-cam along a path for `seconds`: the camera trails the walker at a low oblique angle and
   * turns smoothly with the route. `sample(f)` gives the position and a point ahead at fraction f.
   * Any pointer or wheel input on the map stops it. Resolves when finished or stopped.
   */
  playPath(
    sample: (f: number) => {
      at: { lat: number; lon: number; heightM: number };
      ahead: { lat: number; lon: number; heightM: number };
    },
    seconds: number,
    onProgress: (f: number) => void,
  ): { done: Promise<void>; stop: () => void } {
    const camera = this.widget.camera;
    const canvas = this.widget.canvas;
    let stopped = false;
    let heading: number | null = null;
    const stop = () => {
      stopped = true;
    };
    canvas.addEventListener('pointerdown', stop, { once: true });
    canvas.addEventListener('wheel', stop, { once: true });
    this.constraints.suspend(true);
    const done = new Promise<void>((resolve) => {
      const t0 = performance.now();
      const frame = () => {
        const f = Math.min(1, (performance.now() - t0) / (seconds * 1000));
        if (stopped || this.isDestroyed()) return finish();
        const { at, ahead } = sample(f);
        const p = toCartesian(at.lat, at.lon, at.heightM);
        const dLon =
          (normalizeLon180(ahead.lon) - normalizeLon180(at.lon)) *
          Math.cos(CesiumMath.toRadians(at.lat));
        const target = Math.atan2(dLon, ahead.lat - at.lat);
        // Low-pass the heading so the camera does not jerk at every route vertex.
        if (heading === null) heading = target;
        else heading += Math.atan2(Math.sin(target - heading), Math.cos(target - heading)) * 0.05;
        camera.lookAt(p, new HeadingPitchRange(heading, CesiumMath.toRadians(-24), 520));
        this.requestRender();
        onProgress(f);
        if (f >= 1) return finish();
        window.requestAnimationFrame(frame);
      };
      const finish = () => {
        canvas.removeEventListener('pointerdown', stop);
        canvas.removeEventListener('wheel', stop);
        if (!this.isDestroyed()) camera.lookAtTransform(Matrix4.IDENTITY);
        this.constraints.suspend(false);
        resolve();
      };
      window.requestAnimationFrame(frame);
    });
    return { done, stop };
  }

  setAnnotations(groupId: string, items: Annotation[]): void {
    if (this.isDestroyed()) return;
    this.annotations.set(groupId, items);
    this.annotations.setGroupVisible(groupId, !this.hiddenGroups.has(groupId));
  }

  /** JPEG of the current 3D view (read right after a render, while the drawing buffer is valid). */
  snapshot(): Promise<string | null> {
    if (this.isDestroyed()) return Promise.resolve(null);
    const scene = this.widget.scene;
    return new Promise((resolve) => {
      const once = () => {
        scene.postRender.removeEventListener(once);
        try {
          resolve(scene.canvas.toDataURL('image/jpeg', 0.85));
        } catch {
          resolve(null);
        }
      };
      scene.postRender.addEventListener(once);
      scene.requestRender();
    });
  }

  /**
   * A glTF model on the surface (true scale, metres). From afar it is enlarged to stay at least
   * ~44 px tall (Cesium minimumPixelSize) and it disappears beyond 40 km, where the marker and label
   * stand in. `headingRad` is clockwise from north.
   */
  async setModel(
    groupId: string,
    m: { lat: number; lon: number; heightM: number; headingRad: number; url: string },
  ): Promise<void> {
    if (this.isDestroyed()) return;
    this.clearGroup(groupId);
    const position = toCartesian(m.lat, m.lon, m.heightM);
    // The model's front (robotic arm) is glTF +Z; Cesium maps it so heading 0 faces east, hence −90°.
    const orientation = Transforms.headingPitchRollQuaternion(
      position,
      new HeadingPitchRoll(m.headingRad - Math.PI / 2, 0, 0),
      MARS_SPHERE,
    );
    const entity = new Entity({
      id: `${groupId}:model`,
      show: !this.hiddenGroups.has(groupId),
      position,
      orientation,
      model: {
        uri: m.url,
        minimumPixelSize: 44,
        maximumScale: 400,
        distanceDisplayCondition: new DistanceDisplayCondition(0, 40_000),
        shadows: 0,
        // Warm, slightly stronger sunlight on the model; less of Cesium's Earth-sky reflections.
        lightColor: new Color(3.1, 2.85, 2.55, 1),
        imageBasedLightingFactor: new Cartesian2(0.5, 0.35),
      },
    });
    this.group(groupId).push(entity);
    this.widget.entities.add(entity);
    this.modelTargets.set(groupId, { lat: m.lat, lon: m.lon, heightM: m.heightM + 1.1 });
    // Let the camera come down to the model (it is ~3 m long).
    this.constraints.addCloseUp({ lat: m.lat, lon: m.lon, radiusM: 150, minAboveTerrainM: 4 });
    this.requestRender();
  }

  /**
   * Close-up of a placed model: the camera position is computed explicitly (distance, compass
   * direction it looks along, elevation angle), raised above the rendered terrain if needed, and
   * aimed straight at the model, so the camera limits never push the model out of frame.
   */
  async flyToModel(
    groupId: string,
    rangeM = 40,
    headingDeg = 297,
    elevationDeg = 11,
  ): Promise<void> {
    const t = this.modelTargets.get(groupId);
    if (!t || this.isDestroyed()) return;
    const h = CesiumMath.toRadians(headingDeg);
    const horizontal = rangeM * Math.cos(CesiumMath.toRadians(elevationDeg));
    const mPerDeg = (Math.PI / 180) * MARS_SPHERE_RADIUS_M;
    const lat = t.lat - (horizontal * Math.cos(h)) / mPerDeg;
    const lon =
      t.lon - (horizontal * Math.sin(h)) / (mPerDeg * Math.cos(CesiumMath.toRadians(t.lat)));
    const [ground] = await this.sampleTerrain([{ lat, lon }]);
    const height = Math.max(
      t.heightM + rangeM * Math.sin(CesiumMath.toRadians(elevationDeg)),
      (ground ?? t.heightM) + 6,
    );
    const pitch = -Math.atan2(height - t.heightM, horizontal);
    return this.flight((done) =>
      this.widget.camera.flyTo({
        destination: toCartesian(lat, lon, height),
        orientation: { heading: h, pitch, roll: 0 },
        duration: this.reducedMotion ? 0 : 3,
        easingFunction: EasingFunction.QUADRATIC_IN_OUT,
        complete: done,
        cancel: done,
      }),
    );
  }

  setAnnotationsMuted(groupId: string, muted: boolean): void {
    if (!this.isDestroyed()) this.annotations.setGroupMuted(groupId, muted);
  }

  clearGroup(groupId: string): void {
    const g = this.groups.get(groupId);
    if (!g) return;
    for (const e of g) {
      this.widget.entities.remove(e);
      this.seeThrough.delete(e);
    }
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

  /** Map clicks: the terrain position, plus the id of a picked entity (e.g. "pois:belva"). */
  onPick(callback: (lat: number, lon: number, entityId?: string) => void): void {
    this.handler.setInputAction((e: ScreenSpaceEventHandler.PositionedEvent) => {
      const scene = this.widget.scene;
      const picked = scene.pick(e.position) as { id?: unknown } | undefined;
      const entityId = picked?.id instanceof Entity ? picked.id.id : undefined;
      const position = scene.pickPositionSupported ? scene.pickPosition(e.position) : undefined;
      const cart = position ?? scene.camera.pickEllipsoid(e.position, MARS_SPHERE);
      if (!cart) return;
      const c = Cartographic.fromCartesian(cart, MARS_SPHERE);
      callback(
        CesiumMath.toDegrees(c.latitude),
        normalizeLon360(CesiumMath.toDegrees(c.longitude)),
        entityId,
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
