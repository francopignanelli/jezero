import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  Mesh,
  Points,
  ShaderMaterial,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Camera,
} from 'three';

/**
 * Markers of the places to go (sample sites, panorama spots, the depot, places to reach), made
 * to be found from anywhere on the map:
 * - a column of light, always at least a few pixels wide however far it is, with energy flowing
 *   up it and sparks rising at its foot;
 * - a floating badge with the kind's icon (a drill core, a camera, the depot, a flag), kept a
 *   readable size at any distance;
 * - on the ground, a ring like a landing pad: a bright rim, tick marks, waves running out from
 *   the centre and the icon painted in the middle, brighter and faster once the rover is in it.
 * The next objective is brighter and taller; optional discoveries are quieter.
 */

export type MarkerKind = 'sample' | 'depot' | 'panorama' | 'reach';

/** Marker colours per kind (linear, a little over 1 for the bloom). */
export const MARKER_COLOURS: Record<MarkerKind, [number, number, number]> = {
  sample: [1.0, 0.58, 0.22],
  depot: [0.3, 0.75, 1.0],
  panorama: [0.74, 0.5, 1.0],
  reach: [1.0, 0.86, 0.45],
};

const ICON_PX = 128;
const icons = new Map<string, CanvasTexture>();

/** The kind's icon on a round badge (cached; one texture per kind and look). */
function iconTexture(kind: MarkerKind, badge: boolean): CanvasTexture {
  const key = `${kind}:${badge}`;
  const cached = icons.get(key);
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = c.height = ICON_PX;
  const g = c.getContext('2d')!;
  const [r, gg, b] = MARKER_COLOURS[kind].map((v) => Math.round(Math.min(1, v) * 255));
  const col = `rgb(${r}, ${gg}, ${b})`;
  const mid = ICON_PX / 2;
  if (badge) {
    // Soft glow, a dark disc with a coloured rim.
    const glow = g.createRadialGradient(mid, mid, mid * 0.5, mid, mid, mid);
    glow.addColorStop(0, `rgba(${r}, ${gg}, ${b}, 0.55)`);
    glow.addColorStop(1, `rgba(${r}, ${gg}, ${b}, 0)`);
    g.fillStyle = glow;
    g.fillRect(0, 0, ICON_PX, ICON_PX);
    g.beginPath();
    g.arc(mid, mid, mid * 0.62, 0, Math.PI * 2);
    g.fillStyle = 'rgba(16, 12, 10, 0.88)';
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = col;
    g.stroke();
  }
  g.save();
  g.translate(mid, mid);
  const s = badge ? 0.42 : 0.8; // glyph scale
  g.scale((ICON_PX / 100) * s, (ICON_PX / 100) * s);
  g.strokeStyle = badge ? '#fff' : col;
  g.fillStyle = badge ? '#fff' : col;
  g.lineWidth = 7;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  if (kind === 'sample') {
    // A sample tube with its cap, and the core inside.
    g.strokeRect(-14, -30, 28, 56);
    g.fillRect(-19, -40, 38, 10);
    g.beginPath();
    g.moveTo(-6, -14);
    g.lineTo(-6, 18);
    g.moveTo(6, -6);
    g.lineTo(6, 18);
    g.stroke();
    g.beginPath();
    g.moveTo(-8, 26);
    g.lineTo(0, 40);
    g.lineTo(8, 26);
    g.fill();
  } else if (kind === 'panorama') {
    // A camera lens inside a full-turn arrow.
    g.beginPath();
    g.arc(0, 0, 13, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.arc(0, 0, 33, -Math.PI * 0.35, Math.PI * 1.45);
    g.stroke();
    const a = Math.PI * 1.45;
    g.beginPath();
    g.moveTo(Math.cos(a) * 33 + 12, Math.sin(a) * 33 - 2);
    g.lineTo(Math.cos(a) * 33, Math.sin(a) * 33);
    g.lineTo(Math.cos(a) * 33 + 2, Math.sin(a) * 33 + 13);
    g.stroke();
  } else if (kind === 'depot') {
    // A diamond holding three tubes.
    g.beginPath();
    g.moveTo(0, -40);
    g.lineTo(40, 0);
    g.lineTo(0, 40);
    g.lineTo(-40, 0);
    g.closePath();
    g.stroke();
    for (const x of [-12, 0, 12]) g.fillRect(x - 3, -14, 6, 28);
  } else {
    // A flag on a pole.
    g.beginPath();
    g.moveTo(-16, 38);
    g.lineTo(-16, -36);
    g.stroke();
    g.beginPath();
    g.moveTo(-14, -36);
    g.lineTo(26, -24);
    g.lineTo(-14, -10);
    g.closePath();
    g.fill();
  }
  g.restore();
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  icons.set(key, t);
  return t;
}

export interface MarkerLook {
  /** The objective the compass points to. */
  next: boolean;
  /** An optional discovery (quieter). */
  optional: boolean;
  /** The rover is in the ring. */
  active: boolean;
}

const BEAM_H = 90;
const SPARKS = 40;

export class SiteMarker {
  readonly group = new Group();
  private readonly beamMat: ShaderMaterial;
  private readonly padMat: ShaderMaterial;
  private readonly sparkMat: ShaderMaterial;
  private readonly wallMat: ShaderMaterial;
  private readonly badge: Sprite;
  private readonly base: Vector3;
  private readonly geometries: BufferGeometry[] = [];
  private look: MarkerLook = { next: false, optional: false, active: false };
  private readonly labelPos = new Vector3();
  private activeK = 0;

  constructor(
    x: number,
    z: number,
    groundAt: (x: number, z: number) => number,
    readonly radiusM: number,
    readonly kind: MarkerKind,
  ) {
    const y = groundAt(x, z);
    this.base = new Vector3(x, y, z);
    const colour = new Color(...MARKER_COLOURS[kind]);
    const common = {
      uColor: { value: colour },
      uTime: { value: 0 },
      uStrength: { value: 1 },
      uActive: { value: 0 },
    };

    // Column of light: a vertical quad turned to face the camera, widened with distance.
    const beamGeo = new BufferGeometry();
    beamGeo.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0]), 3),
    );
    beamGeo.setIndex([0, 1, 2, 1, 3, 2]);
    this.geometries.push(beamGeo);
    this.beamMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      uniforms: { ...common, uBase: { value: this.base }, uHeight: { value: BEAM_H } },
      vertexShader: /* glsl */ `
        uniform vec3 uBase;
        uniform float uHeight;
        varying vec2 vUv;
        varying float vDist;
        void main() {
          vec3 toCam = cameraPosition - uBase;
          vec2 flat2 = normalize(toCam.xz + vec2(1e-4));
          vec3 side = vec3(-flat2.y, 0.0, flat2.x);
          float d = length(toCam);
          // At least ~0.4° wide (a few pixels at any distance), 3 m close by.
          float halfW = max(1.5, d * 0.0035);
          vec3 p = uBase + side * position.x * halfW + vec3(0.0, position.y * uHeight, 0.0);
          vUv = vec2(position.x * 0.5 + 0.5, position.y);
          vDist = d;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uTime, uStrength, uActive;
        varying vec2 vUv;
        varying float vDist;
        void main() {
          float x = abs(vUv.x - 0.5) * 2.0;
          float core = exp(-x * x * 60.0);
          float glow = exp(-x * x * 5.0) * 0.45;
          // Energy flowing up the column.
          float flow = 0.7 + 0.3 * sin(vUv.y * 40.0 - uTime * 3.0);
          // pow() of a negative is NaN (interpolation can overshoot 1; NaN pixels end up black).
          float v = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.3);
          // Gone when the camera is close (it would be a wall of light), back from ~45 m.
          float near = smoothstep(16.0, 45.0, vDist);
          float a = (core * 1.4 + glow) * v * flow * uStrength * near;
          vec3 c = mix(uColor, vec3(1.0), core * 0.5);
          gl_FragColor = vec4(c * a, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const beam = new Mesh(beamGeo, this.beamMat);
    beam.frustumCulled = false;
    beam.renderOrder = 3;

    // Sparks rising at the foot of the column (positions animated in the shader).
    const sparkGeo = new BufferGeometry();
    const seed = new Float32Array(SPARKS * 3);
    for (let i = 0; i < SPARKS; i++) seed.set([Math.random(), Math.random(), Math.random()], i * 3);
    sparkGeo.setAttribute('position', new BufferAttribute(seed, 3));
    this.geometries.push(sparkGeo);
    this.sparkMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { ...common, uBase: { value: this.base }, uRadius: { value: radiusM } },
      vertexShader: /* glsl */ `
        uniform vec3 uBase;
        uniform float uTime, uRadius, uActive;
        varying float vA;
        void main() {
          vec3 s = position;
          float speed = 2.0 + 3.0 * s.y + 3.0 * uActive;
          float life = fract(uTime * speed / 14.0 + s.x);
          float ang = s.z * 6.2832 + uTime * (0.4 + s.y);
          // A few motes close round the column's foot (spread over the whole ring and seen from
          // inside it, they were specks floating across the view).
          float r = mix(0.3, min(2.5, uRadius * 0.2), s.y) * (1.0 - 0.6 * life);
          vec3 p = uBase + vec3(cos(ang) * r, life * 4.0, sin(ang) * r);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          vA = sin(life * 3.14159) * smoothstep(12.0, 25.0, -mv.z) * (1.0 - smoothstep(60.0, 120.0, -mv.z)) * 0.6;
          gl_PointSize = clamp(160.0 / -mv.z, 1.0, 5.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uStrength;
        varying float vA;
        void main() {
          vec2 q = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.0, length(q)) * vA * uStrength;
          gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.4) * a * 1.5, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const sparks = new Points(sparkGeo, this.sparkMat);
    sparks.frustumCulled = false;
    sparks.renderOrder = 3;

    // Ground pad: a polar grid draped on the terrain.
    const rings = 12;
    const segs = 72;
    const R = radiusM + 0.6;
    const pos = new Float32Array((rings + 1) * (segs + 1) * 3);
    const pol = new Float32Array((rings + 1) * (segs + 1) * 2);
    const index: number[] = [];
    for (let j = 0; j <= rings; j++)
      for (let i = 0; i <= segs; i++) {
        const k = j * (segs + 1) + i;
        const rr = (j / rings) * R;
        const a = (i / segs) * Math.PI * 2;
        const px = x + Math.cos(a) * rr;
        const pz = z + Math.sin(a) * rr;
        pos.set([px, groundAt(px, pz) + 0.1, pz], k * 3);
        pol.set([rr / radiusM, a], k * 2);
        if (j < rings && i < segs) {
          const n = k + segs + 1;
          index.push(k, n, k + 1, k + 1, n, n + 1);
        }
      }
    const padGeo = new BufferGeometry();
    padGeo.setAttribute('position', new BufferAttribute(pos, 3));
    padGeo.setAttribute('polar', new BufferAttribute(pol, 2));
    padGeo.setIndex(index);
    this.geometries.push(padGeo);
    this.padMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        ...common,
        tIcon: { value: iconTexture(kind, false) },
        uRadius: { value: radiusM },
      },
      vertexShader: /* glsl */ `
        attribute vec2 polar;
        varying vec2 vPolar;
        varying vec2 vXY;
        varying float vDist;
        void main() {
          vPolar = polar;
          vXY = vec2(cos(polar.y), sin(polar.y)) * polar.x;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vDist = length(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uTime, uStrength, uActive, uRadius;
        uniform sampler2D tIcon;
        varying vec2 vPolar;
        varying vec2 vXY;
        varying float vDist;
        float band(float r, float at, float w) { return 1.0 - smoothstep(0.0, w, abs(r - at)); }
        void main() {
          float r = vPolar.x;
          float a = vPolar.y;
          float px = fwidth(r) * 3.0;
          // Rim (with a slow rotating dash), an inner ring, and tick marks.
          float dash = 0.7 + 0.3 * step(0.5, fract(a / 6.2832 * 24.0 - uTime * 0.25));
          float rim = band(r, 1.0, 0.03 + px) * dash;
          float inner = band(r, 0.82, 0.012 + px) * 0.6;
          float tick = step(0.86, r) * step(r, 1.0) * (1.0 - smoothstep(0.0, 0.04 + px, abs(fract(a / 6.2832 * 8.0 + 0.5) - 0.5)));
          // Waves running out from the centre.
          float speed = 0.35 + 0.5 * uActive;
          float wave = band(fract(r - uTime * speed), 0.5, 0.04 + px) * step(r, 1.0) * (0.35 + 0.4 * uActive);
          // The icon painted in the centre (about 4 m across).
          vec2 iuv = vXY * uRadius / 4.0 * vec2(1.0, -1.0) + 0.5;
          float icon = 0.0;
          if (all(greaterThan(iuv, vec2(0.0))) && all(lessThan(iuv, vec2(1.0)))) icon = texture2D(tIcon, iuv).a;
          float fill = step(r, 1.0) * (0.05 + 0.1 * uActive);
          float aa = (rim * 0.8 + inner * 0.7 + tick * 0.7 + wave * 0.8 + fill + icon * 0.8) * uStrength;
          // Read from far away: brighter rim at a distance.
          aa *= 1.0 + smoothstep(60.0, 300.0, vDist) * 0.8;
          // Warmer than the beam, so the ring on the ground reads as part of the scene's light.
          vec3 c = mix(mix(uColor, vec3(1.0, 0.93, 0.8), 0.35), vec3(1.0), 0.25 * uActive + 0.3 * icon);
          gl_FragColor = vec4(c * aa, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const pad = new Mesh(padGeo, this.padMat);
    pad.frustumCulled = false;
    pad.renderOrder = 2;

    const wallSegs = 96;
    const wpos = new Float32Array((wallSegs + 1) * 2 * 3);
    const wuv = new Float32Array((wallSegs + 1) * 2 * 2);
    const windex: number[] = [];
    for (let i = 0; i <= wallSegs; i++) {
      const a = (i / wallSegs) * Math.PI * 2;
      const px = x + Math.cos(a) * radiusM;
      const pz = z + Math.sin(a) * radiusM;
      const gy = groundAt(px, pz);
      wpos.set([px, gy, pz, px, gy + 1, pz], i * 6);
      wuv.set([i / wallSegs, 0, i / wallSegs, 1], i * 4);
      if (i < wallSegs) windex.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
    }
    const wallGeo = new BufferGeometry();
    wallGeo.setAttribute('position', new BufferAttribute(wpos, 3));
    wallGeo.setAttribute('uv', new BufferAttribute(wuv, 2));
    wallGeo.setIndex(windex);
    this.geometries.push(wallGeo);
    this.wallMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      uniforms: { ...common, uWallH: { value: 1.1 } },
      vertexShader: /* glsl */ `
        uniform float uWallH, uActive;
        varying vec2 vUv;
        varying float vDist;
        void main() {
          vUv = uv;
          // The top edge rises from the ground's own height (draped wall).
          vec3 p = position;
          p.y += uv.y * (uWallH * (1.0 + 0.6 * uActive) - 1.0);
          vec4 wp = modelMatrix * vec4(p, 1.0);
          vDist = length(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uTime, uStrength, uActive;
        varying vec2 vUv;
        varying float vDist;
        void main() {
          // Clamped: MSAA samples interpolate a little past the top edge, and pow() of a negative
          // is NaN (drawn as black dashes along the ring's far side).
          float h = clamp(vUv.y, 0.0, 1.0);
          float fadeUp = pow(1.0 - h, 2.2);
          float scan = 0.85 + 0.15 * sin(h * 30.0 - uTime * (3.0 + 4.0 * uActive));
          float lip = 1.0 - smoothstep(0.0, 0.1, h);
          float a = (fadeUp * 0.24 * scan + lip * 0.12) * uStrength;
          // A faint veil, not a wall of light: quieter close by (the rover drives through it) and
          // gone beyond a couple of hundred metres (the beam and badge do it there).
          a *= mix(0.15, 1.0, smoothstep(5.0, 28.0, vDist)) * (1.0 - smoothstep(120.0, 320.0, vDist));
          // Once the rover is in the ring, the wall steps back and the pad says it is ready.
          a *= 1.0 - 0.55 * uActive;
          vec3 c = mix(uColor, vec3(1.0, 0.94, 0.84), 0.35 + 0.2 * uActive);
          gl_FragColor = vec4(c * a, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const wall = new Mesh(wallGeo, this.wallMat);
    wall.frustumCulled = false;
    wall.renderOrder = 2;

    // Floating badge with the icon.
    this.badge = new Sprite(
      new SpriteMaterial({
        map: iconTexture(kind, true),
        transparent: true,
        depthWrite: false,
        fog: false,
        toneMapped: false,
      }),
    );
    this.badge.renderOrder = 4;
    this.group.add(beam, sparks, pad, wall, this.badge);
  }

  setLook(look: MarkerLook): void {
    this.look = look;
    const strength = look.next ? 1.25 : look.optional ? 0.55 : 0.85;
    for (const m of [this.beamMat, this.padMat, this.sparkMat])
      m.uniforms.uStrength!.value = strength;
    this.beamMat.uniforms.uHeight!.value = look.next
      ? BEAM_H * 1.4
      : look.optional
        ? BEAM_H * 0.6
        : BEAM_H;
  }

  update(timeS: number, dt: number, camera: Camera): void {
    this.activeK += ((this.look.active ? 1 : 0) - this.activeK) * Math.min(1, dt * 4);
    for (const m of [this.beamMat, this.padMat, this.sparkMat]) {
      m.uniforms.uTime!.value = timeS;
      m.uniforms.uActive!.value = this.activeK;
    }
    // The badge bobs above the site, kept readable at any distance, gone when very close.
    const d = camera.position.distanceTo(this.base);
    const s = Math.min(60, Math.max(2.4, d * (this.look.next ? 0.055 : 0.042)));
    this.badge.scale.set(s, s, 1);
    this.badge.position.set(
      this.base.x,
      this.base.y + 6 + s * 0.6 + Math.sin(timeS * 1.6) * 0.35,
      this.base.z,
    );
    this.labelPos.copy(this.badge.position);
    this.labelPos.y += s * 0.62;
    const mat = this.badge.material;
    mat.opacity = Math.min(1, Math.max(0, (d - 10) / 12)) * (this.look.optional ? 0.75 : 1);
    this.badge.visible = mat.opacity > 0.01;
  }

  /** World position just above the badge (for the label). */
  get labelAnchor(): Vector3 {
    return this.labelPos;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    this.beamMat.dispose();
    this.padMat.dispose();
    this.sparkMat.dispose();
    this.wallMat.dispose();
    this.badge.material.dispose();
  }
}
