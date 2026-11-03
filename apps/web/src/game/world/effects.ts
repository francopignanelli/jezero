import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  ClampToEdgeWrapping,
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  Mesh,
  MeshStandardMaterial,
  NormalBlending,
  Points,
  RepeatWrapping,
  ShaderMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
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

/** Length of ground covered by one repeat of the tread maps (m): 8 grouser imprints. */
const TREAD_TILE_M = 0.5;
/** Points over which the oldest end of a long track fades out. */
const FADE_POINTS = 120;

/**
 * Tread maps of a wheel rut, as Perseverance's wheels print them in soft ground. Across the rut:
 * a berm of soil pushed aside on each side, and the compacted groove between them, crossed by the
 * imprints of the curved grousers. Returns a normal map (from the relief) and a tone map (RGB:
 * brightness multiplier, A: opacity).
 */
function treadMaps(): { normal: CanvasTexture; tone: CanvasTexture } {
  const W = 64;
  const H = 256;
  const height = new Float32Array(W * H);
  const tone = new Uint8ClampedArray(new ArrayBuffer(W * H * 4));
  const GROOVE = [0.14, 0.86];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W;
      const v = (y + 0.5) / H;
      let h: number;
      let t: number;
      let a: number;
      if (u < GROOVE[0]! || u > GROOVE[1]!) {
        // Berm: a rounded ridge, fading into the surroundings at the outer edge.
        const b = u < GROOVE[0]! ? u / GROOVE[0]! : (1 - u) / (1 - GROOVE[1]!);
        h = 0.55 * Math.sin(b * Math.PI) ** 0.8;
        t = 1.1 + 0.06 * Math.sin(b * Math.PI);
        a = 0.6 * Math.min(1, b * 2.2);
      } else {
        // Groove: compacted floor with the grouser imprints (curved, 8 per tile).
        const across = (u - 0.5) / (GROOVE[1]! - 0.5);
        const k = v * 8 + 0.35 * across * across;
        const d = Math.abs(k - Math.round(k)); // 0 on an imprint line
        const imprint = Math.max(0, 1 - d / 0.16);
        const edge = Math.min(1, (GROOVE[1]! - 0.5 - Math.abs(u - 0.5)) / 0.08);
        h = -0.45 * edge - 0.35 * imprint * imprint * edge;
        t = 0.74 - 0.12 * imprint;
        a = 0.88;
      }
      height[y * W + x] = h;
      const o = (y * W + x) * 4;
      tone[o] = tone[o + 1] = tone[o + 2] = Math.round(Math.min(1, t / 1.2) * 255);
      tone[o + 3] = Math.round(a * 255);
    }
  const normal = new Uint8ClampedArray(new ArrayBuffer(W * H * 4));
  const at = (x: number, y: number) => height[((y + H) % H) * W + Math.max(0, Math.min(W - 1, x))]!;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      // Height units: 1 ≈ 4 cm over a texel of ~8 mm (across) and ~2 mm (along).
      const dx = (at(x + 1, y) - at(x - 1, y)) * 2.4;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 2.4;
      const len = Math.hypot(dx, dy, 1);
      const o = (y * W + x) * 4;
      normal[o] = Math.round((-dx / len) * 127.5 + 127.5);
      normal[o + 1] = Math.round((dy / len) * 127.5 + 127.5);
      normal[o + 2] = Math.round((1 / len) * 127.5 + 127.5);
      normal[o + 3] = 255;
    }
  const tex = (px: Uint8ClampedArray<ArrayBuffer>) => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    c.getContext('2d')!.putImageData(new ImageData(px, W, H), 0, 0);
    const t = new CanvasTexture(c);
    t.wrapS = ClampToEdgeWrapping;
    t.wrapT = RepeatWrapping;
    t.anisotropy = 8;
    return t;
  };
  return { normal: tex(normal), tone: tex(tone) };
}

/** What the tracks need to know about the ground. */
export interface TrackGround {
  height(x: number, z: number): number;
  /** Unit normal (world). */
  normal(x: number, z: number, target: Vector3): Vector3;
  /** How clearly a wheel prints here: 1 in soft soil and sand, low on bedrock and rocks. */
  softness(x: number, z: number): number;
}

interface Ribbon {
  pos: Float32Array;
  nrm: Float32Array;
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
 * Wheel tracks: one ribbon per wheel, laid across each wheel's own direction of travel.
 * - Driving straight, the middle and rear wheels run in the front wheels' ruts.
 * - Turning in place, each wheel scuffs its own arc.
 * The ribbons are draped on the ground and normal-mapped with the rut's relief. They are lit with
 * the ground's own normals, so the berms and grouser imprints catch the low sunlight. Ruts are
 * deeper in sand, faint on bedrock and absent on rocks, and the oldest end fades out.
 */
export class Tracks {
  readonly meshes: Mesh[] = [];
  private readonly material: MeshStandardMaterial;
  private readonly ribbons: Ribbon[] = [];
  private readonly n = new Vector3();

  constructor(
    ribbons = 6,
    private readonly maxPoints = 5000,
    private readonly widthM = 0.46,
  ) {
    const maps = treadMaps();
    this.material = new MeshStandardMaterial({
      color: new Color(0.42, 0.25, 0.16),
      roughness: 1,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      map: maps.tone,
      normalMap: maps.normal,
      normalScale: new Vector2(1.3, 1.3),
    });
    this.material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute float aStrength;\nvarying float vStrength;',
        )
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvStrength = aStrength;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vStrength;')
        .replace(
          '#include <map_fragment>',
          `vec4 tread = texture2D(map, vMapUv);
           diffuseColor.rgb *= mix(1.0, tread.r * 1.2, vStrength);
           diffuseColor.a *= tread.a * vStrength;`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `vec3 mapN = texture2D(normalMap, vNormalMapUv).xyz * 2.0 - 1.0;
           mapN.xy *= normalScale * vStrength;
           normal = normalize(tbn * mapN);`,
        );
    };
    for (let s = 0; s < ribbons; s++) {
      const verts = maxPoints * 2;
      const pos = new Float32Array(verts * 3);
      const nrm = new Float32Array(verts * 3);
      const uv = new Float32Array(verts * 2);
      const strength = new Float32Array(verts);
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(pos, 3).setUsage(DynamicDrawUsage));
      geometry.setAttribute('normal', new BufferAttribute(nrm, 3).setUsage(DynamicDrawUsage));
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
      mesh.receiveShadow = true;
      mesh.renderOrder = 0;
      this.meshes.push(mesh);
      this.ribbons.push({
        pos,
        nrm,
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

  /** Soil colour under the tracks (the ground's mean colour). */
  setColour(c: Color): void {
    this.material.color.copy(c).multiplyScalar(0.92);
  }

  /**
   * Adds a track point for a wheel: `at` is its contact point (world), `hint` the rover's left
   * direction (unit, horizontal), used to start a ribbon.
   */
  add(wheel: number, at: Vector3, hint: Vector3, ground: TrackGround): void {
    const s = this.ribbons[wheel];
    if (!s) return;
    const step = s.last ? s.last.distanceTo(at) : Infinity;
    if (s.last && step < 0.22) return;
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
      s.nrm.copyWithin(0, drop * 6);
      s.uv.copyWithin(0, drop * 4);
      s.strength.copyWithin(0, drop * 2);
      s.count -= drop;
      full = true;
      // The (new) oldest end fades in over FADE_POINTS.
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
      const x = at.x + across.x * h * sign;
      const z = at.z + across.z * h * sign;
      const v = i * 2 + k;
      s.pos.set([x, ground.height(x, z) + 0.012, z], v * 3);
      ground.normal(x, z, this.n);
      s.nrm.set([this.n.x, this.n.y, this.n.z], v * 3);
      s.uv.set([k, s.dist / TREAD_TILE_M], v * 2);
      s.strength[v] = soft;
    }
    s.count++;
    for (const [name, size] of [
      ['position', 3],
      ['normal', 3],
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
  }

  /** Breaks the ribbons (after a jump, e.g. a mission restart). */
  clear(): void {
    for (const s of this.ribbons) {
      s.count = 0;
      s.last = null;
      s.geometry.setDrawRange(0, 0);
    }
  }

  dispose(): void {
    for (const m of this.meshes) m.geometry.dispose();
    this.material.map?.dispose();
    this.material.normalMap?.dispose();
    this.material.dispose();
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

/**
 * Target markers: a soft column of light (readable from far away) and a ring on the ground, in
 * the game's colours; collected ones turn green and dim.
 */
export class TargetMarker {
  readonly beam: Mesh;
  readonly ring: Mesh;
  private readonly beamMat: ShaderMaterial;
  private readonly ringMat: ShaderMaterial;

  constructor(
    x: number,
    z: number,
    groundAt: (x: number, z: number) => number,
    radiusM: number,
    colour: Color,
  ) {
    const y = groundAt(x, z);
    this.beamMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      uniforms: { uColor: { value: colour.clone() }, uTime: { value: 0 }, uStrength: { value: 1 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorld;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uTime, uStrength;
        varying vec2 vUv;
        varying vec3 vWorld;
        void main() {
          // Seen from above or from close by, the column would read as a glowing disc or wall.
          vec3 toCam = cameraPosition - vWorld;
          float steep = abs(normalize(toCam).y);
          float fade = (1.0 - steep) * (1.0 - steep) * smoothstep(18.0, 60.0, length(toCam.xz));
          float edge = 1.0 - abs(vUv.x - 0.5) * 2.0;
          float pulse = 0.75 + 0.25 * sin(uTime * 2.0 - vUv.y * 12.0);
          float a = pow(max(edge, 0.0), 3.0) * pow(max(1.0 - vUv.y, 0.0), 1.6) * pulse * uStrength * fade;
          gl_FragColor = vec4(uColor * a * 0.8, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const beamGeo = new CylinderGeometry(1.4, 1.4, 70, 24, 1, true);
    beamGeo.translate(0, 35, 0);
    this.beam = new Mesh(beamGeo, this.beamMat);
    this.beam.position.set(x, y, z);
    this.beam.renderOrder = 3;
    // Ring: a thin band draped on the terrain (heights per vertex).
    const seg = 96;
    const pos = new Float32Array((seg + 1) * 2 * 3);
    const uv = new Float32Array((seg + 1) * 2 * 2);
    const index: number[] = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      for (let k = 0; k < 2; k++) {
        const r = radiusM + (k === 0 ? -0.25 : 0.25);
        const px = x + Math.cos(a) * r;
        const pz = z + Math.sin(a) * r;
        pos.set([px, groundAt(px, pz) + 0.06, pz], (i * 2 + k) * 3);
        uv.set([i / seg, k], (i * 2 + k) * 2);
      }
      if (i < seg) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const ringGeo = new BufferGeometry();
    ringGeo.setAttribute('position', new BufferAttribute(pos, 3));
    ringGeo.setAttribute('uv', new BufferAttribute(uv, 2));
    ringGeo.setIndex(index);
    this.ringMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uColor: { value: colour.clone() }, uTime: { value: 0 }, uStrength: { value: 1 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uTime, uStrength;
        varying vec2 vUv;
        void main() {
          float band = 1.0 - abs(vUv.y - 0.5) * 2.0;
          float dash = 0.6 + 0.4 * step(0.5, fract(vUv.x * 24.0 - uTime * 0.4));
          float a = band * dash * uStrength * 0.9;
          gl_FragColor = vec4(uColor * a, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.ring = new Mesh(ringGeo, this.ringMat);
    this.ring.renderOrder = 3;
    this.ring.frustumCulled = false;
  }

  update(timeS: number): void {
    this.beamMat.uniforms.uTime!.value = timeS;
    this.ringMat.uniforms.uTime!.value = timeS;
  }

  markDone(colour: Color): void {
    for (const m of [this.beamMat, this.ringMat]) {
      (m.uniforms.uColor!.value as Color).copy(colour);
      m.uniforms.uStrength!.value = 0.35;
    }
    this.beam.scale.y = 0.25;
  }

  dispose(): void {
    this.beam.geometry.dispose();
    this.ring.geometry.dispose();
    this.beamMat.dispose();
    this.ringMat.dispose();
  }
}
