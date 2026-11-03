import {
  ArcType,
  BoundingSphere,
  Cartesian2,
  Cartesian3,
  Cartographic,
  CesiumTerrainProvider,
  CesiumWidget,
  ColorMaterialProperty,
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
  PostProcessStage,
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
import { tintImage, type Tint } from './tint';
import { startWalk, type WalkRun, type WalkSpec } from './walkSim';
import { installCameraConstraints, maxTiltDeg } from './cameraConstraints';
import { flightPeak, flightSeconds, viewpoint } from './flight';
import { SkyRenderer, type SkyQuality } from './sky';
import { M_PER_DEG } from '../lib/math';

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
  /** Multiplies greyscale tiles by this colour (approximate natural colour, full detail). */
  tint?: Tint;
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
  | 'route-ahead'
  | 'traverse'
  | 'traverse-muted'
  | 'boundary';

/** Slope-band colours of the route core (same as the slope legend). */
const BAND_COLOURS = {
  'route-band-mild': Color.fromCssColorString('#3ff0c0'),
  'route-band-moderate': Color.fromCssColorString('#fde725'),
  'route-band-steep': Color.fromCssColorString('#f89540'),
} as const;

/** Camera tilt from looking straight down, compass heading, and the tilt allowed at this height. */
export interface ViewState {
  tiltDeg: number;
  headingDeg: number;
  maxTiltDeg: number;
}

/** A camera position: planetocentric lat/lon (deg) and metres above the areoid. */
export interface CameraPoint {
  lat: number;
  lon: number;
  heightM: number;
}

export interface LineSpec {
  id: string;
  points: Array<{ lat: number; lon: number; heightM: number }>;
  style: LineStyle;
  /** Shown only while the camera is between these distances (m), for level-of-detail versions. */
  nearM?: number;
  farM?: number;
}

const toCartesian = (lat: number, lon: number, h: number): Cartesian3 =>
  Cartesian3.fromDegrees(normalizeLon180(lon), lat, h, MARS_SPHERE);

/** Models are fetched when the camera is this close (they are drawn within 40 km). */
const MODEL_LOAD_WITHIN_M = 150_000;

export const COLOURS = {
  route: Color.fromCssColorString('#3ff0c0'),
  alternative: Color.fromCssColorString('#e8e2d6'),
  traverse: Color.fromCssColorString('#f2b84b'),
  traverseCore: Color.fromCssColorString('#e8901c'), // deep amber: the glow lifts the centre toward gold
  boundary: Color.fromCssColorString('#ffc98f'),
  boundaryCore: Color.fromCssColorString('#fff1de'),
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
    case 'route-ahead':
      // The route still to walk during the walk simulation: thin and quiet under the lit trail.
      return [
        {
          width: 6,
          material: new ColorMaterialProperty(COLOURS.outline.withAlpha(0.45)),
        },
        {
          width: 3,
          material: new ColorMaterialProperty(COLOURS.route.withAlpha(0.55)),
          depthFail: new ColorMaterialProperty(COLOURS.route.withAlpha(0.3)),
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
      // A bright amber core with a soft glow over a faint dark casing: clear on light and dark ground
      // and through the distance haze (a thin core alone turned olive at overview scale).
      const a = style === 'traverse' ? 1 : 0.35;
      return [
        {
          width: style === 'traverse' ? 5 : 3.5,
          material: new ColorMaterialProperty(COLOURS.outline.withAlpha(0.35 * a)),
        },
        {
          width: style === 'traverse' ? 7 : 4,
          material: new PolylineGlowMaterialProperty({
            color: COLOURS.traverseCore.withAlpha(a),
            glowPower: 0.28,
            taperPower: 1,
          }),
        },
      ];
    }
    case 'boundary':
      // Warm lit edge: a wide soft glow under a thin bright core.
      return [
        {
          width: 11,
          material: new PolylineGlowMaterialProperty({
            color: COLOURS.boundary.withAlpha(0.9),
            glowPower: 0.22,
            taperPower: 1,
          }),
        },
        { width: 1.6, material: new ColorMaterialProperty(COLOURS.boundaryCore.withAlpha(0.95)) },
      ];
  }
}

/** Horizon sky colour of the sky layer in daylight (Mastcam-Z sample × the 0.85 daylight blend). */
const HAZE_DAY = new Cartesian3(0.74, 0.58, 0.42);

const dots = new Map<string, HTMLCanvasElement>();
/** Filled marker disc with a light rim, drawn once per colour at 4× for crisp scaling. */
function dotImage(colour: string): HTMLCanvasElement {
  const cached = dots.get(colour);
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = c.height = 48;
  const ctx = c.getContext('2d')!;
  ctx.beginPath();
  ctx.arc(24, 24, 20, 0, 2 * Math.PI);
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(243, 239, 233, 0.9)';
  ctx.stroke();
  dots.set(colour, c);
  return c;
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
  /** Route lines saved while the walk simulation draws them muted. */
  private walkRoute: { specs: LineSpec[]; muted: LineSpec[] } | null = null;
  /** Where each placed model is (its centre, for camera close-ups). */
  readonly modelTargets = new Map<string, { lat: number; lon: number; heightM: number }>();
  /** Models placed but not yet loaded (the camera is still far away). */
  private readonly pendingModels = new Map<string, { position: Cartesian3; add: () => void }>();
  /** Lines without their own see-through style, and the material to use when looking down. */
  private readonly seeThrough = new Map<Entity, MaterialProperty>();
  private overhead = true;
  private nearModel = false;
  private viewListeners = new Set<(v: ViewState) => void>();
  private lastView = '';
  private haze: PostProcessStage;
  private hazeStrength = 0;
  private hazeTint = Cartesian3.clone(HAZE_DAY);
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
    // Dust haze: an exponential dust layer (scale height H = 11 km above the Jezero floor, vertical
    // optical depth τ = 0.4; Perseverance measured τ ≈ 0.3–0.6 outside dust storms). Each pixel adds
    // the extinction of its slant view ray beyond the vertical column above that ground point, which
    // the orbital images already contain. So views from above stay crisp, long grazing rays (distant
    // ridges, the horizon) fade into the horizon sky colour, and from orbit nothing changes. Single
    // scattering is folded into one colour: a display model, not radiative transfer.
    this.haze = new PostProcessStage({
      fragmentShader: `
        uniform sampler2D colorTexture;
        uniform sampler2D depthTexture;
        uniform vec3 hazeColor;
        uniform float tau;
        uniform float scaleHeight;
        uniform float floorRadius;
        uniform float strength;
        in vec2 v_textureCoordinates;
        float extraDepth(vec3 posEC) {
          vec3 posWC = (czm_inverseView * vec4(posEC, 1.0)).xyz;
          float hc = max(length(czm_viewerPositionWC) - floorRadius, 0.0);
          float ht = max(length(posWC) - floorRadius, 0.0);
          float ec = exp(-hc / scaleHeight);
          float et = exp(-ht / scaleHeight);
          float d = length(posEC);
          float dh = hc - ht;
          // ∫ ρ ds along the ray with height varying linearly from camera to point, ρ = e^(−z/H).
          float slant = abs(dh) > 1.0 ? d * (et - ec) / dh : d * et / scaleHeight;
          return max(tau * (slant - et), 0.0);
        }
        const vec3 LUMA = vec3(0.3, 0.59, 0.11);
        void main() {
          vec2 uv = v_textureCoordinates;
          vec4 c = texture(colorTexture, uv);
          if (c.a == 0.0) { out_FragColor = c; return; }
          // Raw (logarithmic) depth: czm_windowToEyeCoordinates undoes the log encoding itself, so
          // czm_readDepth (which also undoes it) must not be used here.
          float depth = texture(depthTexture, uv).r;
          vec2 px = 1.0 / czm_viewport.zw;
          float dE = texture(depthTexture, uv + vec2(px.x, 0.0)).r;
          float dW = texture(depthTexture, uv - vec2(px.x, 0.0)).r;
          float dN = texture(depthTexture, uv + vec2(0.0, px.y)).r;
          float dS = texture(depthTexture, uv - vec2(0.0, px.y)).r;
          if (max(max(depth, dE), max(max(dW, dN), dS)) >= 1.0) {
            // Silhouette pixel against the (transparent) background. Cesium's MSAA resolve leaves
            // its colour scaled by the sample coverage but writes alpha = 1, which drew a dark
            // stair-step line along the planet's limb over the sky. Coverage is recovered as the
            // pixel's brightness relative to its brightest covered neighbour, and restored as the
            // alpha of the (already coverage-weighted, i.e. premultiplied) colour.
            float ref = dot(c.rgb, LUMA);
            for (int i = -1; i <= 1; i++) {
              for (int j = -1; j <= 1; j++) {
                vec2 o = vec2(float(i), float(j)) * px;
                if (texture(depthTexture, uv + o).r < 1.0) ref = max(ref, dot(texture(colorTexture, uv + o).rgb, LUMA));
              }
            }
            c.a = clamp(dot(c.rgb, LUMA) / max(ref, 1e-3), 0.0, 1.0) * c.a;
          }
          if (strength <= 0.0) { out_FragColor = c; return; }
          if (depth >= 1.0) {
            // Partly covered silhouette pixel (MSAA averages colour but keeps one depth sample):
            // borrow the nearest covered neighbour's depth so the horizon edge is hazed too.
            depth = min(min(dE, dW), min(dN, dS));
            if (depth >= 1.0) { out_FragColor = vec4(mix(c.rgb, hazeColor * c.a, strength), c.a); return; }
          }
          vec4 eye = czm_windowToEyeCoordinates(gl_FragCoord.xy, depth);
          float f = (1.0 - exp(-extraDepth(eye.xyz / eye.w))) * strength;
          out_FragColor = vec4(mix(c.rgb, hazeColor * c.a, f), c.a);
        }`,
      uniforms: {
        // Horizon colour of the sky layer (Mastcam-Z sample × the 0.85 daylight blend), darkened at night.
        hazeColor: () => this.hazeTint,
        tau: 0.4,
        scaleHeight: 11_000,
        floorRadius: MARS_SPHERE_RADIUS_M - 2_500,
        strength: () => this.hazeStrength,
      },
    });
    scene.postProcessStages.add(this.haze);
    // MSAA (4×) smooths edges; FXAA is off because on a transparent canvas it leaves dark/light
    // dashes along the horizon silhouette.
    scene.postProcessStages.fxaa.enabled = false;
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
    // Cinematic edge darkening (CSS), between the 3D canvases and the labels.
    const vignette = document.createElement('div');
    vignette.className = 'map-vignette';
    container.appendChild(vignette);
    this.annotations = new AnnotationLayer(container, scene);
    scene.preRender.addEventListener(() => {
      // Haze only near the ground (full below 8 km above the terrain, none above 60 km).
      const hh = this.widget.camera.positionCartographic.height + 2_500;
      // From high orbit the limb haze of the SkyAtmosphere takes over.
      this.hazeStrength = 1 - Math.min(1, Math.max(0, (hh - 120_000) / 180_000));
      const light = 0.12 + 0.88 * (this.sky?.daylight ?? 1);
      Cartesian3.multiplyByScalar(HAZE_DAY, light, this.hazeTint);
      this.fadeImageryTiers();
      this.loadNearModels();
      this.updateLineOcclusion();
      this.updateCloseUpDeclutter();
      this.limitTilt();
      this.emitView();
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
    hdAfter?: Promise<unknown>,
  ): Promise<{ stars: boolean; quality: SkyQuality }> {
    if (!this.sky) return { stars: false, quality: 'none' };
    const result = await this.sky.load(
      starsUrl,
      milkyWay,
      (q) => {
        onQuality?.(q);
        this.requestRender(); // starts the cross-fade; postRender keeps it going
      },
      hdAfter,
    );
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

  private loadNearModels(): void {
    if (this.pendingModels.size === 0) return;
    const camera = this.widget.camera.positionWC;
    for (const [id, m] of this.pendingModels) {
      if (Cartesian3.distance(camera, m.position) >= MODEL_LOAD_WITHIN_M) continue;
      this.pendingModels.delete(id);
      m.add();
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
    // The outside-coverage mask frames the planning area from above; near the ground (e.g. the rover
    // close-up on the rim, outside coverage) it would only darken the view.
    const mask = this.rasters.get('coverageMask');
    if (mask) {
      const a = Math.min(1, Math.max(0, (h - 2_000) / 6_000));
      if (Math.abs(mask.alpha - a) > 0.01) {
        mask.alpha = a;
        this.requestRender();
      }
    }
    // HiRISE only once it fills the view: half-loaded 25 cm–0.5 m tiles over CTX read as patches.
    fade(this.rasters.get('hirise'), 12_000, 6_000);
    fade(this.rasters.get('hirise-west'), 12_000, 6_000);
    fade(this.rasters.get('hirise-rover'), 12_000, 6_000);
    // Viking colour washed over the grey tiers (alpha blend ≈ colour from 232 m, detail from 5 m /
    // 25 cm). It follows the CTX fade so the globe and the crater blend without a seam.
    const wash = this.rasters.get('colour-wash');
    const ctx = this.rasters.get('ctx');
    if (wash && ctx) {
      // The tiers are already tinted; the wash adds regional colour variation, and less of it near
      // the ground so the blurry 232 m colour does not dim the 25 cm–5 m detail.
      const nearGround = 1 - Math.min(1, Math.max(0, (h - 3_000) / 27_000));
      const a = (0.35 - 0.2 * nearGround) * ctx.alpha;
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
    if (spec.tint) {
      const tint = spec.tint;
      const request = provider.requestImage.bind(provider);
      provider.requestImage = (x, y, level, req) =>
        request(x, y, level, req)?.then((img) => tintImage(img, tint));
    }
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

  /** While walking: the selected route is drawn muted and its chevrons hidden, so the trail reads. */
  private muteRoute(on: boolean): void {
    if (this.isDestroyed()) return;
    if (on && !this.walkRoute) {
      const specs = this.lineSpecs.get('route');
      if (specs) {
        const muted = specs
          .filter((l) => !l.style.startsWith('route-band-'))
          .map((l) =>
            l.style === 'route-alternative' ? l : { ...l, style: 'route-ahead' as const },
          );
        this.walkRoute = { specs, muted };
        this.setLines('route', muted);
      }
    } else if (!on && this.walkRoute) {
      // Restore unless the route was redrawn meanwhile.
      if (this.lineSpecs.get('route') === this.walkRoute.muted)
        this.setLines('route', this.walkRoute.specs);
      this.walkRoute = null;
    }
    const arrows = !on && !this.hiddenGroups.has('routeArrows');
    for (const e of this.groups.get('routeArrows') ?? []) e.show = arrows;
    this.requestRender();
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
      const px = (m.size ?? 9) + 3;
      const entity = new Entity({
        id: `${groupId}:${m.id}`,
        show,
        position: toCartesian(m.lat, m.lon, m.heightM),
        // A billboard rather than a point: its eye offset pulls the disc toward the camera, so the
        // terrain in front of its lower half no longer clips it into a half-buried dome.
        billboard: {
          image: dotImage(m.color),
          width: px,
          height: px,
          eyeOffset: new Cartesian3(0, 0, -250),
          // Always on top only up close; from afar terrain hides markers behind ridges.
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
            distanceDisplayCondition: new DistanceDisplayCondition(
              line.nearM ?? 0,
              line.farM ?? 300_000,
            ),
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
    const pitch = CesiumMath.toRadians(-52);
    const to = viewpoint(sphere.center, heading, pitch, range, MARS_SPHERE);
    return this.flight((done) =>
      this.widget.camera.flyToBoundingSphere(sphere, {
        offset: new HeadingPitchRange(heading, pitch, range),
        duration: this.reducedMotion ? 0 : seconds,
        easingFunction: EasingFunction.QUADRATIC_IN_OUT,
        maximumHeight: flightPeak(this.widget.camera.positionWC, to, MARS_SPHERE),
        complete: done,
        cancel: done,
      }),
    );
  }

  /**
   * Straight "helicopter" flight between two camera positions: one compass heading the whole way,
   * the position eased along the straight line (no jolt at take-off or arrival), rising `peakM`
   * above the line between the two heights at mid-flight. The view tilts to keep `aimAt` (the
   * destination) ahead, between `pitchDeg` [shallowest, steepest]. Before take-off, the tiles of
   * the landing view and then of the take-off view are loaded while the camera waits (`onTakeOff`
   * then fires, e.g. to lift a veil), so the flight starts and arrives over sharp imagery. The caller plans the terrain clearance, so
   * the exploration limits and Cesium's 220 m collision floor are off meanwhile (they would hold the
   * camera far above a take-off just over a panorama). They stay off after arrival until
   * `release()` (e.g. once the next view covers the map), so the camera is not lifted on landing.
   * Any pointer or wheel input on the map stops it; resolves true on arrival.
   */
  flyLine(spec: {
    from: CameraPoint;
    to: CameraPoint;
    headingDeg: number;
    aimAt: CameraPoint;
    pitchDeg: [number, number];
    peakM: number;
    seconds: number;
    onTakeOff?: () => void;
  }): { done: Promise<boolean>; stop: () => void; release: () => void } {
    const camera = this.widget.camera;
    const canvas = this.widget.canvas;
    const controller = this.widget.scene.screenSpaceCameraController;
    const { from, to } = spec;
    const lon0 = normalizeLon180(from.lon);
    const dLon = normalizeLon180(to.lon - from.lon);
    const heading = CesiumMath.toRadians(spec.headingDeg);
    const aim = spec.aimAt;
    const place = (e: number) => {
      const lat = from.lat + (to.lat - from.lat) * e;
      const lon = lon0 + dLon * e;
      const heightM =
        from.heightM + (to.heightM - from.heightM) * e + spec.peakM * Math.sin(Math.PI * e);
      // Look down at the destination: the angle steepens as it comes closer (never sideways).
      const ahead = Math.hypot(
        (aim.lat - lat) * M_PER_DEG,
        normalizeLon180(aim.lon - lon) * M_PER_DEG * Math.cos(CesiumMath.toRadians(lat)),
      );
      const toward = -CesiumMath.toDegrees(Math.atan2(heightM - aim.heightM, ahead));
      const pitch = Math.min(spec.pitchDeg[0], Math.max(spec.pitchDeg[1], toward));
      camera.setView({
        destination: toCartesian(lat, lon, heightM),
        orientation: { heading, pitch: CesiumMath.toRadians(pitch), roll: 0 },
      });
      this.requestRender();
    };
    let stopped = false;
    let arrived = false;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      canvas.removeEventListener('pointerdown', stop);
      canvas.removeEventListener('wheel', stop);
      if (!this.isDestroyed()) controller.enableCollisionDetection = collide;
      this.constraints.suspend(false);
    };
    const stop = () => {
      stopped = true;
      if (arrived) release();
    };
    canvas.addEventListener('pointerdown', stop, { once: true });
    canvas.addEventListener('wheel', stop, { once: true });
    // A flight still under way (e.g. into Jezero, when the tour starts right after) would move the
    // camera every frame too. Cancelling it first: its cancel handler also resets the constraints.
    camera.cancelFlight();
    this.constraints.suspend(true);
    const collide = controller.enableCollisionDetection;
    controller.enableCollisionDetection = false;
    const done = new Promise<boolean>((resolve) => {
      const finish = () => {
        if (!arrived) release();
        resolve(arrived);
      };
      // Timed by the frames' own timestamps (rAF), from the first frame: steps follow the
      // displayed frames, and an idle page's stale clock cannot make the start jump.
      let t0 = -1;
      const frame = (ts: number) => {
        if (stopped || this.isDestroyed()) return finish();
        if (t0 < 0) t0 = ts;
        const t = Math.min(1, (ts - t0) / (spec.seconds * 1000));
        place(t * t * t * (t * (6 * t - 15) + 10)); // smootherstep: no jolt at either end
        if (t >= 1) {
          arrived = true;
          return finish();
        }
        window.requestAnimationFrame(frame);
      };
      // Landing view first (cached), then the take-off view; both under the caller's veil.
      void (async () => {
        place(1);
        await this.whenTilesLoaded(1_000);
        if (stopped || this.isDestroyed()) return finish();
        place(0);
        await this.whenTilesLoaded(1_200);
        if (stopped || this.isDestroyed()) return finish();
        spec.onTakeOff?.();
        window.requestAnimationFrame(frame);
      })();
    });
    return { done, stop, release };
  }

  /** Cinematic walk simulation along a route (see walkSim.ts). */
  startWalk(spec: WalkSpec): WalkRun {
    const points = spec.track.points;
    return startWalk(
      {
        widget: this.widget,
        ellipsoid: MARS_SPHERE,
        suspend: (on) => {
          this.constraints.suspend(on);
          this.muteRoute(on);
        },
        requestRender: () => this.requestRender(),
        frameRoute: () => this.flyToPath(points, 2.8),
      },
      spec,
    );
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
    this.pendingModels.delete(groupId);
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
    // The glTF (Perseverance: 2.3 MB) is only fetched once the camera comes within reach of it.
    const add = () => {
      entity.show = !this.hiddenGroups.has(groupId);
      this.group(groupId).push(entity);
      this.widget.entities.add(entity);
      this.requestRender();
    };
    if (Cartesian3.distance(this.widget.camera.positionWC, position) < MODEL_LOAD_WITHIN_M) add();
    else this.pendingModels.set(groupId, { position, add });
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
    const lat = t.lat - (horizontal * Math.cos(h)) / M_PER_DEG;
    const lon =
      t.lon - (horizontal * Math.sin(h)) / (M_PER_DEG * Math.cos(CesiumMath.toRadians(t.lat)));
    const pose = async () => {
      const [ground] = await this.sampleTerrain([{ lat, lon }]);
      const height = Math.max(
        t.heightM + rangeM * Math.sin(CesiumMath.toRadians(elevationDeg)),
        (ground ?? t.heightM) + 6,
      );
      return {
        destination: toCartesian(lat, lon, height),
        pitch: -Math.atan2(height - t.heightM, horizontal),
      };
    };
    const first = await pose();
    const from = this.widget.camera.positionWC;
    await this.flight((done) =>
      this.widget.camera.flyTo({
        destination: first.destination,
        orientation: { heading: h, pitch: first.pitch, roll: 0 },
        duration: this.reducedMotion ? 0 : flightSeconds(from, first.destination, 3),
        easingFunction: EasingFunction.QUADRATIC_IN_OUT,
        maximumHeight: flightPeak(from, first.destination, MARS_SPHERE),
        complete: done,
        cancel: done,
      }),
    );
    // A long flight ends before the detailed terrain arrives, and the clearance floor computed on
    // the coarse tiles can lift the camera (straight up). Once tiles are loaded, re-place it, unless
    // the user has since moved sideways or turned.
    const camera = this.widget.camera;
    const landed = {
      lon: camera.positionCartographic.longitude,
      lat: camera.positionCartographic.latitude,
      heading: camera.heading,
      pitch: camera.pitch,
    };
    await this.whenTilesLoaded(8_000);
    if (this.isDestroyed()) return;
    const now = camera.positionCartographic;
    const movedM =
      Math.hypot(now.latitude - landed.lat, (now.longitude - landed.lon) * Math.cos(now.latitude)) *
      MARS_SPHERE_RADIUS_M;
    if (
      movedM > 1 ||
      Math.abs(camera.heading - landed.heading) > 1e-3 ||
      Math.abs(camera.pitch - landed.pitch) > 1e-3
    )
      return;
    const settled = await pose();
    if (Cartesian3.distance(settled.destination, camera.positionWC) < 0.5) return;
    camera.setView({
      destination: settled.destination,
      orientation: { heading: h, pitch: settled.pitch, roll: 0 },
    });
    this.requestRender();
  }

  private heightAboveGround(): number {
    return this.widget.camera.positionCartographic.height + 2_500; // above the Jezero floor
  }

  viewState(): ViewState {
    const camera = this.widget.camera;
    return {
      tiltDeg: 90 + CesiumMath.toDegrees(camera.pitch),
      headingDeg: CesiumMath.toDegrees(camera.heading),
      maxTiltDeg: maxTiltDeg(this.heightAboveGround()),
    };
  }

  onViewChange(listener: (v: ViewState) => void): () => void {
    this.viewListeners.add(listener);
    listener(this.viewState());
    return () => this.viewListeners.delete(listener);
  }

  private emitView(): void {
    if (this.viewListeners.size === 0) return;
    const v = this.viewState();
    const key = `${Math.round(v.tiltDeg)}:${Math.round(v.headingDeg)}:${Math.round(v.maxTiltDeg)}`;
    if (key === this.lastView) return;
    this.lastView = key;
    for (const l of this.viewListeners) l(v);
  }

  /** Ground point at the centre of the view (the point tilt and heading changes orbit around). */
  private centreTarget(): Cartesian3 | undefined {
    const scene = this.widget.scene;
    const centre = new Cartesian2(scene.canvas.clientWidth / 2, scene.canvas.clientHeight / 2);
    const ray = this.widget.camera.getPickRay(centre);
    return (
      (ray && scene.globe.pick(ray, scene)) ??
      this.widget.camera.pickEllipsoid(centre, scene.globe.ellipsoid) ??
      undefined
    );
  }

  /**
   * Keeps the tilt within what this height allows (see maxTiltDeg): zooming out of an oblique view
   * straightens it gradually toward looking down, orbiting the point at the centre of the view.
   */
  private limitTilt(): void {
    if (this.constraints.suspended) return;
    const camera = this.widget.camera;
    const allowed = maxTiltDeg(this.heightAboveGround());
    const tilt = 90 + CesiumMath.toDegrees(camera.pitch);
    if (tilt <= allowed + 0.25) return;
    const target = this.centreTarget();
    if (!target) return;
    const range = Cartesian3.distance(camera.positionWC, target);
    camera.lookAt(
      target,
      new HeadingPitchRange(camera.heading, CesiumMath.toRadians(allowed - 90), range),
    );
    camera.lookAtTransform(Matrix4.IDENTITY);
  }

  /** Orbits the camera around the centre of the view to a tilt and heading (animated). */
  private orbitView(tiltDeg: number, headingRad: number): Promise<void> {
    const target = this.centreTarget();
    if (!target) return Promise.resolve();
    const camera = this.widget.camera;
    const range = Cartesian3.distance(camera.positionWC, target);
    const tilt = Math.min(tiltDeg, maxTiltDeg(this.heightAboveGround()));
    const pitch = CesiumMath.toRadians(tilt - 90);
    const to = viewpoint(target, headingRad, pitch, range, MARS_SPHERE);
    return this.flight((done) =>
      camera.flyToBoundingSphere(new BoundingSphere(target, 0), {
        offset: new HeadingPitchRange(headingRad, pitch, range),
        duration: this.reducedMotion ? 0 : 0.9,
        easingFunction: EasingFunction.QUADRATIC_IN_OUT,
        maximumHeight: flightPeak(camera.positionWC, to, MARS_SPHERE),
        complete: done,
        cancel: done,
      }),
    );
  }

  /** Google-Maps-style 2D / 3D: straight down, or an oblique view of the same place. */
  setTilt(tiltDeg: number): Promise<void> {
    return this.orbitView(tiltDeg, this.widget.camera.heading);
  }

  /** North up, keeping the tilt and the place at the centre of the view. */
  resetNorth(): Promise<void> {
    return this.orbitView(90 + CesiumMath.toDegrees(this.widget.camera.pitch), 0);
  }

  /** Compass heading of the camera (° from north, clockwise). */
  cameraHeadingDeg(): number {
    return CesiumMath.toDegrees(this.widget.camera.heading);
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
    const from = this.widget.camera.positionWC;
    const to = toCartesian(lat, lon, heightM);
    return this.flight((done) =>
      this.widget.camera.flyTo({
        destination: to,
        orientation: {
          heading: CesiumMath.toRadians(headingDeg),
          pitch: CesiumMath.toRadians(pitchDeg),
          roll: 0,
        },
        duration: this.reducedMotion ? 0 : flightSeconds(from, to, seconds),
        easingFunction: EasingFunction.QUADRATIC_IN_OUT,
        maximumHeight: flightPeak(from, to, MARS_SPHERE),
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
    const target = toCartesian(lat, lon, heightM);
    const heading = CesiumMath.toRadians(headingDeg);
    const pitch = CesiumMath.toRadians(pitchDeg);
    const from = this.widget.camera.positionWC;
    const to = viewpoint(target, heading, pitch, rangeM, MARS_SPHERE);
    return this.flight((done) =>
      this.widget.camera.flyToBoundingSphere(new BoundingSphere(target, 1), {
        offset: new HeadingPitchRange(heading, pitch, rangeM),
        duration: this.reducedMotion ? 0 : flightSeconds(from, to, seconds),
        easingFunction: EasingFunction.QUADRATIC_IN_OUT,
        maximumHeight: flightPeak(from, to, MARS_SPHERE),
        complete: done,
        cancel: done,
      }),
    );
  }

  /**
   * Hands the camera to the caller (e.g. the rover game's chase camera, set every frame): user
   * camera input, Cesium's collision floor and the exploration limits are all off until released.
   */
  takeCamera(on: boolean): void {
    const c = this.widget.scene.screenSpaceCameraController;
    c.enableInputs = !on;
    c.enableCollisionDetection = !on;
    this.constraints.suspend(on);
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
