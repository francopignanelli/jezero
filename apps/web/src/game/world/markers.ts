import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  Mesh,
  ShaderMaterial,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Camera,
} from 'three';

/**
 * Markers of the places to go (sample sites, panorama spots, the depot, places to reach): a
 * navigation beacon, a narrow beam of light on a small base anchored to the ground, and a floating
 * badge with the kind's icon (a drill core, a camera, the depot, a flag). The next objective's
 * beam is brighter and taller; optional discoveries are quieter. Nothing covers the terrain.
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
    glow.addColorStop(0, `rgba(${r}, ${gg}, ${b}, 0.3)`);
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
  /** The rover is at the place. */
  active: boolean;
}

/** Height of the beam (m); the next objective's is taller. */
const BEAM_H = 120;
/** Radius of the glow at the beam's foot (m). */
const BASE_R = 1.6;

/**
 * A navigation beacon: a narrow vertical beam of light standing on a small anchored base, and the
 * floating badge with the kind's icon. Nothing else touches the ground: no rings, walls or zones
 * (the place's extent is the game's business, shown by the prompt when the rover is in it).
 * - The beam: a bright, thin core inside a soft halo that widens a little with height, as light
 *   scattered by the dust would; brightest at its foot, fading upwards. It faces the camera and
 *   keeps at least about two pixels of halo at any distance; it is depth-tested (the terrain hides
 *   it), quiet close by, and dimmer very far away.
 * - The base: a small emitter on the ground and a soft glow around it, brighter (with a slow
 *   breath) when the rover is at the place.
 */
export class SiteMarker {
  readonly group = new Group();
  private readonly beamMat: ShaderMaterial;
  private readonly baseMat: ShaderMaterial;
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

    // Beam: a vertical quad turned to face the camera, widened with distance.
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
        varying float vHalf;
        void main() {
          vec3 toCam = cameraPosition - uBase;
          vec2 flat2 = normalize(toCam.xz + vec2(1e-4));
          vec3 side = vec3(-flat2.y, 0.0, flat2.x);
          float d = length(toCam);
          // Halo half-width: 0.35 m close by, at least ~0.13° (about two pixels) far away.
          float halfW = max(0.35, d * 0.0022);
          vec3 p = uBase + side * position.x * halfW + vec3(0.0, position.y * uHeight, 0.0);
          vUv = vec2(position.x, position.y);
          vDist = d;
          vHalf = halfW;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uTime, uStrength, uActive, uHeight;
        varying vec2 vUv;
        varying float vDist;
        varying float vHalf;
        void main() {
          float y = clamp(vUv.y, 0.0, 1.0);
          float x = abs(vUv.x);
          // The core: about 6 cm wide close by, never thinner than about a pixel.
          float coreW = max(0.03 / vHalf, 0.22);
          float core = exp(-pow(x / coreW, 2.0) * 2.0);
          // The halo widens with height (scattered light), and fades towards the quad's edge.
          float haloW = mix(0.35, 0.8, y);
          float halo = exp(-pow(x / haloW, 2.0) * 3.0) * (1.0 - smoothstep(0.7, 1.0, x));
          // Brightest at the foot, fading up into the sky; a soft, slow shimmer.
          float rise = exp(-y * 3.2) * 0.8 + 0.2 * (1.0 - y);
          float shimmer = 0.94 + 0.06 * sin(y * uHeight * 0.08 - uTime * 0.6);
          // Quiet close by (it would be a wall of light beside the rover), dimmer very far away.
          float near = mix(0.15, 1.0, smoothstep(8.0, 40.0, vDist));
          float far = mix(1.0, 0.45, smoothstep(1500.0, 5000.0, vDist));
          float a = (core * 0.9 + halo * 0.22) * rise * shimmer * near * far * uStrength * (1.0 - 0.85 * uActive);
          vec3 c = mix(uColor, vec3(1.0, 0.97, 0.92), core * 0.6);
          gl_FragColor = vec4(c * a, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const beam = new Mesh(beamGeo, this.beamMat);
    beam.frustumCulled = false;
    beam.renderOrder = 3;

    // Base: a small disc draped on the terrain (a few rings), lit from its centre.
    const rings = 6;
    const segs = 40;
    const pos = new Float32Array((rings + 1) * (segs + 1) * 3);
    const rad = new Float32Array((rings + 1) * (segs + 1));
    const index: number[] = [];
    for (let j = 0; j <= rings; j++)
      for (let i = 0; i <= segs; i++) {
        const k = j * (segs + 1) + i;
        const rr = (j / rings) * BASE_R;
        const a = (i / segs) * Math.PI * 2;
        const px = x + Math.cos(a) * rr;
        const pz = z + Math.sin(a) * rr;
        pos.set([px, groundAt(px, pz) + 0.04, pz], k * 3);
        rad[k] = rr / BASE_R;
        if (j < rings && i < segs) {
          const n = k + segs + 1;
          index.push(k, n, k + 1, k + 1, n, n + 1);
        }
      }
    const baseGeo = new BufferGeometry();
    baseGeo.setAttribute('position', new BufferAttribute(pos, 3));
    baseGeo.setAttribute('aR', new BufferAttribute(rad, 1));
    baseGeo.setIndex(index);
    this.geometries.push(baseGeo);
    this.baseMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      uniforms: { ...common },
      vertexShader: /* glsl */ `
        attribute float aR;
        varying float vR;
        void main() {
          vR = aR;
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uTime, uStrength, uActive;
        varying float vR;
        void main() {
          float r = clamp(vR, 0.0, 1.0);
          // The emitter (a 12 cm spot), a soft pool of light round it, one fine ring at its edge.
          float spot = exp(-pow(r / 0.075, 2.0));
          float pool = exp(-r * r * 6.0) * (1.0 - r);
          float edge = exp(-pow((r - 0.82) / 0.03, 2.0)) * 0.35;
          float breath = 0.85 + 0.15 * sin(uTime * 1.6);
          float a = (spot * 1.4 + pool * (0.18 + 0.32 * uActive * breath) + edge * (0.4 + 0.6 * uActive))
                  * uStrength;
          gl_FragColor = vec4(mix(uColor, vec3(1.0, 0.96, 0.9), spot * 0.6) * a, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const baseMesh = new Mesh(baseGeo, this.baseMat);
    baseMesh.frustumCulled = false;
    baseMesh.renderOrder = 2;

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
    this.group.add(beam, baseMesh, this.badge);
  }

  setLook(look: MarkerLook): void {
    this.look = look;
    this.beamMat.uniforms.uStrength!.value = look.next ? 1.15 : look.optional ? 0.5 : 0.8;
    this.beamMat.uniforms.uHeight!.value = look.next
      ? BEAM_H * 1.35
      : look.optional
        ? BEAM_H * 0.55
        : BEAM_H;
  }

  update(timeS: number, dt: number, camera: Camera): void {
    this.activeK += ((this.look.active ? 1 : 0) - this.activeK) * Math.min(1, dt * 4);
    for (const m of [this.beamMat, this.baseMat]) {
      m.uniforms.uTime!.value = timeS;
      m.uniforms.uActive!.value = this.activeK;
    }
    // The badge floats above the beam's foot, kept readable at any distance, gone when close.
    const d = camera.position.distanceTo(this.base);
    const s = Math.min(48, Math.max(2.0, d * (this.look.next ? 0.045 : 0.035)));
    this.badge.scale.set(s, s, 1);
    this.badge.position.set(
      this.base.x,
      this.base.y + 5 + s * 0.6 + Math.sin(timeS * 1.2) * 0.2,
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
    this.baseMat.dispose();
    this.badge.material.dispose();
  }
}
