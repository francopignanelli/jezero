import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DirectionalLight,
  FogExp2,
  HalfFloatType,
  Mesh,
  MeshBasicMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PointLight,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { installHeightHaze } from './atmosphere';
import { CameraRig, type CameraMode } from './cameraRig';
import {
  CoreMarks,
  DustDevil,
  DustParticles,
  TargetMarker,
  Tracks,
  type TrackGround,
} from './effects';
import { CraterField, bakeCraters, generateCraters, toneCraters } from './features';
import { LocalFrame, Terrain, loadHeights, type AreaMeta, type WorldManifest } from './heights';
import { Ingenuity } from './ingenuity';
import { RockField, type Rock } from './rocks';
import { DepotTubes, RouteLine } from './route';
import { CORE_SHOULDER, Rover3D, type ArmPose } from './rover3d';
import { HORIZON_LINEAR, SkyDome, sunDirection } from './sky';
import { CLEAR_INNER_M, CLEAR_OUTER_M, TerrainMesh, type GroundTextures } from './terrain';
import { loadGrey, loadGroundTextures } from './textures';

export type Quality = 'high' | 'medium' | 'low';

const QUALITY: Record<
  Quality,
  {
    pixelRatio: number;
    shadow: number;
    rocks: [number, number];
    bloom: boolean;
    msaa: number;
    devils: number;
  }
> = {
  high: { pixelRatio: 2, shadow: 4096, rocks: [45, 260], bloom: true, msaa: 4, devils: 3 },
  medium: { pixelRatio: 1.25, shadow: 2048, rocks: [30, 170], bloom: true, msaa: 4, devils: 2 },
  low: { pixelRatio: 1, shadow: 1024, rocks: [18, 90], bloom: false, msaa: 0, devils: 1 },
};

/**
 * Light levels: Mars gets 43 % of Earth's sunlight through a dusty sky, so the scene is kept dim.
 * Little sky light fills the shadows, which keeps the relief well defined.
 */
const LIGHT = { sun: 2.75, environment: 0.5, exposure: 0.84, sky: 1.0, haze: 1.6e-4 };

/** Sun per area: a mid-morning Sun (compass azimuth, elevation), for long but not hard shadows. */
const SUN: Record<string, [number, number]> = {
  delta: [118, 36],
};

/** Marker colours per kind of target. */
const TARGET_COLOURS: Record<string, [number, number, number]> = {
  sample: [1.0, 0.62, 0.25],
  depot: [0.35, 0.75, 1.0],
  panorama: [0.78, 0.55, 1.0],
  reach: [1.0, 0.9, 0.55],
};

/**
 * Keeps the HDR frame finite and bounded before the bloom: one non-finite pixel (e.g. the Sun's
 * glint on a glossy part, beyond half-float range) would otherwise spread over the whole image.
 */
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    // Bit test for Inf/NaN (all exponent bits set): compilers may drop isnan() as "never true".
    bool bad(float x) { return (floatBitsToUint(x) & 0x7f800000u) == 0x7f800000u; }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      if (bad(c.r) || bad(c.g) || bad(c.b) || bad(c.a)) c = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = vec4(min(c.rgb, vec3(12.0)), c.a);
    }`,
};

/** Vignette and a little film grain: the look of the rover cameras' processed frames. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uStorm: { value: 0 },
    uTexel: { value: new Vector2(1 / 1600, 1 / 900) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime, uStorm; uniform vec2 uTexel;
    varying vec2 vUv;
    float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime) * 43758.5453); }
    float hs(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vn(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hs(i), hs(i + vec2(1, 0)), f.x), mix(hs(i + vec2(0, 1)), hs(i + vec2(1, 1)), f.x), f.y);
    }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      // Light unsharp mask: crisper edges and fine relief.
      vec3 blur = (texture2D(tDiffuse, vUv + vec2(uTexel.x, 0.0)).rgb + texture2D(tDiffuse, vUv - vec2(uTexel.x, 0.0)).rgb
                 + texture2D(tDiffuse, vUv + vec2(0.0, uTexel.y)).rgb + texture2D(tDiffuse, vUv - vec2(0.0, uTexel.y)).rgb) * 0.25;
      c.rgb = max(c.rgb + (c.rgb - blur) * 0.45, 0.0);
      vec2 d = vUv - 0.5;
      float v = 1.0 - dot(d, d) * 0.55;
      c.rgb *= v;
      // Dust storm: veils of dust blowing across the view.
      if (uStorm > 0.0) {
        vec2 q = vUv * vec2(2.5, 6.0) + vec2(-uTime * 0.9, uTime * 0.05);
        float veil = vn(q) * 0.6 + vn(q * 2.7 + 3.0) * 0.4;
        vec3 dust = vec3(0.55, 0.36, 0.22) * (0.6 + 0.4 * dot(c.rgb, vec3(0.33)));
        c.rgb = mix(c.rgb, dust, uStorm * (0.18 + 0.3 * veil));
      }
      c.rgb += (h(vUv * 1000.0) - 0.5) * 0.012 * (c.r + c.g + c.b);
      gl_FragColor = c;
    }`,
};

/** Photo-mode filters, after the rover's own cameras (applied to the final, display image). */
export const PHOTO_FILTERS = ['natural', 'whiteBalance', 'enhanced', 'navcam', 'hazcam'] as const;
export type PhotoFilter = (typeof PHOTO_FILTERS)[number];

/**
 * The filters:
 * - White balance: as if lit by Earth daylight. NASA releases Mastcam-Z images like this so that
 *   geologists can read the rocks' colours as on Earth.
 * - Enhanced colour: a contrast and saturation stretch, as in the enhanced-colour releases.
 * - Navcam: the black-and-white navigation cameras.
 * - Hazcam: the fisheye hazard cameras, black and white, with their round field.
 */
const PhotoShader = {
  uniforms: {
    tDiffuse: { value: null },
    uMode: { value: 0 },
    uTime: { value: 0 },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform int uMode; uniform float uTime, uAspect;
    varying vec2 vUv;
    float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime) * 43758.5453); }
    float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
    void main() {
      vec2 uv = vUv;
      float mask = 1.0;
      if (uMode == 4) {
        // Fisheye: radial (barrel) distortion, a round field of view.
        vec2 d = (uv - 0.5) * vec2(uAspect, 1.0);
        float r = length(d);
        uv = 0.5 + d * (0.62 + 0.55 * r * r) / vec2(uAspect, 1.0);
        mask = 1.0 - smoothstep(0.5, 0.53, r);
      }
      vec3 c = texture2D(tDiffuse, clamp(uv, 0.0, 1.0)).rgb;
      if (uMode == 1) {
        c *= vec3(0.8, 1.0, 1.42);
        c = mix(vec3(lum(c)), c, 0.9) * 1.04;
      } else if (uMode == 2) {
        float l = lum(c);
        c = clamp((c - 0.5) * 1.35 + 0.5 + (c - l) * 0.9, 0.0, 1.0);
      } else if (uMode >= 3) {
        float l = lum(c);
        l = clamp((l - 0.45) * 1.5 + 0.48, 0.0, 1.0);
        l += (h(vUv * 800.0) - 0.5) * 0.05;
        c = vec3(l);
      }
      gl_FragColor = vec4(c * mask, 1.0);
    }`,
};

// Sand map: the same weights the terrain shader uses for its sand layer (terrain.ts), so the
// soft sand the wheels feel is the sand that is drawn.
function hash12(x: number, y: number): number {
  let a = (x * 0.1031) % 1;
  let b = (y * 0.1031) % 1;
  let c = a;
  if (a < 0) a += 1;
  if (b < 0) b += 1;
  if (c < 0) c += 1;
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d;
  b += d;
  c += d;
  const v = ((a + b) * c) % 1;
  return v < 0 ? v + 1 : v;
}
function vnoise(x: number, y: number): number {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash12(i, j);
  const b = hash12(i + 1, j);
  const c = hash12(i, j + 1);
  const d = hash12(i + 1, j + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Part of the coring sequence (progress 0–1) during which the drill runs. */
export const DRILL_PHASE: [number, number] = [0.38, 0.78];

/**
 * Arm keyframes over the coring progress:
 * [progress, shoulder (× CORE_SHOULDER), elbow (× the ground-reaching angle), elbow offset (rad), wrist (rad)].
 * The sequence:
 * - Unfold, and turn the turret to the coring drill.
 * - Hover, then press onto the ground.
 * - Drill in a few centimetres.
 * - Lift, holding the core up.
 * - Fold back.
 */
const ARM_KEYS: Array<[number, number, number, number, number]> = [
  [0, 0, 0, 0, 0],
  [0.04, 0, 0, 0, 0],
  [0.14, 0.5, 0.35, 0, 0],
  [0.3, 1, 1, -0.14, Math.PI / 2],
  [0.36, 1, 1, 0, Math.PI / 2],
  [0.78, 1, 1, 0.035, Math.PI / 2],
  [0.86, 0.8, 1, -0.34, Math.PI / 2],
  [0.9, 0.8, 1, -0.34, Math.PI / 2],
  [1, 0, 0, 0, 0],
];

const ease = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

function armPoseAt(c: number, coreElbow: number): ArmPose {
  let k = 0;
  while (k < ARM_KEYS.length - 2 && c > ARM_KEYS[k + 1]![0]) k++;
  const a = ARM_KEYS[k]!;
  const b = ARM_KEYS[k + 1]!;
  const t = ease((c - a[0]) / (b[0] - a[0]));
  const lerp = (i: number) => a[i]! + (b[i]! - a[i]!) * t;
  const [d0, d1] = DRILL_PHASE;
  return {
    shoulder: lerp(1) * CORE_SHOULDER,
    elbow: lerp(2) * coreElbow + lerp(3),
    wrist: lerp(4),
    drill: Math.min(1, Math.max(0, (c - d0) * 40, 0)) * (c < d1 ? 1 : 0),
  };
}

interface GreyImage {
  grey: Uint8Array;
  width: number;
  height: number;
  cellM: number;
  widthM: number;
  heightM: number;
}

export interface ScenePose {
  x: number;
  y: number;
  z: number;
  headingRad: number;
  pitchRad: number;
  rollRad: number;
}

/**
 * The game's 3D world (three.js): renderer, sky and Sun, the terrain and rocks of one mission
 * area, the animated rover, dust, tracks and target markers, post-processing.
 */
export class World {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(55, 1, 0.3, 90_000);
  readonly rig: CameraRig;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass | null = null;
  private grade: ShaderPass;
  private readonly sun = new DirectionalLight(0xfff0e0, LIGHT.sun);
  private sky: SkyDome | null = null;
  private ground: GroundTextures | null = null;
  terrain: Terrain | null = null;
  frame: LocalFrame | null = null;
  private terrainMesh: TerrainMesh | null = null;
  rocks: RockField | null = null;
  rover: Rover3D | null = null;
  readonly dust = new DustParticles();
  readonly tracks = new Tracks();
  readonly coreMarks = new CoreMarks();
  private craters: CraterField | null = null;
  /** Sample sites, starts and the depot (local x, north): firm ground, no craters. */
  private clearPoints: Array<[number, number]> = [];
  private readonly devils: DustDevil[] = [];
  private markers = new Map<string, TargetMarker>();
  private albedoGrey: GreyImage | null = null;
  /** The 25 cm core image (sharper brightness where it covers). */
  private coreGrey: GreyImage | null = null;
  readonly ingenuity = new Ingenuity();
  readonly route = new RouteLine();
  readonly depotTubes = new DepotTubes();
  readonly wind = new Vector3(1.6, 0, -0.6);
  private time = 0;
  private photoPass: ShaderPass;
  /** Dust storm strength (0–1) and the clear-sky values it scales. */
  private storm = 0;
  private readonly clearFog = LIGHT.haze;
  /** SuperCam: the beam, the plasma's glow and light, and the rock being analysed. */
  private readonly laserBeam: Mesh;
  private readonly laserFlash: Mesh;
  private readonly laserLight = new PointLight(0xd8c8ff, 0, 4, 2);
  private laser: { at: Vector3; progress: number } | null = null;
  private readonly cfg: (typeof QUALITY)[Quality];
  areaId: string | null = null;

  constructor(
    readonly host: HTMLElement,
    readonly quality: Quality,
  ) {
    this.cfg = QUALITY[quality];
    this.renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.cfg.pixelRatio));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = LIGHT.exposure;
    installHeightHaze();
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.rig = new CameraRig(this.camera, this.renderer.domElement);

    // Dust haze, thinning with height (atmosphere.ts), the colour of the horizon sky.
    this.scene.fog = new FogExp2(HORIZON_LINEAR.clone().multiplyScalar(LIGHT.sky), LIGHT.haze);
    this.scene.add(this.sun, this.sun.target);
    this.sun.castShadow = true;
    const sh = this.sun.shadow;
    sh.mapSize.set(this.cfg.shadow, this.cfg.shadow);
    sh.camera.left = sh.camera.bottom = -38;
    sh.camera.right = sh.camera.top = 38;
    sh.camera.near = 1;
    sh.camera.far = 600;
    sh.bias = -0.0004;
    sh.normalBias = 0.03;
    sh.radius = 3;
    this.scene.add(this.dust.points);
    for (const m of this.tracks.meshes) this.scene.add(m);
    this.scene.add(
      this.coreMarks.group,
      this.ingenuity.root,
      this.route.mesh,
      this.depotTubes.group,
    );
    for (let i = 0; i < this.cfg.devils; i++) {
      const d = new DustDevil(110);
      this.devils.push(d);
      this.scene.add(d.mesh);
    }

    const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: this.cfg.msaa });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new ShaderPass(SanitizeShader));
    if (this.cfg.bloom) {
      this.bloom = new UnrealBloomPass(new Vector2(256, 256), 0.18, 0.5, 2.2);
      this.composer.addPass(this.bloom);
    }
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.photoPass = new ShaderPass(PhotoShader);
    this.photoPass.enabled = false;
    this.composer.addPass(this.photoPass);

    // Laser: a thin beam (the real one is infrared, invisible: drawn so it can be seen) and the
    // plasma spark on the rock. The light exists from the start (adding one later would
    // recompile every material).
    const beamGeo = new CylinderGeometry(0.006, 0.006, 1, 6, 1, true);
    beamGeo.translate(0, 0.5, 0);
    beamGeo.rotateX(Math.PI / 2);
    this.laserBeam = new Mesh(
      beamGeo,
      new MeshBasicMaterial({
        color: new Color(3, 0.6, 1.2),
        transparent: true,
        opacity: 0.55,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.laserBeam.visible = false;
    this.laserBeam.frustumCulled = false;
    this.laserFlash = new Mesh(
      new SphereGeometry(0.035, 12, 8),
      new MeshBasicMaterial({
        color: new Color(9, 8, 12),
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.laserFlash.visible = false;
    this.scene.add(this.laserBeam, this.laserFlash, this.laserLight);
    this.resize();
  }

  resize(): void {
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    const pr = this.renderer.getPixelRatio();
    (this.grade.uniforms.uTexel as { value: Vector2 }).value.set(1 / (w * pr), 1 / (h * pr));
    this.dust.setViewportHeight(h * this.renderer.getPixelRatio(), this.camera.fov);
    (this.photoPass.uniforms.uAspect as { value: number }).value = w / h;
  }

  async loadRover(url: string): Promise<void> {
    this.rover = await Rover3D.load(url);
    this.scene.add(this.rover.root);
  }

  /**
   * Loads (or switches to) a mission area: terrain layers, orbital albedo, ground textures, rocks,
   * and the generated craters (kept clear of the `keepClear` points: sample sites, starts).
   */
  async loadArea(
    manifest: WorldManifest,
    id: string,
    keepClear: Array<{ lat: number; lon: number }> = [],
  ): Promise<void> {
    const area = manifest.areas.find((a) => a.id === id);
    if (!area) throw new Error(`no game area ${id}`);
    if (this.areaId === id) return;
    const base = area.detail.heights.baseM;
    // The 25 cm core image: not on Low (its 4096² texture and the memory it takes).
    const coreMeta = this.quality !== 'low' ? area.core?.albedo : undefined;
    const [detail, mid, far, aDetail, aMid, aFar, ground, aCore] = await Promise.all([
      loadHeights(area.detail.heights, base),
      loadHeights(area.mid.heights, base),
      loadHeights(area.far.heights, base),
      loadGrey(area.detail.albedo),
      loadGrey(area.mid.albedo),
      loadGrey(area.far.albedo),
      this.ground ? Promise.resolve(this.ground) : loadGroundTextures(manifest.ground),
      coreMeta ? loadGrey(coreMeta) : Promise.resolve(null),
    ]);
    this.ground = ground;
    this.unloadArea();
    this.areaId = id;
    const frame = new LocalFrame(area.lat, area.lon);
    this.frame = frame;
    const greyCellM = area.detail.albedo.cellM ?? 0.5;
    const clear = keepClear
      .map((p) => frame.toLocal(p.lat, p.lon))
      .filter(([x, n]) => Math.abs(x) < detail.widthM / 2 && Math.abs(n) < detail.heightM / 2);
    this.clearPoints = clear;
    const craters = generateCraters(id, detail.widthM, detail.heightM, clear);
    bakeCraters(craters, detail, {
      data: aDetail.grey,
      width: aDetail.width,
      height: aDetail.height,
      cellM: greyCellM,
    });
    aDetail.texture.needsUpdate = true;
    this.coreGrey = null;
    if (aCore && coreMeta) {
      this.coreGrey = {
        grey: aCore.grey,
        width: aCore.width,
        height: aCore.height,
        cellM: coreMeta.cellM,
        widthM: coreMeta.widthM,
        heightM: coreMeta.heightM,
      };
      toneCraters(craters, { ...this.coreGrey, data: aCore.grey });
      aCore.texture.needsUpdate = true;
    }
    this.craters = new CraterField(craters);
    this.terrain = new Terrain(detail, mid, far);
    this.albedoGrey = {
      grey: aDetail.grey,
      width: aDetail.width,
      height: aDetail.height,
      cellM: greyCellM,
      widthM: area.detail.heights.widthM,
      heightM: area.detail.heights.heightM,
    };
    this.terrainMesh = new TerrainMesh(
      this.terrain,
      ground,
      {
        detail: aDetail.texture,
        mid: aMid.texture,
        far: aFar.texture,
        ...(aCore && this.coreGrey
          ? {
              core: {
                texture: aCore.texture,
                widthM: this.coreGrey.widthM,
                heightM: this.coreGrey.heightM,
                cellM: this.coreGrey.cellM,
              },
            }
          : {}),
      },
      this.quality !== 'low',
    );
    this.terrainMesh.setClear(clear);
    this.tracks.setColour(ground.mean[0]!);
    this.scene.add(this.terrainMesh.mesh);
    const terrain = this.terrain;
    this.rocks = new RockField(
      {
        height: (x, n) => terrain.heightAt(x, n),
        brightness: (x, n) => this.brightness(x, n),
        slope: (x, n) => 1 - terrain.normalAt(x, n, 1.5)[1],
        rockiness: (x, n) => this.craters?.rockiness(x, n) ?? 0,
      },
      ground.albedo,
      this.cfg.rocks,
    );
    for (const m of this.rocks.group) this.scene.add(m);
    this.setSun(area);
    this.tracks.clear();
    this.coreMarks.clear();
  }

  private setSun(area: AreaMeta): void {
    const [az, el] = SUN[area.id] ?? [105, 32];
    const dir = sunDirection(az, el);
    this.sky?.dispose();
    if (this.sky) this.scene.remove(this.sky.mesh);
    this.sky = new SkyDome(dir, LIGHT.sky);
    this.sky.setStorm(this.storm);
    this.scene.add(this.sky.mesh);
    this.scene.background = null;
    this.scene.environment?.dispose();
    this.scene.environment = this.sky.environment(this.renderer);
    this.scene.environmentIntensity = LIGHT.environment * (1 - 0.35 * this.storm);
    this.sunDir.copy(dir);
  }
  private readonly sunDir = new Vector3(0, 1, 0);

  private unloadArea(): void {
    if (this.terrainMesh) {
      this.scene.remove(this.terrainMesh.mesh);
      this.terrainMesh.dispose();
      this.terrainMesh = null;
    }
    if (this.rocks) {
      for (const m of this.rocks.group) this.scene.remove(m);
      this.rocks.dispose();
      this.rocks = null;
    }
    this.clearTargets();
  }

  /** Orbital brightness 0–1 at a local point (HiRISE, 25 cm where it covers), 0.5 outside. */
  brightness(x: number, north: number): number {
    for (const a of [this.coreGrey, this.albedoGrey]) {
      if (!a) continue;
      const c = Math.floor((x + a.widthM / 2) / a.cellM);
      const r = Math.floor((a.heightM / 2 - north) / a.cellM);
      if (c < 0 || r < 0 || c >= a.width || r >= a.height) continue;
      return a.grey[r * a.width + c]! / 255;
    }
    return 0.5;
  }

  /** Ground height (world y) including rocks: what the wheels touch. */
  surfaceAt(x: number, north: number): number {
    if (!this.terrain) return 0;
    return this.terrain.heightAt(x, north) + (this.rocks?.rockLift(x, north) ?? 0);
  }

  groundY = (x: number, z: number): number => (this.terrain ? this.terrain.heightAt(x, -z) : 0);

  /** Soft sand at a local point (0–1): the terrain shader's sand drifts (deep sand). */
  sandAt(x: number, north: number): number {
    if (!this.terrain) return 0;
    const m = this.brightness(x, north);
    const slope = 1 - this.terrain.normalAt(x, north, 1)[1];
    const n1 = vnoise(x * 0.045, north * 0.045);
    const sand = smooth(0.42, 0.22, m + 0.22 * (n1 - 0.5)) * (1 - smooth(0.06, 0.16, slope));
    let d = Infinity;
    for (const [px, pn] of this.clearPoints) d = Math.min(d, Math.hypot(x - px, north - pn));
    return (
      sand *
      smooth(0.6, 0.8, vnoise(x * 0.02 + 7, north * 0.02 + 7)) *
      smooth(CLEAR_INNER_M, CLEAR_OUTER_M, d)
    );
  }

  // ---------- dust storm ----------

  /**
   * Dust storm strength (0 clear … 1 full):
   * - the haze closes in (visibility of a few hundred metres);
   * - the sky and the Sun dim and redden;
   * - dust streams past;
   * - the dust devils are swallowed.
   */
  setStorm(s: number): void {
    this.storm = Math.min(1, Math.max(0, s));
    const k = this.storm;
    const fog = this.scene.fog as FogExp2;
    fog.density = this.clearFog * (1 + k * 30);
    fog.color.copy(HORIZON_LINEAR).multiplyScalar(LIGHT.sky * (1 - 0.42 * k));
    this.sun.intensity = LIGHT.sun * (1 - 0.62 * k);
    this.scene.environmentIntensity = LIGHT.environment * (1 - 0.35 * k);
    this.sky?.setStorm(k);
    (this.grade.uniforms.uStorm as { value: number }).value = k;
    for (const d of this.devils) d.mesh.visible = d.mesh.visible && k < 0.3;
  }

  get stormLevel(): number {
    return this.storm;
  }

  // ---------- SuperCam laser ----------

  /**
   * The rock SuperCam would aim at: the one nearest the centre of the view, within its range of
   * the mast and in front of the camera.
   */
  laserTarget(rangeM: number): Rock | null {
    if (!this.rocks || !this.rover) return null;
    const head = this.rover.toWorld(this.tmp.set(-0.57, 2.06, 0.7), this.tmp3);
    const fwd = this.camera.getWorldDirection(this.tmp2).setY(0).normalize();
    let best: Rock | null = null;
    let bestScore = Infinity;
    for (const r of this.rocks.near(head.x, -head.z, rangeM, this.nearRocks)) {
      if (r.radiusM < 0.07) continue;
      const dx = r.x - head.x;
      const dz = -r.north - head.z;
      const d = Math.hypot(dx, dz);
      if (d > rangeM || d < 1.2) continue;
      const cos = (dx * fwd.x + dz * fwd.z) / d;
      if (cos < 0.82) continue; // within ~35° of the view's centre
      const score = (1 - cos) * 6 + d / rangeM;
      if (score < bestScore) {
        bestScore = score;
        best = r;
      }
    }
    return best;
  }
  private readonly nearRocks: Rock[] = [];

  /** World point on top of a rock (where the laser hits). */
  rockTop(r: Rock, target: Vector3): Vector3 {
    return target.set(r.x, r.y + r.sy * 0.9, -r.north);
  }

  /** The laser at work on a point (progress 0–1), or off. */
  setLaser(at: Vector3 | null, progress = 0): void {
    this.laser = at ? { at: at.clone(), progress } : null;
  }

  // ---------- photo mode ----------

  setPhotoFilter(f: PhotoFilter): void {
    const mode = PHOTO_FILTERS.indexOf(f);
    (this.photoPass.uniforms.uMode as { value: number }).value = mode;
    this.photoPass.enabled = mode > 0;
  }

  /** Renders a frame and returns it as an image (read before the browser clears the canvas). */
  capture(): HTMLCanvasElement {
    this.composer.render(0);
    const src = this.renderer.domElement;
    const out = document.createElement('canvas');
    out.width = src.width;
    out.height = src.height;
    out.getContext('2d')!.drawImage(src, 0, 0);
    return out;
  }

  // ---------- targets ----------

  setTargets(
    list: Array<{
      id: string;
      lat: number;
      lon: number;
      radiusM: number;
      kind: string;
    }>,
  ): void {
    this.clearTargets();
    if (!this.frame) return;
    for (const t of list) {
      const [x, n] = this.frame.toLocal(t.lat, t.lon);
      const colour = new Color(...(TARGET_COLOURS[t.kind] ?? TARGET_COLOURS.sample!));
      const m = new TargetMarker(x, -n, this.groundY, t.radiusM, colour);
      this.scene.add(m.beam, m.ring);
      this.markers.set(t.id, m);
    }
  }

  markDone(id: string): void {
    this.markers.get(id)?.markDone(new Color(0.35, 0.95, 0.55));
  }

  clearTargets(): void {
    for (const m of this.markers.values()) {
      this.scene.remove(m.beam, m.ring);
      m.dispose();
    }
    this.markers.clear();
  }

  private readonly projV = new Vector3();
  /** Normalised device coordinates of a world point (z > 1: behind the camera). */
  project(x: number, y: number, z: number): Vector3 {
    return this.projV.set(x, y, z).project(this.camera);
  }

  setCameraMode(mode: CameraMode): void {
    this.rig.mode = mode;
  }

  // ---------- frame ----------

  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private readonly tmp3 = new Vector3();
  private readonly across = new Vector3();
  private readonly drill = new Vector3();
  private lastPose: ScenePose | null = null;
  private markPlaced = false;
  /** Mast head: current angles and the idle panorama's state. */
  private readonly head = { pan: 0, tilt: 0.12, idleS: 0, shotS: 0, aim: 0, dir: 1 };

  /** The ground as the tracks see it. */
  private readonly trackGround: TrackGround = {
    height: (x, z) => this.groundY(x, z),
    normal: (x, z, target) => {
      const n = this.terrain ? this.terrain.normalAt(x, -z, 0.5) : [0, 1, 0];
      return target.set(n[0]!, n[1]!, n[2]!);
    },
    softness: (x, z) => {
      if ((this.rocks?.rockLift(x, -z) ?? 0) > 0.02) return 0;
      // Bright ground is mostly bedrock, where wheels barely print.
      const b = this.brightness(x, -z);
      return 1 - 0.55 * Math.min(1, Math.max(0, (b - 0.52) / 0.2));
    },
  };

  /**
   * Advances effects and renders. `pose`: rover origin (world) and attitude; `coring`: progress of
   * the arm sequence (0–1) or null; `panorama`: progress of a 360° panorama (0–1) or null.
   */
  frameUpdate(
    dt: number,
    pose: ScenePose,
    motion: { speed: number; yawRate: number; distanceM: number; slip?: number; sinkage?: number },
    coring: number | null,
    panorama: number | null = null,
  ): void {
    this.time += dt;
    // Sinking into soft sand: the body sits lower, the wheels spin faster than they move.
    pose = { ...pose, y: pose.y - (motion.sinkage ?? 0) * 0.12 };
    const slip = motion.slip ?? 0;
    const spinM = motion.distanceM / Math.max(0.15, 1 - slip);
    const rover = this.rover;
    const terrain = this.terrain;
    if (rover && terrain) {
      rover.setPose(pose.x, pose.y, pose.z, pose.headingRad, pose.pitchRad, pose.rollRad);
      rover.root.updateMatrixWorld(true);
      // Suspension: each wheel follows the ground under it relative to the body plane.
      const lift = rover.wheels.map((_, i) => {
        rover.wheelWorld(i, this.tmp);
        return this.surfaceAt(this.tmp.x, -this.tmp.z) - this.tmp.y;
      });
      rover.animateWheels(spinM, motion.yawRate, motion.speed, dt, lift);
      this.updateArm(rover, coring, dt);
      this.updateHead(rover, dt, motion, coring, panorama);
      // Wheel dust (mostly the rear wheels) and tracks.
      const sp = Math.abs(motion.speed);
      this.across.set(Math.cos(pose.headingRad), 0, Math.sin(pose.headingRad)).multiplyScalar(-1);
      for (const [i, w] of rover.wheels.entries()) {
        rover.wheelWorld(i, this.tmp);
        this.tmp.y = this.groundY(this.tmp.x, this.tmp.z);
        if (sp > 0.3 && Math.random() < dt * sp * (w.row === 2 ? 5 : 1.5) * (1 + 3 * slip)) {
          this.tmp2.set(
            -Math.sin(pose.headingRad) * sp * 0.25 + (Math.random() - 0.5) * 0.6,
            0.3 + Math.random() * 0.5 * Math.min(1, sp / 6),
            Math.cos(pose.headingRad) * sp * 0.25 + (Math.random() - 0.5) * 0.6,
          );
          this.dust.emit(
            this.tmp,
            this.tmp2,
            0.07 + Math.random() * 0.1,
            1.4 + Math.random() * 1.4,
          );
        }
        this.tracks.add(i, this.tmp, this.across, this.trackGround);
      }
    }
    this.lastPose = pose;
    // Dust devils: keep a few crossing the plain at a distance.
    for (const d of this.devils) {
      if (!d.alive && this.storm < 0.3 && Math.random() < dt * 0.05) {
        const a = Math.random() * Math.PI * 2;
        const r = 250 + Math.random() * 700;
        this.tmp.set(pose.x + Math.cos(a) * r, 0, pose.z + Math.sin(a) * r);
        this.tmp.y = this.groundY(this.tmp.x, this.tmp.z);
        d.spawn(this.tmp, this.wind, 60 + Math.random() * 80);
      }
      d.update(dt, this.groundY);
    }
    // Storm: dust streaming past the camera.
    if (this.storm > 0.05) {
      const c = this.camera.position;
      // Fine grains streaming past, near the camera.
      const n = Math.floor(dt * 260 * this.storm + Math.random());
      for (let i = 0; i < n; i++) {
        this.tmp.set(c.x + (Math.random() - 0.5) * 24, 0, c.z + (Math.random() - 0.5) * 24);
        this.tmp.y = this.groundY(this.tmp.x, this.tmp.z) + Math.random() * 5;
        this.tmp2.copy(this.wind).multiplyScalar(5 + 5 * this.storm);
        this.dust.emit(this.tmp, this.tmp2, 0.05 + Math.random() * 0.12, 1 + Math.random() * 1.5);
      }
    }
    // Fine dust always hanging in the air.
    {
      const c = this.camera.position;
      const n = Math.floor(dt * 22 + Math.random());
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 2 + Math.random() * 14;
        this.tmp.set(c.x + Math.cos(a) * r, 0, c.z + Math.sin(a) * r);
        this.tmp.y = Math.max(
          this.groundY(this.tmp.x, this.tmp.z) + 0.2,
          c.y - 3 + Math.random() * 6,
        );
        this.tmp2.copy(this.wind).multiplyScalar(0.4 + Math.random() * 0.4);
        this.dust.emit(this.tmp, this.tmp2, 0.012 + Math.random() * 0.025, 3 + Math.random() * 4);
      }
    }
    this.updateLaser();
    this.updateIngenuity(dt);
    this.route.update(this.time, pose.x, -pose.z);
    this.dust.update(
      dt,
      this.storm > 0.05 ? this.tmp2.copy(this.wind).multiplyScalar(1 + 5 * this.storm) : this.wind,
    );
    for (const m of this.markers.values()) m.update(this.time);
  }

  /** Ingenuity's flight, and the dust its rotors raise near the ground. */
  private updateIngenuity(dt: number): void {
    const s = this.ingenuity.update(dt, this.groundY);
    this.ingenuityLanded ||= s.landed;
    if (s.rotor < 0.5 || s.altitudeM > 4 || !this.ingenuity.root.visible) return;
    const p = this.ingenuity.position;
    const n = Math.floor(dt * 70 * s.rotor * (1 - s.altitudeM / 4) + Math.random());
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.3 + Math.random() * 0.8;
      this.tmp.set(p.x + Math.cos(a) * r, 0, p.z + Math.sin(a) * r);
      this.tmp.y = this.groundY(this.tmp.x, this.tmp.z) + 0.05;
      const v = 1.2 + Math.random() * 1.5;
      this.tmp2.set(Math.cos(a) * v, 0.15 + Math.random() * 0.3, Math.sin(a) * v);
      this.dust.emit(this.tmp, this.tmp2, 0.05 + Math.random() * 0.08, 1 + Math.random());
    }
  }
  /** Set when a flight ends (read and cleared by the session). */
  ingenuityLanded = false;

  /** Ingenuity parked at a local point (x, north), or hidden. */
  placeIngenuity(at: [number, number] | null, headingRad?: number): void {
    if (!at) {
      this.ingenuity.place(null);
      return;
    }
    this.tmp.set(at[0], this.groundY(at[0], -at[1]), -at[1]);
    this.ingenuity.place(this.tmp, headingRad);
  }

  flyIngenuity(to: [number, number]): void {
    this.tmp.set(to[0], this.groundY(to[0], -to[1]), -to[1]);
    this.ingenuityLanded = false;
    this.ingenuity.fly(this.tmp);
  }

  /** AutoNav's path on the ground (local points), or none. */
  setRoute(points: Array<[number, number]> | null): void {
    this.route.set(points, this.groundY);
  }

  /** Tubes left at the depot, in a line behind a rover at (x, north) facing `headingRad`. */
  layTubesAt(x: number, north: number, headingRad: number, count: number): void {
    // Behind the rover (heading: compass from north; world z points south).
    this.tmp2.set(-Math.sin(headingRad), 0, Math.cos(headingRad));
    this.tmp.set(x, 0, -north).addScaledVector(this.tmp2, 1.5);
    this.depotTubes.lay(count, this.tmp, this.tmp2, 2.2, this.groundY);
  }

  /** Beam from the mast head to the rock, pulsing; a spark and a puff on each pulse. */
  private updateLaser(): void {
    const l = this.laser;
    const rover = this.rover;
    const on = !!l && !!rover && l.progress > 0.25 && l.progress < 0.92;
    this.laserBeam.visible = on;
    this.laserFlash.visible = on;
    if (!on || !l || !rover) {
      this.laserLight.intensity = 0;
      return;
    }
    // About 10 pulses a second in the game (SuperCam fires up to 10 Hz).
    const pulse = Math.max(0, Math.sin(this.time * 2 * Math.PI * 10));
    rover.headLensWorld(this.tmp);
    this.laserBeam.position.copy(this.tmp);
    this.laserBeam.lookAt(l.at);
    this.laserBeam.scale.set(1, 1, this.tmp.distanceTo(l.at));
    (this.laserBeam.material as MeshBasicMaterial).opacity = 0.25 + 0.5 * pulse;
    this.laserFlash.position.copy(l.at);
    this.laserFlash.scale.setScalar(0.6 + 1.6 * pulse);
    this.laserLight.position.copy(l.at).y += 0.05;
    this.laserLight.intensity = 2.5 * pulse;
    if (pulse > 0.95 && Math.random() < 0.5) {
      this.tmp2.set(
        (Math.random() - 0.5) * 0.3,
        0.2 + Math.random() * 0.3,
        (Math.random() - 0.5) * 0.3,
      );
      this.dust.emit(l.at, this.tmp2, 0.03 + Math.random() * 0.04, 0.8 + Math.random() * 0.6);
    }
  }

  /** Arm, drill dust, the turret's lights and the mark left on the ground. */
  private updateArm(rover: Rover3D, coring: number | null, dt: number): void {
    const c = coring ?? 0;
    const pose = coring === null ? armPoseAt(0, rover.coreElbow) : armPoseAt(c, rover.coreElbow);
    rover.setArm(pose, this.time);
    rover.root.updateMatrixWorld(true);
    rover.drillTipWorld(this.drill);
    const ground = this.groundY(this.drill.x, this.drill.z);
    this.drill.y = Math.max(this.drill.y, ground + 0.03);
    rover.led.visible = coring !== null && c > 0.28 && c < 0.88;
    if (pose.drill > 0) {
      // Cuttings thrown out by the percussive drill, more as it bites deeper.
      const n = Math.random() < dt * 50 ? 1 + Math.floor(Math.random() * 2) : 0;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = 0.3 + Math.random() * 0.5;
        this.tmp2.set(Math.cos(a) * v, 0.15 + Math.random() * 0.35, Math.sin(a) * v);
        this.tmp.set(this.drill.x, ground + 0.03, this.drill.z);
        this.dust.emit(this.tmp, this.tmp2, 0.05 + Math.random() * 0.1, 1.2 + Math.random());
      }
    }
    if (coring !== null && c > 0.6 && !this.markPlaced && this.terrain) {
      this.markPlaced = true;
      const n = this.terrain.normalAt(this.drill.x, -this.drill.z, 0.3);
      this.tmp.set(this.drill.x, ground, this.drill.z);
      this.coreMarks.add(this.tmp, this.tmp2.set(n[0], n[1], n[2]));
    }
    if (coring === null) this.markPlaced = false;
  }

  /**
   * Mast head (Mastcam-Z): looks at the drill while coring, into turns while driving, and when
   * parked takes a panorama, stepping across the view and pausing for each frame.
   */
  private updateHead(
    rover: Rover3D,
    dt: number,
    motion: { speed: number; yawRate: number },
    coring: number | null,
    panorama: number | null,
  ): void {
    const h = this.head;
    let pan: number;
    let tilt: number;
    const moving = Math.abs(motion.speed) > 0.1 || Math.abs(motion.yawRate) > 0.05;
    if (panorama !== null) {
      // A full turn of the mast, frame by frame (stepping, as the real mosaics are shot).
      const k = Math.min(1, Math.max(0, (panorama - 0.08) / 0.84));
      const frames = 16;
      const f = k * frames;
      const step = Math.floor(f) + Math.min(1, (f % 1) * 3);
      h.pan = (Math.min(frames, step) / frames) * Math.PI * 2;
      h.tilt = 0.04 + 0.05 * Math.sin(panorama * Math.PI);
      h.idleS = 0;
      h.aim = 0;
      rover.setHead(h.pan, h.tilt);
      return;
    }
    // After a panorama the mast is a full turn round: the same direction.
    if (h.pan > Math.PI) h.pan -= Math.PI * 2;
    if (this.laser) {
      rover.toLocal(this.laser.at, this.tmp).sub(rover.headPivot);
      pan = Math.atan2(this.tmp.x, this.tmp.z);
      tilt = Math.atan2(-(this.tmp.y - 0.11), Math.hypot(this.tmp.x, this.tmp.z));
      h.idleS = 0;
    } else if (coring !== null) {
      rover.toLocal(this.drill, this.tmp).sub(rover.headPivot);
      pan = Math.atan2(this.tmp.x, this.tmp.z);
      tilt = Math.atan2(-(this.tmp.y - 0.11), Math.hypot(this.tmp.x, this.tmp.z));
      h.idleS = 0;
    } else if (moving) {
      // Clockwise yaw is a right turn: look right (negative pan).
      pan = Math.max(-0.6, Math.min(0.6, -motion.yawRate * 0.7));
      tilt = 0.14;
      h.idleS = 0;
    } else {
      h.idleS += dt;
      if (h.idleS < 1.5) {
        pan = h.pan;
        tilt = h.tilt;
      } else {
        h.shotS -= dt;
        if (h.shotS <= 0) {
          // Next frame of the panorama: one step along, turning back at the ends.
          h.aim += h.dir * 0.42;
          if (Math.abs(h.aim) > 1.45) {
            h.dir = -h.dir;
            h.aim += 2 * h.dir * 0.42;
          }
          h.shotS = 1.5;
        }
        pan = h.aim;
        tilt = 0.06 + 0.07 * Math.sin(h.aim * 2.1);
      }
    }
    if (!moving && coring === null && h.idleS < 1.5) h.aim = h.pan;
    // Servo speeds of the mast's actuators.
    const step = (cur: number, target: number, rate: number) =>
      cur + Math.max(-rate * dt, Math.min(rate * dt, target - cur));
    const fast = this.laser ? 2.2 : 1;
    h.pan = step(h.pan, pan, 1.1 * fast);
    h.tilt = step(h.tilt, tilt, 0.8 * fast);
    rover.setHead(h.pan, h.tilt);
  }

  /** Camera, level of detail, shadows, then the frame. */
  render(dt: number, rig: Omit<Parameters<CameraRig['update']>[0], 'ground' | 'drill'>): void {
    this.rig.update({ ...rig, ground: this.groundY, drill: this.drill }, dt);
    this.camera.updateMatrixWorld();
    this.terrainMesh?.update(this.camera);
    if (this.rocks) this.rocks.update(this.camera.position.x, -this.camera.position.z);
    this.sky?.mesh.position.copy(this.camera.position);
    // Shadows around the rover, the light snapped to shadow-map texels (no shimmering).
    const p = this.lastPose;
    if (p) {
      const texel = 76 / this.cfg.shadow;
      const cx = Math.round(p.x / texel) * texel;
      const cz = Math.round(p.z / texel) * texel;
      this.sun.target.position.set(cx, p.y, cz);
      this.sun.position.set(cx, p.y, cz).addScaledVector(this.sunDir, 300);
    }
    (this.grade.uniforms.uTime as { value: number }).value = this.time % 100;
    (this.photoPass.uniforms.uTime as { value: number }).value = this.time % 100;
    this.composer.render(dt);
  }

  dispose(): void {
    this.unloadArea();
    this.ingenuity.dispose();
    this.route.dispose();
    this.depotTubes.dispose();
    this.dust.dispose();
    this.tracks.dispose();
    this.coreMarks.dispose();
    for (const d of this.devils) d.dispose();
    this.sky?.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
