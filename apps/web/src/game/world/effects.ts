import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  LinearFilter,
  Mesh,
  MeshStandardMaterial,
  NoBlending,
  NormalBlending,
  OrthographicCamera,
  Points,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';

/** Dust colour (linear), lit by the warm sun. */
const DUST = new Color().setRGB(0.78, 0.55, 0.36, SRGBColorSpace);

/**
 * Dust: kicked up by the wheels (more at speed), a puff when the drill bites, and fine motes
 * drifting with the wind. Soft round sprites that grow, rise a little and fade; Mars's thin air
 * lets fine dust hang for seconds.
 */
export class DustParticles {
  readonly points: Points;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly age: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private next = 0;
  private readonly geometry: BufferGeometry;

  constructor(private readonly max = 1600) {
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.age = new Float32Array(max).fill(1e9);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage));
    g.setAttribute('aSize', new BufferAttribute(this.size, 1).setUsage(DynamicDrawUsage));
    g.setAttribute('aAlpha', new BufferAttribute(this.alpha, 1).setUsage(DynamicDrawUsage));
    this.geometry = g;
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      uniforms: { uColor: { value: DUST }, uScale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aAlpha;
        uniform float uScale;
        varying float vAlpha;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
          vAlpha = aAlpha;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = dot(d, d) * 4.0;
          if (r > 1.0) discard;
          float a = (1.0 - r) * (1.0 - r) * vAlpha;
          gl_FragColor = vec4(uColor, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.points = new Points(g, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  setViewportHeight(px: number, fovDeg: number): void {
    // Point size in pixels for a 1 m particle at 1 m: the projection's focal length.
    (this.points.material as ShaderMaterial).uniforms.uScale!.value =
      px / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  emit(at: Vector3, vel: Vector3, sizeM: number, lifeS: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos.set([at.x, at.y, at.z], i * 3);
    this.vel.set([vel.x, vel.y, vel.z], i * 3);
    this.life[i] = lifeS;
    this.age[i] = 0;
    this.size[i] = sizeM;
  }

  update(dt: number, wind: Vector3): void {
    for (let i = 0; i < this.max; i++) {
      const age = (this.age[i]! += dt);
      const life = this.life[i]!;
      if (age >= life) {
        this.alpha[i] = 0;
        continue;
      }
      const o = i * 3;
      // Drag towards the wind, a slow settle.
      const k = Math.min(1, dt * 1.4);
      this.vel[o]! += (wind.x - this.vel[o]!) * k;
      this.vel[o + 1]! += (-0.05 - this.vel[o + 1]!) * k * 0.5;
      this.vel[o + 2]! += (wind.z - this.vel[o + 2]!) * k;
      this.pos[o]! += this.vel[o]! * dt;
      this.pos[o + 1]! += this.vel[o + 1]! * dt;
      this.pos[o + 2]! += this.vel[o + 2]! * dt;
      const t = age / life;
      this.size[i]! *= 1 + dt * 0.9;
      this.alpha[i] = Math.min(1, t * 6) * (1 - t) ** 1.5 * 0.32;
    }
    for (const name of ['position', 'aSize', 'aAlpha'])
      (this.geometry.getAttribute(name) as BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    (this.points.material as ShaderMaterial).dispose();
  }
}

/**
 * A dust devil: a translucent swirling column (Perseverance has filmed many crossing Jezero), a
 * cylinder with an animated noise shader, drifting with the wind and fading in and out.
 */
export class DustDevil {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  private age = 0;
  private life = 0;
  private readonly drift = new Vector3();

  constructor(private readonly heightM: number) {
    const g = new CylinderGeometry(1, 0.35, 1, 40, 24, true);
    g.translate(0, 0.5, 0);
    this.material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: NormalBlending,
      uniforms: {
        uTime: { value: 0 },
        uFade: { value: 0 },
        uColor: { value: DUST.clone().multiplyScalar(1.15) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vN;
        varying vec3 vView;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix) * normal);
          vView = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uFade;
        uniform vec3 uColor;
        varying vec2 vUv;
        varying vec3 vN;
        varying vec3 vView;
        float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
        }
        void main() {
          float y = vUv.y;
          // Swirl: noise advected around the column, faster near the ground.
          vec2 q = vec2(vUv.x * 6.0 - uTime * (1.6 - y), y * 5.0 - uTime * 0.7);
          float s = n(q) * 0.6 + n(q * 2.3 + 4.0) * 0.4;
          // pow() of a negative (interpolation can overshoot 1) is NaN: clamp.
          float rim = pow(max(1.0 - abs(dot(vN, vView)), 0.0), 0.6);
          float a = s * (0.35 + 0.65 * rim) * pow(max(1.0 - y, 0.0), 0.8) * smoothstep(0.0, 0.08, y);
          gl_FragColor = vec4(uColor * (0.85 + 0.3 * s), a * 0.38 * uFade);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new Mesh(g, this.material);
    this.mesh.renderOrder = 1;
    this.mesh.visible = false;
  }

  /** Starts it at a point (x, ground height, z) for `lifeS` seconds. */
  spawn(at: Vector3, wind: Vector3, lifeS: number): void {
    this.mesh.position.copy(at);
    const r = 4 + Math.random() * 6;
    this.mesh.scale.set(r, this.heightM * (0.6 + Math.random() * 0.8), r);
    this.drift.copy(wind).multiplyScalar(1.5 + Math.random());
    this.age = 0;
    this.life = lifeS;
    this.mesh.visible = true;
  }

  get alive(): boolean {
    return this.mesh.visible;
  }

  update(dt: number, groundAt: (x: number, z: number) => number): void {
    if (!this.mesh.visible) return;
    this.age += dt;
    this.mesh.position.addScaledVector(this.drift, dt);
    this.mesh.position.y = groundAt(this.mesh.position.x, this.mesh.position.z);
    this.mesh.rotation.y += dt * 0.8;
    this.material.uniforms.uTime!.value = this.age;
    const t = this.age / this.life;
    this.material.uniforms.uFade!.value = Math.min(1, t * 5, (1 - t) * 5);
    if (this.age >= this.life) this.mesh.visible = false;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/** Points over which the oldest end of a long track fades out. */
const FADE_POINTS = 120;

/** What the tracks need to know about the ground. */
export interface TrackGround {
  /** How clearly a wheel prints here: 1 in soft soil and sand, low on bedrock and rocks. */
  softness(x: number, z: number): number;
}

/** Size of the track map: texels per side and metres covered, and where tracks fade out (m). */
export interface TrackMapConfig {
  res: number;
  sizeM: number;
  fade: [number, number];
}

interface Ribbon {
  pos: Float32Array;
  uv: Float32Array;
  strength: Float32Array;
  geometry: BufferGeometry;
  count: number;
  dist: number;
  last: Vector3 | null;
  /** Unit horizontal vector across the ribbon at its last point. */
  across: Vector3;
}

/**
 * Wheel tracks, printed into the ground itself. Each wheel lays a ribbon across its own direction
 * of travel (straight, the middle and rear wheels run in the front wheels' ruts; turning in place,
 * each wheel scuffs its own arc). The ribbons are not drawn in the scene: they are rendered from
 * above into a track map around the rover, and the terrain shader (terrain.ts) reads that map to
 * sink the groove, raise the berms, print the grousers and darken the compacted soil.
 *
 * Before, the ribbons were geometry draped 1 cm over the ground at the heights the physics use.
 * Those include the full micro-relief, which the terrain mesh fades out a dozen metres from the
 * camera: behind the rover the ground dropped away under the ribbons, which floated as dark bands
 * (or sank into it). A map read by the ground's own shader can neither float nor z-fight.
 *
 * Map texels: R = position across the rut (0–1, linear, so it interpolates exactly), G = strength
 * (the soil's softness; faded at the ribbon's edges), BA = direction of travel.
 */
export class Tracks {
  /** The track map (read by the terrain). */
  readonly target: WebGLRenderTarget;
  /** Map centre (local x, north), size (m), on. */
  readonly info = new Vector4(0, 0, 1, 0);
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera();
  private readonly material: ShaderMaterial;
  private readonly ribbons: Ribbon[] = [];
  private dirty = true;
  private readonly clear0 = new Color();

  constructor(
    readonly config: TrackMapConfig,
    ribbons = 6,
    private readonly maxPoints = 5000,
    private readonly widthM = 0.46,
  ) {
    this.target = new WebGLRenderTarget(config.res, config.res, {
      type: UnsignedByteType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      generateMipmaps: false,
      depthBuffer: false,
    });
    this.material = new ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
      // Reversing lays the strip with the opposite winding.
      side: DoubleSide,
      uniforms: { uCenter: { value: new Vector2() }, uHalf: { value: config.sizeM / 2 } },
      vertexShader: /* glsl */ `
        uniform vec2 uCenter;
        uniform float uHalf;
        attribute float aStrength;
        varying vec2 vUv;
        varying float vStrength;
        void main() {
          vUv = uv;
          vStrength = aStrength;
          // Straight down onto the map: x east, y north (three's z is south).
          gl_Position = vec4((position.x - uCenter.x) / uHalf, (-position.z - uCenter.y) / uHalf, 0.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying float vStrength;
        void main() {
          // Jump links (a restart) carry no strength: they must not erase the ruts they cross.
          if (vStrength < 0.01) discard;
          float u = vUv.x;
          float edge = smoothstep(0.0, 0.1, u) * smoothstep(1.0, 0.9, u);
          // Direction of travel: the gradient of the distance along the ribbon, in map (world) axes.
          vec2 g = vec2(dFdx(vUv.y), dFdy(vUv.y));
          vec2 dir = g / max(length(g), 1e-6);
          gl_FragColor = vec4(u, vStrength * edge, dir * 0.5 + 0.5);
        }`,
    });
    for (let s = 0; s < ribbons; s++) {
      const verts = maxPoints * 2;
      const pos = new Float32Array(verts * 3);
      const uv = new Float32Array(verts * 2);
      const strength = new Float32Array(verts);
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(pos, 3).setUsage(DynamicDrawUsage));
      geometry.setAttribute('uv', new BufferAttribute(uv, 2).setUsage(DynamicDrawUsage));
      geometry.setAttribute(
        'aStrength',
        new BufferAttribute(strength, 1).setUsage(DynamicDrawUsage),
      );
      const index: number[] = [];
      for (let i = 0; i < maxPoints - 1; i++) {
        const a = i * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      geometry.setIndex(index);
      geometry.setDrawRange(0, 0);
      const mesh = new Mesh(geometry, this.material);
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.ribbons.push({
        pos,
        uv,
        strength,
        geometry,
        count: 0,
        dist: 0,
        last: null,
        across: new Vector3(1, 0, 0),
      });
    }
  }

  /**
   * Adds a track point for a wheel: `at` is its contact point (world), `hint` the rover's left
   * direction (unit, horizontal), used to start a ribbon.
   */
  add(wheel: number, at: Vector3, hint: Vector3, ground: TrackGround): void {
    const s = this.ribbons[wheel];
    if (!s) return;
    const step = s.last ? s.last.distanceTo(at) : Infinity;
    if (s.last && step < 0.15) return;
    // A jump (a restart, a teleport): an invisible link to the new start.
    const jump = step > 3;
    // Across the direction the wheel actually moved, on the same side as before.
    if (s.last && !jump) {
      const dx = at.x - s.last.x;
      const dz = at.z - s.last.z;
      const len = Math.hypot(dx, dz);
      if (len > 1e-4) {
        const px = s.across.x;
        const pz = s.across.z;
        s.across.set(dz / len, 0, -dx / len);
        // Continuous with the previous point (reversing flips the direction of travel).
        if (s.across.x * px + s.across.z * pz < 0) s.across.negate();
      }
    } else s.across.copy(hint);
    const across = s.across;
    if (s.last && !jump) s.dist += step;
    s.last = (s.last ?? new Vector3()).copy(at);
    let full = false;
    if (s.count === this.maxPoints) {
      // Drop the oldest tenth at once (one full upload, then appends only).
      const drop = Math.floor(this.maxPoints / 10);
      s.pos.copyWithin(0, drop * 6);
      s.uv.copyWithin(0, drop * 4);
      s.strength.copyWithin(0, drop * 2);
      s.count -= drop;
      full = true;
      for (let p = 0; p < FADE_POINTS; p++) {
        s.strength[p * 2]! *= p / FADE_POINTS;
        s.strength[p * 2 + 1]! *= p / FADE_POINTS;
      }
    }
    const i = s.count;
    if (jump && i > 0) s.strength[(i - 1) * 2] = s.strength[(i - 1) * 2 + 1] = 0;
    const h = this.widthM / 2;
    const soft = jump || i === 0 ? 0 : ground.softness(at.x, at.z);
    for (let k = 0; k < 2; k++) {
      const sign = k === 0 ? 1 : -1;
      const v = i * 2 + k;
      s.pos.set([at.x + across.x * h * sign, 0, at.z + across.z * h * sign], v * 3);
      // Along: metres, so the terrain can tell the direction of travel from it.
      s.uv.set([k, s.dist], v * 2);
      s.strength[v] = soft;
    }
    s.count++;
    for (const [name, size] of [
      ['position', 3],
      ['uv', 2],
      ['aStrength', 1],
    ] as const) {
      const attr = s.geometry.getAttribute(name) as BufferAttribute;
      attr.clearUpdateRanges();
      // Appends upload the last two points only (the previous one may have been edited).
      if (!full) attr.addUpdateRange(Math.max(0, i - 1) * 2 * size, 4 * size);
      attr.needsUpdate = true;
    }
    s.geometry.setDrawRange(0, Math.max(0, (s.count - 1) * 6));
    this.dirty = true;
  }

  /**
   * Redraws the map around the rover (local x, north) when the tracks or the rover have moved.
   * The centre snaps to whole texels, so the ruts do not shimmer as the map follows.
   */
  render(renderer: WebGLRenderer, x: number, north: number): void {
    const texel = this.config.sizeM / this.config.res;
    const cx = Math.round(x / texel) * texel;
    const cn = Math.round(north / texel) * texel;
    if (!this.dirty && cx === this.info.x && cn === this.info.y) return;
    this.dirty = false;
    this.info.set(cx, cn, this.config.sizeM, 1);
    (this.material.uniforms.uCenter!.value as Vector2).set(cx, cn);
    const prevTarget = renderer.getRenderTarget();
    const prevAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clear0);
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(this.clear0, prevAlpha);
  }

  /** Breaks the ribbons (after a jump, e.g. a mission restart). */
  clear(): void {
    for (const s of this.ribbons) {
      s.count = 0;
      s.last = null;
      s.geometry.setDrawRange(0, 0);
    }
    this.dirty = true;
  }

  dispose(): void {
    for (const s of this.ribbons) s.geometry.dispose();
    this.material.dispose();
    this.target.dispose();
  }
}


/** The ground mark a core leaves: a grey abraded patch, the borehole, a ring of cuttings. */
function coreMarkTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(25,22,22,1)');
  g.addColorStop(0.16, 'rgba(30,26,25,1)');
  g.addColorStop(0.2, 'rgba(150,140,134,1)');
  g.addColorStop(0.5, 'rgba(135,124,116,0.95)');
  g.addColorStop(0.62, 'rgba(120,96,80,0.75)');
  g.addColorStop(0.8, 'rgba(150,108,80,0.45)');
  g.addColorStop(1, 'rgba(150,108,80,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Marks left where the rover cored (cleared with the area). */
export class CoreMarks {
  readonly group = new Group();
  private readonly geometry = new CircleGeometry(0.16, 32);
  private readonly material = new MeshStandardMaterial({
    map: coreMarkTexture(),
    transparent: true,
    depthWrite: false,
    roughness: 0.9,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });

  add(at: Vector3, normal: Vector3): void {
    const m = new Mesh(this.geometry, this.material);
    m.position.copy(at).addScaledVector(normal, 0.01);
    m.lookAt(at.clone().add(normal));
    m.rotateZ(Math.random() * Math.PI * 2);
    m.receiveShadow = true;
    m.renderOrder = 1;
    this.group.add(m);
  }

  clear(): void {
    this.group.clear();
  }

  dispose(): void {
    this.clear();
    this.geometry.dispose();
    this.material.map?.dispose();
    this.material.dispose();
  }
}
