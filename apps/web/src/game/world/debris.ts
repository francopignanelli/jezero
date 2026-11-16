import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Euler,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type DataArrayTexture,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { GROUND_WB } from './terrain';

/**
 * What makes the delta front look like the delta front in Perseverance's images (Wildcat Ridge,
 * Skinner Ridge, Amalik): its sedimentary rock, laid down in thin layers, breaks into flat plates.
 * - Chips: the ground is littered with flat, angular fragments of it, centimetres to decimetres
 *   across, lighter and more orange than the sand, with a few dark (igneous) pebbles among them.
 *   Drawn densely around the camera only; too small to matter to the wheels.
 * - Ledges: where bedrock crops out on the slopes, stacked layers stand out as ledges, the
 *   harder layers jutting out over the softer ones (differential erosion), dark underneath. They
 *   are obstacles: the wheels cannot climb them and AutoNav plans around them.
 * Placement is deterministic (same world every time) and keeps clear of the places to visit,
 * the airfields and Perseverance's real route (it drove where there were no ledges).
 */

export interface DebrisGround {
  height(x: number, north: number): number;
  /** Orbital brightness 0–1 (bright bedrock, dark sand). */
  brightness(x: number, north: number): number;
  /** Ground normal (x east, y up, z south). */
  normal(x: number, north: number): [number, number, number];
  sand(x: number, north: number): number;
  /** Distance to the nearest place kept clear (sites, start, airfields, the real route). */
  clearance(x: number, north: number): number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const cellSeed = (i: number, j: number, salt: number) =>
  (Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ Math.imul(salt, 83492791)) >>> 0;

/**
 * A flat angular plate: an irregular polygon extruded to `thick` (radius 1 across), the top edge
 * chamfered, flat-shaded. Vertex colours: top lighter, sides darker, underside dark.
 */
function plate(
  rand: () => number,
  sides: number,
  thick: number,
  stretch = 1,
  colours = { top: 1, side: 0.78, bottom: 0.45 },
): BufferGeometry {
  const ring: Array<[number, number]> = [];
  for (let k = 0; k < sides; k++) {
    const a = ((k + (rand() - 0.5) * 0.6) / sides) * Math.PI * 2;
    const r = 0.7 + 0.45 * rand();
    ring.push([Math.cos(a) * r * stretch, Math.sin(a) * r]);
  }
  const pos: number[] = [];
  const col: number[] = [];
  const tri = (a: number[], b: number[], c: number[], shade: number) => {
    pos.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) col.push(shade, shade, shade);
  };
  const top = thick;
  const chamfer = 0.88;
  for (let k = 0; k < sides; k++) {
    const [ax, az] = ring[k]!;
    const [bx, bz] = ring[(k + 1) % sides]!;
    // Top (chamfered inward) and bottom fans.
    tri(
      [0, top, 0],
      [bx * chamfer, top, bz * chamfer],
      [ax * chamfer, top, az * chamfer],
      colours.top,
    );
    tri([0, 0, 0], [ax, 0, az], [bx, 0, bz], colours.bottom);
    // Chamfer band and side.
    const t0 = [ax * chamfer, top, az * chamfer];
    const t1 = [bx * chamfer, top, bz * chamfer];
    const m0 = [ax, top * 0.72, az];
    const m1 = [bx, top * 0.72, bz];
    const b0 = [ax, 0, az];
    const b1 = [bx, 0, bz];
    tri(t0, t1, m1, (colours.top + colours.side) / 2);
    tri(t0, m1, m0, (colours.top + colours.side) / 2);
    tri(m0, m1, b1, colours.side);
    tri(m0, b1, b0, colours.side);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.computeVertexNormals();
  return g;
}

/** Merges geometries that all have position, normal and colour. */
function merge(parts: BufferGeometry[]): BufferGeometry {
  const n = parts.reduce((s, g) => s + g.getAttribute('position').count, 0);
  const pos = new Float32Array(n * 3);
  const nrm = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.getAttribute('position').array as Float32Array, o * 3);
    nrm.set(g.getAttribute('normal').array as Float32Array, o * 3);
    col.set(g.getAttribute('color').array as Float32Array, o * 3);
    o += g.getAttribute('position').count;
    g.dispose();
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(pos, 3));
  out.setAttribute('normal', new BufferAttribute(nrm, 3));
  out.setAttribute('color', new BufferAttribute(col, 3));
  return out;
}

/**
 * A ledge: layers stacked up the slope's face, each a long thin plate; harder layers jut out,
 * softer ones are recessed. Local frame: x along the slope's contour, +z downslope, y up; about
 * 1 unit long, 0.35 deep, 0.25–0.4 high (scaled per instance).
 */
function ledge(seed: number): BufferGeometry {
  const rand = mulberry32(seed * 7907 + 3);
  const parts: BufferGeometry[] = [];
  const layers = 5 + Math.floor(rand() * 5);
  let y = 0;
  let front = 0;
  for (let k = 0; k < layers; k++) {
    const hard = rand() < 0.45;
    const t = (hard ? 0.035 : 0.02) + 0.03 * rand();
    // Each layer steps back up the slope; hard ones jut out over the layer below.
    front += -0.025 - 0.02 * rand() + (hard ? 0.05 : 0);
    const len = 0.5 * (0.75 + 0.3 * rand()) * (1 - k / (layers * 2.2));
    const depth = 0.17 + 0.06 * rand();
    const shade = (hard ? 0.95 : 0.76) * (0.9 + 0.2 * rand());
    const g = plate(rand, 9, t / depth, len / depth, {
      top: shade,
      side: shade * 0.82,
      bottom: shade * 0.3,
    });
    g.scale(depth, depth, depth);
    g.translate((rand() - 0.5) * 0.06, y, front);
    parts.push(g);
    y += t * 0.92;
  }
  return merge(parts);
}

/** Triplanar bedrock photo on debris (as on the rocks), with the ground's white balance. */
function debrisMaterial(texture: DataArrayTexture, key: string): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    roughness: 0.9,
    metalness: 0,
    vertexColors: true,
    flatShading: true,
  });
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.tGround = { value: texture };
    shader.uniforms.uWB = { value: new Vector3(...GROUND_WB) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDebP;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vDebP = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         precision highp sampler2DArray;
         uniform sampler2DArray tGround;
         uniform vec3 uWB;
         varying vec3 vDebP;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         {
           vec3 tx = texture(tGround, vec3(vDebP.xz * 2.2, 3.0)).rgb;
           vec3 ty = texture(tGround, vec3(vDebP.xy * 2.2 + 0.3, 3.0)).rgb;
           vec3 tex = mix(tx, ty, 0.5) * uWB;
           float lum = dot(tex, vec3(0.3, 0.59, 0.11));
           // The rock photo's grain as brightness only (its hue would make the debris oranger
           // than the ground).
           // Thin laminations across the layers' faces.
           float lam = sin(vDebP.y * 6.2832 / 0.03 + 4.0 * sin(dot(vDebP.xz, vec2(0.9, 0.4))));
           diffuseColor.rgb *= mix(1.0, clamp(lum / 0.12, 0.45, 1.7), 0.5) * (1.0 - 0.1 * smoothstep(0.5, 1.0, lam));
         }`,
      );
  };
  m.customProgramCacheKey = () => `copernico-debris-${key}`;
  return m;
}

// ---------- chips ----------

interface Chip {
  x: number;
  north: number;
  y: number;
  size: number;
  thick: number;
  rotY: number;
  tiltX: number;
  tiltZ: number;
  variant: number;
  dark: boolean;
  tone: number;
}

const CHIP_VARIANTS = 6;
const CHIP_CELL = 1;

export class Chips {
  readonly meshes: InstancedMesh[] = [];
  readonly material: MeshStandardMaterial;
  private readonly cache = new Map<string, Chip[]>();
  private lastX = Infinity;
  private lastN = Infinity;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly e = new Euler();
  private readonly s = new Vector3();
  private readonly t = new Vector3();
  private readonly c = new Color();
  /** Plate colour (linear albedo) from the ground photos' bedrock, white-balanced. */
  private readonly light: Color;
  private readonly dark = new Color(0.06, 0.05, 0.045);

  constructor(
    private readonly ground: DebrisGround,
    texture: DataArrayTexture,
    soilMean: Color,
    private readonly radius: number,
  ) {
    this.material = debrisMaterial(texture, 'chips');
    // The ground's own hue (the regolith as the terrain draws it), a quarter lighter: the plates
    // are the same rock as the pavement under the dust, not a different, oranger material.
    this.light = soilMean
      .clone()
      .multiply(new Color(...GROUND_WB))
      .multiply(new Color(1.25, 1.28, 1.32));
    for (let v = 0; v < CHIP_VARIANTS; v++) {
      const rand = mulberry32(v * 131 + 7);
      const g = plate(rand, 5 + (v % 3), 0.3, 1 + 0.3 * rand());
      const mesh = new InstancedMesh(g, this.material, 6000);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.meshes.push(mesh);
    }
  }

  private cell(i: number, j: number): Chip[] {
    const key = `${i}:${j}`;
    let list = this.cache.get(key);
    if (list) return list;
    list = [];
    const rand = mulberry32(cellSeed(i, j, 0x3c1b));
    const cx = (i + 0.5) * CHIP_CELL;
    const cn = (j + 0.5) * CHIP_CELL;
    const b = this.ground.brightness(cx, cn);
    const sand = this.ground.sand(cx, cn);
    // Plates on bright, broken bedrock (dense where it crops out); pebbles on the sand.
    const rocky = Math.min(1, Math.max(0, (b - 0.27) / 0.2)) * (1 - 0.9 * sand);
    const expected = (2.5 + 10 * rocky) * (0.45 + 1.1 * rand());
    let count = 0;
    for (let p = Math.exp(-expected), s = p, u = rand(); u > s && count < 24;) {
      count++;
      p *= expected / count;
      s += p;
    }
    for (let k = 0; k < count; k++) {
      const x = cx + (rand() - 0.5) * CHIP_CELL;
      const north = cn + (rand() - 0.5) * CHIP_CELL;
      // Sizes: many small, a few up to ~40 cm (truncated power law); dark igneous pebbles,
      // smaller and rounder, are commoner on the sand.
      const dark = rand() < 0.55 - 0.42 * rocky;
      const maxM = dark ? 0.12 : 0.38;
      const size = 0.03 * (1 - rand() * (1 - (0.03 / maxM) ** 1.9)) ** (-1 / 1.9);
      const thick = size * (dark ? 0.5 + 0.3 * rand() : 0.08 + 0.1 * rand());
      list.push({
        x,
        north,
        y: this.ground.height(x, north) - thick * (dark ? 0.35 : 0.45),
        size,
        thick,
        rotY: rand() * Math.PI * 2,
        tiltX: (rand() - 0.5) * 0.22,
        tiltZ: (rand() - 0.5) * 0.22,
        variant: Math.floor(rand() * CHIP_VARIANTS),
        dark,
        tone: rand(),
      });
    }
    this.cache.set(key, list);
    if (this.cache.size > 8000) this.cache.delete(this.cache.keys().next().value!);
    return list;
  }

  update(camX: number, camNorth: number): void {
    if (Math.hypot(camX - this.lastX, camNorth - this.lastN) < 1.5) return;
    this.lastX = camX;
    this.lastN = camNorth;
    const counts = new Array(CHIP_VARIANTS).fill(0) as number[];
    const r = Math.ceil(this.radius / CHIP_CELL);
    const i0 = Math.floor(camX / CHIP_CELL);
    const j0 = Math.floor(camNorth / CHIP_CELL);
    for (let i = i0 - r; i <= i0 + r; i++)
      for (let j = j0 - r; j <= j0 + r; j++) {
        if ((i - i0) ** 2 + (j - j0) ** 2 > r * r) continue;
        for (const chip of this.cell(i, j)) {
          const mesh = this.meshes[chip.variant]!;
          const k = counts[chip.variant]!;
          if (k >= mesh.instanceMatrix.count) continue;
          this.e.set(chip.tiltX, chip.rotY, chip.tiltZ, 'YXZ');
          this.q.setFromEuler(this.e);
          this.s.set(chip.size / 2, chip.thick / 0.3, chip.size / 2);
          this.t.set(chip.x, chip.y, -chip.north);
          this.m.compose(this.t, this.q, this.s);
          mesh.setMatrixAt(k, this.m);
          if (chip.dark) this.c.copy(this.dark).multiplyScalar(0.8 + 0.5 * chip.tone);
          else this.c.copy(this.light).multiplyScalar(0.75 + 0.5 * chip.tone);
          mesh.setColorAt(k, this.c);
          counts[chip.variant] = k + 1;
        }
      }
    for (const [v, mesh] of this.meshes.entries()) {
      mesh.count = counts[v]!;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const m of this.meshes) m.geometry.dispose();
    this.material.dispose();
  }
}

// ---------- ledges ----------

export interface Ledge {
  x: number;
  north: number;
  /** Yaw of the ledge's length axis (rad, from east towards north). */
  yaw: number;
  lengthM: number;
  depthM: number;
  heightM: number;
}

const LEDGE_VARIANTS = 6;
const LEDGE_GRID_M = 6;
/** Lookup cells for the wheels' collision test. */
const LOOKUP_M = 16;

export class Ledges {
  readonly meshes: InstancedMesh[] = [];
  readonly material: MeshStandardMaterial;
  readonly list: Ledge[] = [];
  private readonly lookup = new Map<string, Ledge[]>();

  /** Places ledges over an extent (x ±width/2, north ±height/2) of the ground. */
  constructor(
    ground: DebrisGround,
    texture: DataArrayTexture,
    soilMean: Color,
    widthM: number,
    heightM: number,
  ) {
    this.material = debrisMaterial(texture, 'ledges');
    // Weathered faces a little darker and greyer than the dust on the slope around them (as at
    // Wildcat Ridge), in the same hue: brighter, oranger ledges read as props set on the hill.
    const tint = soilMean
      .clone()
      .multiply(new Color(...GROUND_WB))
      .multiply(new Color(0.9, 0.93, 0.97));
    const placed: Array<Ledge & { variant: number; y: number; tone: number }> = [];
    for (let x = -widthM / 2; x < widthM / 2; x += LEDGE_GRID_M)
      for (let n = -heightM / 2; n < heightM / 2; n += LEDGE_GRID_M) {
        const rand = mulberry32(cellSeed(Math.round(x), Math.round(n), 0x7a11));
        const px = x + rand() * LEDGE_GRID_M;
        const pn = n + rand() * LEDGE_GRID_M;
        const [nx, ny, nz] = ground.normal(px, pn);
        const slope = 1 - ny; // 0.03 ≈ 14°, 0.13 ≈ 30°, 0.3 ≈ 45°
        if (slope < 0.025 || slope > 0.32) continue;
        const b = ground.brightness(px, pn);
        if (b < 0.4 || ground.sand(px, pn) > 0.15) continue;
        if (ground.clearance(px, pn) < 7) continue;
        // Outcrops follow particular layers: the harder beds crop out in bands at the same
        // elevation along the slope (strata), not as ledges dotted evenly over it.
        const h = ground.height(px, pn);
        const bed =
          0.5 + 0.5 * Math.sin((h / 5.5) * Math.PI * 2 + 2.5 * Math.sin(px * 0.013 + pn * 0.009));
        if (bed < 0.55) continue;
        const odds = 0.75 * Math.min(1, (slope - 0.025) / 0.08) * Math.min(1, (b - 0.4) / 0.15);
        if (rand() > odds) continue;
        // Facing downslope: +z of the ledge along the ground's downhill direction (x east, north).
        const yawDown = Math.atan2(-nz, nx);
        const yaw = yawDown + Math.PI / 2;
        // A line of ledges along the contour (the same layer cropping out), blocks fallen below.
        const pieces = 1 + Math.floor(rand() * 3);
        let along = -((pieces - 1) * 3.5) / 2;
        for (let k = 0; k < pieces; k++) {
          const lengthM = 2.2 + 4.5 * rand();
          const qx = px + Math.cos(yaw) * along;
          const qn = pn + Math.sin(yaw) * along;
          along += lengthM * 0.8 + 0.5 * rand();
          if (ground.clearance(qx, qn) < 7) continue;
          const heightM = (0.45 + 0.9 * rand()) * Math.min(1.4, 0.7 + slope * 4);
          placed.push({
            x: qx,
            north: qn,
            yaw: yaw + (rand() - 0.5) * 0.3,
            lengthM,
            depthM: lengthM * 0.38,
            heightM,
            variant: Math.floor(rand() * LEDGE_VARIANTS),
            // Half buried in its own talus: it crops out of the slope, not stands on it.
            y: ground.height(qx, qn) - heightM * 0.3,
            tone: rand(),
          });
        }
        const blocks = Math.floor(rand() * 4);
        for (let k = 0; k < blocks; k++) {
          const dist = 2.5 + 7 * rand();
          const side = (rand() - 0.5) * 6;
          const qx = px + Math.cos(yawDown) * dist + Math.cos(yaw) * side;
          const qn = pn + Math.sin(yawDown) * dist + Math.sin(yaw) * side;
          if (ground.clearance(qx, qn) < 6) continue;
          const lengthM = 0.9 + 1.4 * rand();
          const heightM = lengthM * (0.3 + 0.25 * rand());
          placed.push({
            x: qx,
            north: qn,
            yaw: rand() * Math.PI * 2,
            lengthM,
            depthM: lengthM * 0.38,
            heightM,
            variant: Math.floor(rand() * LEDGE_VARIANTS),
            y: ground.height(qx, qn) - heightM * 0.3,
            tone: rand(),
          });
        }
      }
    const counts = new Array(LEDGE_VARIANTS).fill(0) as number[];
    for (const p of placed) counts[p.variant]!++;
    const m = new Matrix4();
    const q = new Quaternion();
    const s = new Vector3();
    const t = new Vector3();
    const c = new Color();
    const up = new Vector3(0, 1, 0);
    for (let v = 0; v < LEDGE_VARIANTS; v++) {
      const mesh = new InstancedMesh(ledge(v), this.material, Math.max(1, counts[v]!));
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.meshes.push(mesh);
    }
    for (const p of placed) {
      const mesh = this.meshes[p.variant]!;
      // World: the ledge's +x along the contour; three's rotation is about +y with z south.
      q.setFromAxisAngle(up, p.yaw);
      s.set(p.lengthM, p.heightM / 0.3, p.lengthM);
      t.set(p.x, p.y, -p.north);
      m.compose(t, q, s);
      mesh.setMatrixAt(mesh.count, m);
      mesh.setColorAt(mesh.count, c.copy(tint).multiplyScalar(0.8 + 0.4 * p.tone));
      mesh.count++;
      const ledgeRec: Ledge = {
        x: p.x,
        north: p.north,
        yaw: p.yaw,
        lengthM: p.lengthM,
        depthM: p.depthM,
        heightM: p.heightM * 0.7,
      };
      this.list.push(ledgeRec);
      const key = `${Math.floor(p.x / LOOKUP_M)}:${Math.floor(p.north / LOOKUP_M)}`;
      const cell = this.lookup.get(key) ?? [];
      cell.push(ledgeRec);
      this.lookup.set(key, cell);
    }
    for (const mesh of this.meshes) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }

  /** Height of a ledge above the ground at a point (0 off ledges): what stops the wheels. */
  liftAt(x: number, north: number): number {
    let lift = 0;
    const i0 = Math.floor(x / LOOKUP_M);
    const j0 = Math.floor(north / LOOKUP_M);
    for (let i = i0 - 1; i <= i0 + 1; i++)
      for (let j = j0 - 1; j <= j0 + 1; j++)
        for (const l of this.lookup.get(`${i}:${j}`) ?? []) {
          // Into the ledge's frame: u along its length, w across (downslope).
          const dx = x - l.x;
          const dn = north - l.north;
          const c = Math.cos(l.yaw);
          const s = Math.sin(l.yaw);
          // three's +y rotation by yaw turns local +x to (cos, −sin) in (x, z) = (cos, sin) in (x, north).
          const u = dx * c + dn * s;
          const w = -dx * s + dn * c;
          const eu = 1 - (u / (l.lengthM * 0.45)) ** 2;
          const ew = 1 - (w / (l.depthM * 0.45)) ** 2;
          if (eu <= 0 || ew <= 0) continue;
          lift = Math.max(lift, l.heightM * Math.sqrt(Math.min(eu, ew)));
        }
    return lift;
  }

  /** The ledges as circles along their length (for AutoNav's map). */
  obstacles(): Array<{ x: number; north: number; radiusM: number }> {
    const out: Array<{ x: number; north: number; radiusM: number }> = [];
    for (const l of this.list) {
      const r = l.depthM * 0.45;
      const steps = Math.max(1, Math.ceil((l.lengthM * 0.9) / (r * 1.5)));
      for (let k = 0; k <= steps; k++) {
        const f = (k / steps - 0.5) * l.lengthM * 0.9;
        out.push({
          x: l.x + Math.cos(l.yaw) * f,
          north: l.north + Math.sin(l.yaw) * f,
          radiusM: r,
        });
      }
    }
    return out;
  }

  dispose(): void {
    for (const m of this.meshes) m.geometry.dispose();
    this.material.dispose();
  }
}

export const colourFromSrgb = (rgb: [number, number, number]): Color =>
  new Color().setRGB(rgb[0], rgb[1], rgb[2], SRGBColorSpace);
