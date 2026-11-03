import {
  Color,
  DynamicDrawUsage,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Euler,
  Vector3,
  type BufferGeometry,
  type DataArrayTexture,
  type WebGLProgramParametersWithUniforms,
} from 'three';

/**
 * Rocks: placed deterministically per ground cell (a hash of the cell), so the renderer and the
 * rover's physics see the same rocks without storing them. Sizes follow a power law (many small
 * stones, few boulders, as in rover rock counts); density follows the ground: more on bright
 * bedrock and slopes, few on dark sand. Shapes are noise-displaced spheres (rounded cobbles and
 * flat slabs), sunk into the ground, textured with the real bedrock photo and dusted on top; about
 * a third are dark (basaltic float rocks, as scattered over Jezero's floor). Fresh crater rims and
 * ejecta carry boulder fields.
 */

export interface Rock {
  x: number;
  north: number;
  /** Centre height (m above the world base). */
  y: number;
  sx: number;
  sy: number;
  sz: number;
  rotY: number;
  tiltX: number;
  tiltZ: number;
  variant: number;
  tone: number;
  dark: boolean;
  /** Top of the rock above the ground at its centre, and its footprint radius (m). */
  topM: number;
  radiusM: number;
}

export interface GroundInfo {
  height(x: number, north: number): number;
  /** 0 (dark sand) … 1 (bright bedrock) orbital brightness, and slope (1 − normal.y). */
  brightness(x: number, north: number): number;
  slope(x: number, north: number): number;
  /** Extra rock density near features (crater rims and ejecta), 0 elsewhere. */
  rockiness?(x: number, north: number): number;
}

interface SizeClass {
  cellM: number;
  /** Expected rocks per m² on average ground. */
  density: number;
  minM: number;
  maxM: number;
  /** Power-law exponent of the cumulative size distribution. */
  alpha: number;
  salt: number;
}

export const CLASSES: SizeClass[] = [
  { cellM: 4, density: 0.55, minM: 0.06, maxM: 0.4, alpha: 2.5, salt: 0x9e37 },
  { cellM: 24, density: 0.009, minM: 0.4, maxM: 1.7, alpha: 2.1, salt: 0x51ed },
];
const VARIANTS = 6;

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

/** Rocks of one size class in one cell (indices of the cell on its grid). */
export function rocksInCell(i: number, j: number, cls: SizeClass, ground: GroundInfo): Rock[] {
  const rand = mulberry32(cellSeed(i, j, cls.salt));
  const cx = (i + 0.5) * cls.cellM;
  const cn = (j + 0.5) * cls.cellM;
  const bright = ground.brightness(cx, cn);
  const slope = ground.slope(cx, cn);
  // Local density: sand has few rocks, bedrock and slopes many; a cluster factor varies it.
  const cluster = 0.35 + 1.3 * rand();
  const terrain =
    Math.min(2.5, 0.45 + 1.4 * Math.max(0, bright - 0.3) + 4 * slope) *
    (1 + 1.3 * (ground.rockiness?.(cx, cn) ?? 0));
  const expected = cls.density * cls.cellM * cls.cellM * terrain * cluster;
  // Poisson sample.
  let count = 0;
  for (let p = Math.exp(-expected), s = p, u = rand(); u > s && count < 60;) {
    count++;
    p *= expected / count;
    s += p;
  }
  const out: Rock[] = [];
  const a = cls.alpha;
  const ratio = (cls.minM / cls.maxM) ** a;
  for (let k = 0; k < count; k++) {
    const x = cx + (rand() - 0.5) * cls.cellM;
    const north = cn + (rand() - 0.5) * cls.cellM;
    // Inverse CDF of a truncated power law.
    const d = cls.minM * (1 - rand() * (1 - ratio)) ** (-1 / a);
    const slab = rand() < 0.35 + 0.4 * Math.max(0, bright - 0.5);
    const sx = (d / 2) * (0.8 + 0.5 * rand());
    const sz = (d / 2) * (0.8 + 0.5 * rand());
    const sy = (d / 2) * (slab ? 0.3 + 0.2 * rand() : 0.55 + 0.4 * rand());
    const sink = sy * (0.25 + 0.25 * rand());
    out.push({
      x,
      north,
      y: ground.height(x, north) - sink,
      sx,
      sy,
      sz,
      rotY: rand() * Math.PI * 2,
      tiltX: (rand() - 0.5) * 0.5,
      tiltZ: (rand() - 0.5) * 0.5,
      variant: Math.floor(rand() * VARIANTS),
      tone: rand(),
      dark: rand() < 0.32,
      topM: sy - sink,
      radiusM: 0.85 * Math.min(sx, sz),
    });
  }
  return out;
}

/** Rock geometry variants: noise-displaced icosahedra, flattened underneath. */
function rockGeometry(seed: number, detail: number): BufferGeometry {
  const g = new IcosahedronGeometry(1, detail);
  const rand = mulberry32(seed * 7919 + 13);
  // A few random lobes and facets (plane cuts) per variant.
  const lobes = Array.from({ length: 7 }, () =>
    new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize().multiplyScalar(1),
  );
  const cuts = Array.from({ length: 4 }, () => ({
    n: new Vector3(rand() - 0.5, rand() * 0.6, rand() - 0.5).normalize(),
    d: 0.55 + 0.3 * rand(),
  }));
  const p = g.getAttribute('position');
  const v = new Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    let r = 1;
    for (const l of lobes) r += 0.12 * Math.max(0, v.dot(l)) ** 3;
    const s = Math.sin(v.x * 9 + seed) * Math.sin(v.y * 11 - seed) * Math.sin(v.z * 7 + 2 * seed);
    r += 0.05 * s;
    v.multiplyScalar(r);
    for (const c of cuts) {
      const over = v.dot(c.n) - c.d;
      if (over > 0) v.addScaledVector(c.n, -over * 0.9);
    }
    if (v.y < -0.35) v.y = -0.35 + (v.y + 0.35) * 0.3;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Rocks around the camera, one instanced mesh per variant and level of detail. */
export class RockField {
  private readonly meshes: InstancedMesh[] = [];
  private readonly far: InstancedMesh[] = [];
  private readonly cache = new Map<string, Rock[]>();
  private lastX = Infinity;
  private lastN = Infinity;
  readonly group: InstancedMesh[] = [];
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly e = new Euler();
  private readonly s = new Vector3();
  private readonly t = new Vector3();
  private readonly c = new Color();

  constructor(
    private readonly ground: GroundInfo,
    texture: DataArrayTexture,
    private readonly radii: [number, number] = [45, 260],
  ) {
    const material = new MeshStandardMaterial({ roughness: 0.88, metalness: 0 });
    material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.tGround = { value: texture };
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vRockP;\nvarying vec3 vRockN;',
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           vRockP = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
           vRockN = normalize(mat3(modelMatrix * instanceMatrix) * normal);`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           precision highp sampler2DArray;
           uniform sampler2DArray tGround;
           varying vec3 vRockP;
           varying vec3 vRockN;`,
        )
        .replace(
          '#include <map_fragment>',
          `{
             // Triplanar bedrock photo (layer 3), a darker rock body, dust settled on top.
             vec3 bw = pow(abs(vRockN), vec3(4.0));
             bw /= bw.x + bw.y + bw.z;
             float sc = 1.0 / 0.9;
             vec3 tx = texture(tGround, vec3(vRockP.zy * sc, 3.0)).rgb;
             vec3 ty = texture(tGround, vec3(vRockP.xz * sc, 3.0)).rgb;
             vec3 tz = texture(tGround, vec3(vRockP.xy * sc, 3.0)).rgb;
             vec3 tex = tx * bw.x + ty * bw.y + tz * bw.z;
             float lum = dot(tex, vec3(0.3, 0.59, 0.11));
             vec3 rock = mix(vec3(lum) * vec3(0.95, 0.82, 0.72), tex, 0.45) * diffuseColor.rgb;
             vec3 dust = vec3(0.42, 0.24, 0.13);
             float top = smoothstep(0.35, 0.9, vRockN.y);
             diffuseColor.rgb = mix(rock, dust * (0.8 + 0.4 * lum), top * 0.75);
           }`,
        );
    };
    material.customProgramCacheKey = () => 'copernico-rock';
    for (let v = 0; v < VARIANTS; v++) {
      for (const [list, detail, max] of [
        [this.meshes, 3, 1400],
        [this.far, 1, 900],
      ] as const) {
        const mesh = new InstancedMesh(rockGeometry(v, detail), material, max);
        mesh.instanceMatrix.setUsage(DynamicDrawUsage);
        mesh.count = 0;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        list.push(mesh);
        this.group.push(mesh);
      }
    }
  }

  private cell(ci: number, i: number, j: number): Rock[] {
    const key = `${ci}:${i}:${j}`;
    let rocks = this.cache.get(key);
    if (!rocks) {
      rocks = rocksInCell(i, j, CLASSES[ci]!, this.ground);
      this.cache.set(key, rocks);
      if (this.cache.size > 20000) this.cache.delete(this.cache.keys().next().value!);
    }
    return rocks;
  }

  /** Rocks of all classes near a point (for the physics). */
  near(x: number, north: number, radiusM: number, out: Rock[] = []): Rock[] {
    out.length = 0;
    for (const [ci, cls] of CLASSES.entries()) {
      const r = Math.ceil((radiusM + cls.maxM) / cls.cellM);
      const i0 = Math.floor(x / cls.cellM);
      const j0 = Math.floor(north / cls.cellM);
      for (let i = i0 - r; i <= i0 + r; i++)
        for (let j = j0 - r; j <= j0 + r; j++)
          for (const rock of this.cell(ci, i, j)) out.push(rock);
    }
    return out;
  }

  /** Height of the rock surface above the terrain at a point (0 off rocks). */
  rockLift(x: number, north: number): number {
    let lift = 0;
    for (const [ci, cls] of CLASSES.entries()) {
      const i0 = Math.floor(x / cls.cellM);
      const j0 = Math.floor(north / cls.cellM);
      // Footprints are smaller than a cell: the neighbouring cells hold every rock that can reach here.
      for (let i = i0 - 1; i <= i0 + 1; i++)
        for (let j = j0 - 1; j <= j0 + 1; j++)
          for (const rock of this.cell(ci, i, j)) {
            const d2 = (rock.x - x) ** 2 + (rock.north - north) ** 2;
            const rr = rock.radiusM * rock.radiusM;
            if (d2 >= rr) continue;
            const h = rock.topM * Math.sqrt(1 - d2 / rr);
            if (h > lift) lift = h;
          }
    }
    return lift;
  }

  /** Rebuilds the instances when the camera has moved a few metres. */
  update(camX: number, camNorth: number, force = false): void {
    if (!force && Math.hypot(camX - this.lastX, camNorth - this.lastN) < 3) return;
    this.lastX = camX;
    this.lastN = camNorth;
    const counts = new Array(this.group.length).fill(0) as number[];
    for (const [ci, cls] of CLASSES.entries()) {
      const radius = this.radii[ci]!;
      const r = Math.ceil(radius / cls.cellM);
      const i0 = Math.floor(camX / cls.cellM);
      const j0 = Math.floor(camNorth / cls.cellM);
      for (let i = i0 - r; i <= i0 + r; i++)
        for (let j = j0 - r; j <= j0 + r; j++) {
          for (const rock of this.cell(ci, i, j)) {
            const d = Math.hypot(rock.x - camX, rock.north - camNorth);
            if (d > radius) continue;
            // Small rocks: detailed only nearby; boulders detailed within 90 m.
            const nearRange = ci === 0 ? 25 : 90;
            const list = d < nearRange ? this.meshes : this.far;
            const mesh = list[rock.variant]!;
            const k = this.group.indexOf(mesh);
            if (counts[k]! >= mesh.instanceMatrix.count) continue;
            this.e.set(rock.tiltX, rock.rotY, rock.tiltZ, 'YXZ');
            this.q.setFromEuler(this.e);
            this.s.set(rock.sx, rock.sy, rock.sz);
            this.t.set(rock.x, rock.y, -rock.north);
            this.m.compose(this.t, this.q, this.s);
            mesh.setMatrixAt(counts[k]!, this.m);
            const v = (rock.dark ? 0.42 : 0.75) + (rock.dark ? 0.2 : 0.45) * rock.tone;
            if (rock.dark) this.c.setRGB(v * 0.92, v * 0.9, v * 0.9);
            else this.c.setRGB(v, v * (0.96 + 0.06 * rock.tone), v * 0.94);
            mesh.setColorAt(counts[k]!, this.c);
            counts[k]!++;
          }
        }
    }
    for (const [k, mesh] of this.group.entries()) {
      mesh.count = counts[k]!;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const m of this.group) m.geometry.dispose();
    (this.group[0]?.material as MeshStandardMaterial | undefined)?.dispose();
  }
}
