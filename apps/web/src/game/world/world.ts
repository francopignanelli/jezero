import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  FogExp2,
  HalfFloatType,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
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
import { CameraRig, type CameraMode } from './cameraRig';
import {
  CoreMarks,
  DustDevil,
  DustParticles,
  TargetMarker,
  Tracks,
  type TrackGround,
} from './effects';
import { CraterField, bakeCraters, generateCraters } from './features';
import { LocalFrame, Terrain, loadHeights, type AreaMeta, type WorldManifest } from './heights';
import { RockField } from './rocks';
import { CORE_SHOULDER, Rover3D, type ArmPose } from './rover3d';
import { HORIZON_LINEAR, SkyDome, sunDirection } from './sky';
import { TerrainMesh, type GroundTextures } from './terrain';
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

/** Sun per area: a mid-morning Sun (compass azimuth, elevation), for long but not hard shadows. */
const SUN: Record<string, [number, number]> = {
  floor: [104, 31],
  delta: [118, 36],
  margin: [96, 27],
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
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime;
    varying vec2 vUv;
    float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      float v = 1.0 - dot(d, d) * 0.55;
      c.rgb *= v;
      c.rgb += (h(vUv * 1000.0) - 0.5) * 0.012 * (c.r + c.g + c.b);
      gl_FragColor = c;
    }`,
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
  private readonly sun = new DirectionalLight(0xfff0e0, 3.1);
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
  private readonly devils: DustDevil[] = [];
  private markers = new Map<string, TargetMarker>();
  private albedoGrey: {
    grey: Uint8Array;
    width: number;
    height: number;
    cellM: number;
    widthM: number;
    heightM: number;
  } | null = null;
  readonly wind = new Vector3(1.6, 0, -0.6);
  private time = 0;
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
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.rig = new CameraRig(this.camera, this.renderer.domElement);

    this.scene.fog = new FogExp2(HORIZON_LINEAR.clone().multiplyScalar(1.12), 0.000045);
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
    this.scene.add(this.coreMarks.group);
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
    this.dust.setViewportHeight(h * this.renderer.getPixelRatio(), this.camera.fov);
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
    const [detail, mid, far, aDetail, aMid, aFar, ground] = await Promise.all([
      loadHeights(area.detail.heights, base),
      loadHeights(area.mid.heights, base),
      loadHeights(area.far.heights, base),
      loadGrey(area.detail.albedo),
      loadGrey(area.mid.albedo),
      loadGrey(area.far.albedo),
      this.ground ? Promise.resolve(this.ground) : loadGroundTextures(manifest.ground),
    ]);
    this.ground = ground;
    this.unloadArea();
    this.areaId = id;
    const frame = new LocalFrame(area.lat, area.lon);
    this.frame = frame;
    const greyCellM = area.detail.albedo.cellM ?? 0.5;
    const craters = generateCraters(
      id,
      detail.widthM,
      detail.heightM,
      keepClear.map((p) => frame.toLocal(p.lat, p.lon)),
    );
    bakeCraters(craters, detail, {
      data: aDetail.grey,
      width: aDetail.width,
      height: aDetail.height,
      cellM: greyCellM,
    });
    aDetail.texture.needsUpdate = true;
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
      { detail: aDetail.texture, mid: aMid.texture, far: aFar.texture },
      this.quality !== 'low',
    );
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
    this.sky = new SkyDome(dir);
    this.scene.add(this.sky.mesh);
    this.scene.background = null;
    this.scene.environment?.dispose();
    this.scene.environment = this.sky.environment(this.renderer);
    this.scene.environmentIntensity = 0.75;
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

  /** Orbital brightness 0–1 at a local point (the HiRISE image), 0.5 outside it. */
  brightness(x: number, north: number): number {
    const a = this.albedoGrey;
    if (!a) return 0.5;
    const c = Math.floor((x + a.widthM / 2) / a.cellM);
    const r = Math.floor((a.heightM / 2 - north) / a.cellM);
    if (c < 0 || r < 0 || c >= a.width || r >= a.height) return 0.5;
    return a.grey[r * a.width + c]! / 255;
  }

  /** Ground height (world y) including rocks: what the wheels touch. */
  surfaceAt(x: number, north: number): number {
    if (!this.terrain) return 0;
    return this.terrain.heightAt(x, north) + (this.rocks?.rockLift(x, north) ?? 0);
  }

  groundY = (x: number, z: number): number => (this.terrain ? this.terrain.heightAt(x, -z) : 0);

  // ---------- targets ----------

  setTargets(
    list: Array<{
      id: string;
      lat: number;
      lon: number;
      radiusM: number;
      kind: 'sample' | 'depot';
    }>,
  ): void {
    this.clearTargets();
    if (!this.frame) return;
    for (const t of list) {
      const [x, n] = this.frame.toLocal(t.lat, t.lon);
      const colour = t.kind === 'depot' ? new Color(0.35, 0.75, 1.0) : new Color(1.0, 0.62, 0.25);
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
   * the arm sequence (0–1) or null.
   */
  frameUpdate(
    dt: number,
    pose: ScenePose,
    motion: { speed: number; yawRate: number; distanceM: number },
    coring: number | null,
  ): void {
    this.time += dt;
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
      rover.animateWheels(motion.distanceM, motion.yawRate, motion.speed, dt, lift);
      this.updateArm(rover, coring, dt);
      this.updateHead(rover, dt, motion, coring);
      // Wheel dust (mostly the rear wheels) and tracks.
      const sp = Math.abs(motion.speed);
      this.across.set(Math.cos(pose.headingRad), 0, Math.sin(pose.headingRad)).multiplyScalar(-1);
      for (const [i, w] of rover.wheels.entries()) {
        rover.wheelWorld(i, this.tmp);
        this.tmp.y = this.groundY(this.tmp.x, this.tmp.z);
        if (sp > 0.3 && Math.random() < dt * sp * (w.row === 2 ? 5 : 1.5)) {
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
        if (w.row === 0)
          this.tracks.add(w.side > 0 ? 0 : 1, this.tmp, this.across, this.trackGround);
      }
    }
    this.lastPose = pose;
    // Dust devils: keep a few crossing the plain at a distance.
    for (const d of this.devils) {
      if (!d.alive && Math.random() < dt * 0.05) {
        const a = Math.random() * Math.PI * 2;
        const r = 250 + Math.random() * 700;
        this.tmp.set(pose.x + Math.cos(a) * r, 0, pose.z + Math.sin(a) * r);
        this.tmp.y = this.groundY(this.tmp.x, this.tmp.z);
        d.spawn(this.tmp, this.wind, 60 + Math.random() * 80);
      }
      d.update(dt, this.groundY);
    }
    this.dust.update(dt, this.wind);
    for (const m of this.markers.values()) m.update(this.time);
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
  ): void {
    const h = this.head;
    let pan: number;
    let tilt: number;
    const moving = Math.abs(motion.speed) > 0.1 || Math.abs(motion.yawRate) > 0.05;
    if (coring !== null) {
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
    h.pan = step(h.pan, pan, 1.1);
    h.tilt = step(h.tilt, tilt, 0.8);
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
    this.composer.render(dt);
  }

  dispose(): void {
    this.unloadArea();
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
