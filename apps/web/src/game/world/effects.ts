import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Mesh,
  MeshStandardMaterial,
  NormalBlending,
  Points,
  RepeatWrapping,
  ShaderMaterial,
  SRGBColorSpace,
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
          float rim = pow(1.0 - abs(dot(vN, vView)), 0.6);
          float a = s * (0.35 + 0.65 * rim) * pow(1.0 - y, 0.8) * smoothstep(0.0, 0.08, y);
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

/** Grouser pattern of the wheel tracks (Perseverance's wheels have curved treads). */
function treadTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgb(128,128,128)';
  ctx.fillRect(0, 0, 64, 256);
  for (let y = 0; y < 256; y += 32) {
    ctx.strokeStyle = 'rgb(70,70,70)';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(0, y + 6);
    ctx.quadraticCurveTo(32, y - 8, 64, y + 6);
    ctx.stroke();
    ctx.strokeStyle = 'rgb(175,175,175)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, y + 12);
    ctx.quadraticCurveTo(32, y - 2, 64, y + 12);
    ctx.stroke();
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/**
 * Wheel tracks: two ribbons (the rear wheels run in the front wheels' ruts), draped just above
 * the ground, slightly darker compacted soil with the tread pattern, fading at the oldest end.
 */
export class Tracks {
  readonly meshes: Mesh[] = [];
  private readonly sides: Array<{
    pos: Float32Array;
    uv: Float32Array;
    alpha: Float32Array;
    geometry: BufferGeometry;
    count: number;
    head: number;
    dist: number;
    last: Vector3 | null;
  }> = [];

  constructor(
    private readonly maxPoints = 2400,
    private readonly widthM = 0.3,
  ) {
    const tread = treadTexture();
    const material = new MeshStandardMaterial({
      color: new Color(0.3, 0.2, 0.14),
      roughness: 1,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      alphaMap: tread,
      bumpMap: tread,
      bumpScale: 3,
    });
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute float aFade;\nvarying float vFade;',
        )
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = aFade;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vFade;')
        .replace(
          '#include <alphamap_fragment>',
          'diffuseColor.a *= (0.3 + 0.4 * (1.0 - texture2D(alphaMap, vAlphaMapUv).g)) * vFade;',
        );
    };
    for (let s = 0; s < 2; s++) {
      const pos = new Float32Array(maxPoints * 2 * 3);
      const uv = new Float32Array(maxPoints * 2 * 2);
      const alpha = new Float32Array(maxPoints * 2);
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(pos, 3).setUsage(DynamicDrawUsage));
      geometry.setAttribute('uv', new BufferAttribute(uv, 2).setUsage(DynamicDrawUsage));
      geometry.setAttribute('aFade', new BufferAttribute(alpha, 1).setUsage(DynamicDrawUsage));
      geometry.setAttribute(
        'normal',
        new BufferAttribute(
          new Float32Array(maxPoints * 2 * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)),
          3,
        ),
      );
      const index: number[] = [];
      for (let i = 0; i < maxPoints - 1; i++) {
        const a = i * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      geometry.setIndex(index);
      geometry.setDrawRange(0, 0);
      const mesh = new Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.renderOrder = 0;
      this.meshes.push(mesh);
      this.sides.push({ pos, uv, alpha, geometry, count: 0, head: 0, dist: 0, last: null });
    }
  }

  /**
   * Adds a track point for each side: `at` is the wheel contact (world), `across` the rover's
   * left direction (unit, horizontal), `ground` the terrain height function.
   */
  add(side: 0 | 1, at: Vector3, across: Vector3, ground: (x: number, z: number) => number): void {
    const s = this.sides[side]!;
    if (s.last && s.last.distanceToSquared(at) < 0.3 * 0.3) return;
    if (s.last) s.dist += s.last.distanceTo(at);
    s.last = (s.last ?? new Vector3()).copy(at);
    // Ring buffer of points: when full, drop the oldest by shifting (cheap enough at this rate).
    if (s.count === this.maxPoints) {
      s.pos.copyWithin(0, 6);
      s.uv.copyWithin(0, 4);
      s.count--;
    }
    const i = s.count;
    const h = this.widthM / 2;
    for (let k = 0; k < 2; k++) {
      const sign = k === 0 ? 1 : -1;
      const x = at.x + across.x * h * sign;
      const z = at.z + across.z * h * sign;
      s.pos.set([x, ground(x, z) + 0.02, z], (i * 2 + k) * 3);
      s.uv.set([k, s.dist / 0.32], (i * 2 + k) * 2);
    }
    s.count++;
    for (let p = 0; p < s.count; p++) {
      const f = Math.min(1, p / 120) * 0.85;
      s.alpha[p * 2] = s.alpha[p * 2 + 1] = f;
    }
    for (const n of ['position', 'uv', 'aFade'])
      (s.geometry.getAttribute(n) as BufferAttribute).needsUpdate = true;
    s.geometry.setDrawRange(0, Math.max(0, (s.count - 1) * 6));
  }

  /** Breaks the ribbons (after a jump, e.g. a mission restart). */
  clear(): void {
    for (const s of this.sides) {
      s.count = 0;
      s.last = null;
      s.geometry.setDrawRange(0, 0);
    }
  }

  dispose(): void {
    for (const m of this.meshes) m.geometry.dispose();
    (this.meshes[0]?.material as MeshStandardMaterial | undefined)?.dispose();
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
          float a = pow(edge, 3.0) * pow(1.0 - vUv.y, 1.6) * pulse * uStrength * fade;
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
