import type { Color, DataArrayTexture } from 'three';
import {
  Box3,
  BufferAttribute,
  DataTexture,
  FloatType,
  Frustum,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  NearestFilter,
  RedFormat,
  Sphere,
  Vector3,
  type PerspectiveCamera,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { DETAIL_RAMP_M, MID_RAMP_M, type HeightLayer, type Terrain } from './heights';

/**
 * Terrain renderer: CDLOD (continuous distance-dependent level of detail, Strugar 2010). One
 * 32×32 grid patch, instanced per selected quadtree node; heights come from the three layers in
 * vertex textures (detail sampled bicubically as in heights.ts), and vertices morph towards the
 * next coarser grid with distance, so levels meet without cracks or popping.
 *
 * Colour: four real ground textures (Mastcam-Z panoramas re-projected onto the ground) mixed by
 * slope and by the orbital brightness (HiRISE where the rover drives, CTX beyond), sampled twice
 * with per-region offsets to hide their repetition; the orbital image also modulates them, so the
 * real large-scale pattern (dark sand, bright bedrock) shows through.
 */

const N = 32; // quads per patch side
const LEAF_M = 8; // finest patch: 0.25 m spacing
const LEVELS = 14; // root 8·2^13 = 65 536 m covers the far layer
const RANGE = 2.2; // a level is drawn up to RANGE × its patch size
const MAX_PATCHES = 1200;

function heightTexture(l: HeightLayer): DataTexture {
  const t = new DataTexture(l.data, l.cols, l.rows, RedFormat, FloatType);
  t.magFilter = NearestFilter;
  t.minFilter = NearestFilter;
  t.needsUpdate = true;
  return t;
}

export interface GroundTextures {
  albedo: DataArrayTexture;
  normal: DataArrayTexture;
  /** 1 / tile size (m) per layer: regolith, gravel, sand, bedrock. */
  scale: [number, number, number, number];
  /** Mean colour per layer (linear), used where the detail fades out with distance. */
  mean: Color[];
}

export interface MacroAlbedo {
  detail: DataTexture;
  mid: DataTexture;
  far: DataTexture;
}

const GLSL_COMMON = /* glsl */ `
  uniform sampler2D tHDetail;
  uniform sampler2D tHMid;
  uniform sampler2D tHFar;
  uniform vec3 uDetailInfo; // width, height, cell (m)
  uniform vec3 uMidInfo;
  uniform vec3 uFarInfo;

  vec2 gridOf(vec3 info, vec2 p) {
    return vec2((p.x + info.x * 0.5) / info.z - 0.5, (info.y * 0.5 - p.y) / info.z - 0.5);
  }
  float edgeW(vec3 info, vec2 p, float ramp) {
    float d = min(info.x * 0.5 - abs(p.x), info.y * 0.5 - abs(p.y)) - info.z;
    return smoothstep(0.0, 1.0, clamp(d / ramp, 0.0, 1.0));
  }
`;

const GLSL_HEIGHT = /* glsl */ `
  ${GLSL_COMMON}
  float hFetch(sampler2D t, ivec2 c) {
    ivec2 s = textureSize(t, 0);
    return texelFetch(t, clamp(c, ivec2(0), s - 1), 0).r;
  }
  float hBilinear(sampler2D t, vec3 info, vec2 p) {
    vec2 g = gridOf(info, p);
    vec2 f = fract(g);
    ivec2 c = ivec2(floor(g));
    float a = hFetch(t, c), b = hFetch(t, c + ivec2(1, 0));
    float d = hFetch(t, c + ivec2(0, 1)), e = hFetch(t, c + ivec2(1, 1));
    return mix(mix(a, b, f.x), mix(d, e, f.x), f.y);
  }
  vec4 catmull(float t) {
    float t2 = t * t, t3 = t2 * t;
    return vec4(-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1.0,
                -1.5 * t3 + 2.0 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2);
  }
  float hBicubic(sampler2D t, vec3 info, vec2 p) {
    vec2 g = gridOf(info, p);
    ivec2 c = ivec2(floor(g));
    vec4 wc = catmull(fract(g).x), wr = catmull(fract(g).y);
    float h = 0.0;
    for (int j = 0; j < 4; j++) {
      vec4 row = vec4(hFetch(t, c + ivec2(-1, j - 1)), hFetch(t, c + ivec2(0, j - 1)),
                      hFetch(t, c + ivec2(1, j - 1)), hFetch(t, c + ivec2(2, j - 1)));
      h += wr[j] * dot(wc, row);
    }
    return h;
  }
  float terrainH(vec2 p) {
    float h = hBilinear(tHFar, uFarInfo, p);
    float wm = edgeW(uMidInfo, p, ${MID_RAMP_M.toFixed(1)});
    if (wm > 0.0) h = mix(h, hBilinear(tHMid, uMidInfo, p), wm);
    float wd = edgeW(uDetailInfo, p, ${DETAIL_RAMP_M.toFixed(1)});
    if (wd > 0.0) h = mix(h, hBicubic(tHDetail, uDetailInfo, p), wd);
    return h;
  }
`;

const VERTEX_PARS = /* glsl */ `
  attribute vec2 grid;
  attribute vec4 node; // x, north of the patch's south-west corner, size (m), level
  uniform vec3 uCam; // camera x, north, height
  varying vec2 vP;
  varying float vSpacing;
  varying vec3 vWorldN;
  ${GLSL_HEIGHT}
`;

const VERTEX_MAIN = /* glsl */ `
  vec2 local = grid / ${N.toFixed(1)};
  vec2 p = node.xy + local * node.z;
  // Morph towards the next coarser grid as the vertex nears the end of this level's range.
  float range = node.z * ${RANGE.toFixed(2)};
  float h0 = terrainH(p);
  float dist = length(vec3(p - uCam.xy, h0 - uCam.z));
  float k = clamp((dist - range * 0.55) / (range * 0.4), 0.0, 1.0);
  p -= fract(grid * 0.5) * 2.0 / ${N.toFixed(1)} * node.z * k;
  float h = terrainH(p);
  float e = max(node.z / ${N.toFixed(1)}, 0.5);
  float hx = terrainH(p + vec2(e, 0.0)) - terrainH(p - vec2(e, 0.0));
  float hn = terrainH(p + vec2(0.0, e)) - terrainH(p - vec2(0.0, e));
  vec3 objectNormal = normalize(vec3(-hx, 2.0 * e, hn));
  vP = p;
  vSpacing = node.z / ${N.toFixed(1)};
  vWorldN = objectNormal;
  vec3 terrainPos = vec3(p.x, h, -p.y);
`;

const FRAGMENT_PARS = /* glsl */ `
  ${GLSL_COMMON}
  precision highp sampler2DArray;
  uniform sampler2DArray tGround;
  uniform sampler2DArray tGroundN;
  uniform vec4 uGroundScale;
  uniform vec3 uGroundMean[4];
  uniform sampler2D tADetail;
  uniform sampler2D tAMid;
  uniform sampler2D tAFar;
  uniform vec3 uCamW;
  varying vec2 vP;
  varying float vSpacing;
  varying vec3 vWorldN;

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x),
               mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
  }
  vec2 uvOf(vec3 info, vec2 p) {
    return vec2((p.x + info.x * 0.5) / info.x, (info.y * 0.5 - p.y) / info.y);
  }
  /** Orbital brightness 0..1 (HiRISE near, CTX beyond), blended like the heights. */
  float macroLum(vec2 p) {
    float m = texture(tAFar, uvOf(uFarInfo, p)).r;
    float wm = edgeW(uMidInfo, p, ${MID_RAMP_M.toFixed(1)});
    if (wm > 0.0) m = mix(m, texture(tAMid, uvOf(uMidInfo, p)).r, wm);
    float wd = edgeW(uDetailInfo, p, ${DETAIL_RAMP_M.toFixed(1)});
    if (wd > 0.0) m = mix(m, texture(tADetail, uvOf(uDetailInfo, p)).r, wd);
    return m;
  }
  /** Two lookups with per-region offsets (after I. Quilez, "texture repetition"), same offsets
   *  for colour and normal. */
  void untiled(float layer, vec2 uv, vec2 dx, vec2 dy, float n, out vec3 col, out vec3 nrm) {
    float kk = n * 8.0;
    float i = floor(kk);
    float f = fract(kk);
    vec2 oa = sin(vec2(3.0, 7.0) * i);
    vec2 ob = sin(vec2(3.0, 7.0) * (i + 1.0));
    vec3 ca = textureGrad(tGround, vec3(uv + oa, layer), dx, dy).rgb;
    vec3 cb = textureGrad(tGround, vec3(uv + ob, layer), dx, dy).rgb;
    float t = smoothstep(0.2, 0.8, f - 0.1 * (ca.r + ca.g + ca.b - cb.r - cb.g - cb.b));
    col = mix(ca, cb, t);
    vec3 na = textureGrad(tGroundN, vec3(uv + oa, layer), dx, dy).xyz * 2.0 - 1.0;
    vec3 nb = textureGrad(tGroundN, vec3(uv + ob, layer), dx, dy).xyz * 2.0 - 1.0;
    nrm = normalize(mix(na, nb, t));
  }
  vec3 gDetailNormal = vec3(0.0, 0.0, 1.0);
`;

/** Replaces the standard material's colour with the layered ground. */
const FRAGMENT_COLOR = /* glsl */ `
  float viewDist = length(vec3(vP.x, 0.0, -vP.y) - vec3(uCamW.x, 0.0, uCamW.z));
  // Texture coordinates: x east, y south (images are north-up). Derivatives taken here, in
  // uniform control flow, before the per-layer branches.
  vec2 gUv = vec2(vP.x, -vP.y);
  vec2 gDx = dFdx(gUv), gDy = dFdy(gUv);
  float m = macroLum(vP);
  float slope = 1.0 - clamp(vWorldN.y, 0.0, 1.0);
  float n1 = vnoise(vP * 0.045);
  float n2 = vnoise(vP * 0.37 + 17.0);
  float n3 = vnoise(vP * 0.9 - 5.0);
  // Mix: sand in dark, flat places; bedrock on slopes and bright outcrops; gravel in patches.
  float wSand = smoothstep(0.42, 0.22, m + 0.22 * (n1 - 0.5)) * (1.0 - smoothstep(0.06, 0.16, slope));
  float wBed = max(smoothstep(0.10, 0.28, slope), smoothstep(0.66, 0.86, m + 0.25 * (n1 - 0.5)));
  float wGravel = smoothstep(0.5, 0.75, n2) * (1.0 - wSand);
  float wReg = 1.0;
  vec4 w = vec4(wReg, wGravel, wSand, wBed);
  w = w * w;
  w /= dot(w, vec4(1.0));
  // Orbital modulation: the real large-scale light and dark pattern.
  float orb = mix(1.0, 0.62 + 0.76 * m, 0.7);
  vec3 meanCol = uGroundMean[0] * w.x + uGroundMean[1] * w.y + uGroundMean[2] * w.z + uGroundMean[3] * w.w;
  float fade = 1.0 - smoothstep(90.0, 320.0, viewDist);
  vec3 groundCol = meanCol;
  if (fade > 0.0) {
    vec3 c, nn, acc = vec3(0.0), nacc = vec3(0.0);
    // Offset regions (~1 m) smaller than a tile, so no tile repeats whole.
    float noiseSel = vnoise(vP * 0.9) * 0.7 + vnoise(vP * 0.17) * 0.3;
    for (int i = 0; i < 4; i++) {
      if (w[i] < 0.02) continue;
      float sc = uGroundScale[i];
      untiled(float(i), gUv * sc, gDx * sc, gDy * sc, noiseSel + float(i) * 0.37, c, nn);
      // A second, larger and rotated copy (colour only) breaks the remaining periodicity.
      vec2 uv2 = mat2(0.8, -0.6, 0.6, 0.8) * gUv * sc * 0.41;
      vec2 dx2 = mat2(0.8, -0.6, 0.6, 0.8) * gDx * sc * 0.41;
      vec2 dy2 = mat2(0.8, -0.6, 0.6, 0.8) * gDy * sc * 0.41;
      vec3 c2 = textureGrad(tGround, vec3(uv2 + 0.37, float(i)), dx2, dy2).rgb;
      vec3 mu = uGroundMean[i];
      c = mu + ((c - mu) + (c2 - mu)) * 0.72;
      acc += c * w[i];
      nacc += nn * w[i];
    }
    groundCol = mix(meanCol, acc, fade);
    gDetailNormal = normalize(mix(vec3(0.0, 0.0, 1.0), nacc, fade));
  }
  // Fine dust variation in small patches.
  groundCol *= 0.92 + 0.16 * n3;
  diffuseColor.rgb = groundCol * orb;
`;

/** Perturbs the (view-space) normal with the ground textures' detail normals. */
const FRAGMENT_NORMAL = /* glsl */ `
  {
    vec3 tE = normalize((viewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
    vec3 tN = normalize((viewMatrix * vec4(0.0, 0.0, -1.0, 0.0)).xyz);
    tE = normalize(tE - normal * dot(normal, tE));
    tN = normalize(cross(normal, tE));
    normal = normalize(tE * gDetailNormal.x + tN * gDetailNormal.y + normal * gDetailNormal.z);
  }
`;

export class TerrainMesh {
  readonly mesh: Mesh;
  private readonly geometry: InstancedBufferGeometry;
  private readonly nodes: Float32Array;
  private readonly nodeAttr: InstancedBufferAttribute;
  private readonly uniforms: Record<string, { value: unknown }>;
  private readonly frustum = new Frustum();
  private readonly box = new Box3();
  private readonly sphere = new Sphere();
  private readonly projScreen = new Matrix4();
  private readonly minH: number;
  private readonly maxH: number;
  private count = 0;

  constructor(terrain: Terrain, ground: GroundTextures, macro: MacroAlbedo) {
    // One N×N patch; positions are computed in the vertex shader.
    const g = new InstancedBufferGeometry();
    const grid = new Float32Array((N + 1) * (N + 1) * 2);
    for (let j = 0, k = 0; j <= N; j++)
      for (let i = 0; i <= N; i++, k += 2) {
        grid[k] = i;
        grid[k + 1] = j;
      }
    const index: number[] = [];
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const a = j * (N + 1) + i;
        const b = a + 1;
        const c = a + N + 1;
        const d = c + 1;
        // Alternate the diagonal so the mesh has no directional bias.
        if ((i + j) % 2 === 0) index.push(a, b, d, a, d, c);
        else index.push(a, b, c, b, d, c);
      }
    g.setIndex(index);
    g.setAttribute('grid', new BufferAttribute(grid, 2));
    // three needs a position attribute for its bookkeeping; the shader ignores it.
    g.setAttribute('position', new BufferAttribute(new Float32Array((N + 1) * (N + 1) * 3), 3));
    this.nodes = new Float32Array(MAX_PATCHES * 4);
    this.nodeAttr = new InstancedBufferAttribute(this.nodes, 4);
    this.nodeAttr.setUsage(35048); // DYNAMIC_DRAW
    g.setAttribute('node', this.nodeAttr);
    g.instanceCount = 0;
    this.geometry = g;

    const info = (l: HeightLayer) => new Vector3(l.widthM, l.heightM, l.cellM);
    this.uniforms = {
      tHDetail: { value: heightTexture(terrain.detail) },
      tHMid: { value: heightTexture(terrain.mid) },
      tHFar: { value: heightTexture(terrain.far) },
      uDetailInfo: { value: info(terrain.detail) },
      uMidInfo: { value: info(terrain.mid) },
      uFarInfo: { value: info(terrain.far) },
      uCam: { value: new Vector3() },
      uCamW: { value: new Vector3() },
      tGround: { value: ground.albedo },
      tGroundN: { value: ground.normal },
      uGroundScale: { value: ground.scale },
      uGroundMean: { value: ground.mean.map((c) => new Vector3(c.r, c.g, c.b)) },
      tADetail: { value: macro.detail },
      tAMid: { value: macro.mid },
      tAFar: { value: macro.far },
    };
    for (const t of [macro.detail, macro.mid, macro.far]) {
      t.minFilter = LinearMipmapLinearFilter;
      t.magFilter = LinearFilter;
    }

    const material = new MeshStandardMaterial({ roughness: 0.96, metalness: 0 });
    material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
        .replace('#include <beginnormal_vertex>', VERTEX_MAIN)
        .replace('#include <begin_vertex>', 'vec3 transformed = terrainPos;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
        .replace('#include <map_fragment>', FRAGMENT_COLOR)
        .replace('#include <normal_fragment_maps>', FRAGMENT_NORMAL);
    };
    material.customProgramCacheKey = () => 'copernico-terrain';

    this.mesh = new Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of terrain.far.data) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    this.minH = lo - 50;
    this.maxH = hi + 50;
  }

  /** Selects the patches for this camera (call before rendering each frame). */
  update(camera: PerspectiveCamera): void {
    const cam = camera.position;
    (this.uniforms.uCam!.value as Vector3).set(cam.x, -cam.z, cam.y);
    (this.uniforms.uCamW!.value as Vector3).copy(cam);
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    this.count = 0;
    const root = LEAF_M * 2 ** (LEVELS - 1);
    this.select(-root / 2, -root / 2, root, LEVELS - 1, cam);
    this.geometry.instanceCount = this.count;
    this.nodeAttr.clearUpdateRanges();
    this.nodeAttr.addUpdateRange(0, this.count * 4);
    this.nodeAttr.needsUpdate = true;
  }

  get patchCount(): number {
    return this.count;
  }

  /** Distance from the camera to a patch's box (x east, north, size). */
  private distance(x: number, n: number, size: number, cam: Vector3): number {
    const cx = Math.max(x, Math.min(cam.x, x + size));
    const cn = Math.max(n, Math.min(-cam.z, n + size));
    const cy = Math.max(this.minH, Math.min(cam.y, this.maxH));
    return Math.hypot(cam.x - cx, -cam.z - cn, cam.y - cy);
  }

  private select(x: number, n: number, size: number, level: number, cam: Vector3): void {
    this.box.min.set(x, this.minH, -(n + size));
    this.box.max.set(x + size, this.maxH, -n);
    if (!this.frustum.intersectsBox(this.box)) return;
    const finerRange = (size / 2) * RANGE;
    if (level === 0 || this.distance(x, n, size, cam) > finerRange) {
      if (this.count >= MAX_PATCHES) return;
      this.nodes.set([x, n, size, level], this.count * 4);
      this.count++;
      return;
    }
    const h = size / 2;
    this.select(x, n, h, level - 1, cam);
    this.select(x + h, n, h, level - 1, cam);
    this.select(x, n + h, h, level - 1, cam);
    this.select(x + h, n + h, h, level - 1, cam);
  }

  dispose(): void {
    this.geometry.dispose();
    (this.mesh.material as MeshStandardMaterial).dispose();
    for (const k of ['tHDetail', 'tHMid', 'tHFar', 'tADetail', 'tAMid', 'tAFar'])
      (this.uniforms[k]!.value as DataTexture).dispose();
    void this.sphere;
  }
}
