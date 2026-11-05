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
  Vector2,
  Vector3,
  Vector4,
  type PerspectiveCamera,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { GLSL_MICRO } from './features';
import { DETAIL_RAMP_M, MID_RAMP_M, type HeightLayer, type Terrain } from './heights';
import { GLSL_SUN_VIS, type SunShadows } from './sunShadow';

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
 *
 * Generated detail on top (TERRAIN_FX, off on low quality):
 * - Near the camera: Jezero's polygonal fractured bedrock slabs, and wind ripples in the sand.
 * - On distant slopes: rugged relief shading.
 * - On slopes at any distance: layering.
 * Heights also gain generated relief: the micro-relief (features.ts) near the camera, and ridged
 * relief on the real slopes outside the 1 m model only.
 */

const N = 32; // quads per patch side
const LEAF_M = 8; // finest patch: 0.25 m spacing
const LEVELS = 14; // root 8·2^13 = 65 536 m covers the far layer
// A level is drawn up to RANGE × its patch size. RANGE must exceed 2√2 (≈2.83): below that, a
// patch can border one two levels coarser, a T-junction the morph cannot close, and the sky shows
// through hairline cracks along the patch edges (dotted bright lines across the ground). Low
// quality keeps the cheaper 2.2 (about 40 % fewer patches, no second morph): software and weak GPUs
// are vertex-bound here, and accept the odd crack.
const RANGE = 3.0;
const RANGE_LOW = 2.2;
const MAX_PATCHES = 1200;
/** Firm aprons (no sand drifts) around the sample sites, mission starts and the depot. */
export const MAX_CLEAR = 32;
export const CLEAR_INNER_M = 18;
export const CLEAR_OUTER_M = 40;

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
  /** Native 25 cm imagery over the core of the area (a square around its centre), if any. */
  core?: { texture: DataTexture; widthM: number; heightM: number; cellM: number };
}

/**
 * The ground textures are Perseverance's own photos: Mars's light is already in their colours.
 * Lit again by the game's warm Sun and sky they came out too red and dark, so their colour is
 * divided by that light first (a white balance), measured against the same panorama.
 */
export const GROUND_WB: [number, number, number] = [1, 1.5, 3.0];

/** Width of the blend from the core imagery into the 0.5 m layer at its edge (m). */
const CORE_RAMP_M = 30;

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
  ${GLSL_MICRO}
  /** Ridged relief (m) on the real slopes; octaves kept while the mesh can resolve them. */
  float mountainRelief(vec2 p) {
    float gx = hBilinear(tHFar, uFarInfo, p + vec2(150.0, 0.0)) - hBilinear(tHFar, uFarInfo, p - vec2(150.0, 0.0));
    float gy = hBilinear(tHFar, uFarInfo, p + vec2(0.0, 150.0)) - hBilinear(tHFar, uFarInfo, p - vec2(0.0, 150.0));
    float relief = 3.0 + 120.0 * smoothstep(0.02, 0.35, length(vec2(gx, gy)) / 300.0);
    float d = max(length(p - uCam.xy), 1.0);
    float h = 0.0, amp = 0.5, lambda = 1400.0;
    for (int i = 0; i < 5; i++) {
      // The coarsest mesh drawn at distance d has about d/35 m between vertices.
      float w = smoothstep(3.0, 7.0, lambda * 35.0 / d);
      if (w > 0.0) h += amp * w * (0.5 - abs(valueNoiseI(p / lambda + vec2(float(i) * 7.3, 3.1))));
      amp *= 0.5;
      lambda *= 0.42;
    }
    return h * relief;
  }
  float terrainH(vec2 p) {
    float h = hBilinear(tHFar, uFarInfo, p);
    float wm = edgeW(uMidInfo, p, ${MID_RAMP_M.toFixed(1)});
    if (wm > 0.0) h = mix(h, hBilinear(tHMid, uMidInfo, p), wm);
    float wd = edgeW(uDetailInfo, p, ${DETAIL_RAMP_M.toFixed(1)});
    if (wd > 0.0) {
      h = mix(h, hBicubic(tHDetail, uDetailInfo, p), wd);
      // Micro-relief. Its octaves fade where the mesh gets too coarse. The fade depends on
      // distance, not on level, so it is the same for every level and neighbouring levels meet.
      float d = length(p - uCam.xy);
      vec2 fade = vec2(1.0 - smoothstep(30.0, 55.0, d), 1.0 - smoothstep(12.0, 28.0, d));
      h += microRelief(p, fade) * wd;
    }
    // Outside the 1 m model only (the rover never drives there).
    float dOut = max(abs(p.x) - uDetailInfo.x * 0.5, abs(p.y) - uDetailInfo.y * 0.5);
    if (dOut > 0.0) h += mountainRelief(p) * smoothstep(0.0, 500.0, dOut);
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
  varying float vH;
  ${GLSL_HEIGHT}
`;

const VERTEX_MAIN = /* glsl */ `
  vec2 local = grid / ${N.toFixed(1)};
  vec2 p = node.xy + local * node.z;
  // Morph towards the next coarser grid as the vertex nears the end of this level's range.
  float range = node.z * TERRAIN_RANGE;
  float h0 = terrainH(p);
  float dist = length(vec3(p - uCam.xy, h0 - uCam.z));
  float k = clamp((dist - range * 0.55) / (range * 0.4), 0.0, 1.0);
  p -= fract(grid * 0.5) * 2.0 / ${N.toFixed(1)} * node.z * k;
  // Where this patch is fully morphed it sits on the next level's grid, and borders patches of that
  // level, which may themselves be morphing on towards the level after. Follow their morph too
  // (same rule, same distance), or the shared edge opens into hairline cracks there.
#if TERRAIN_SEAMLESS
  if (k >= 1.0) {
    float range2 = range * 2.0;
    if (length(vec3(p - uCam.xy, h0 - uCam.z)) > range2 * 0.5) {
      float h1 = terrainH(p);
      float k2 = clamp((length(vec3(p - uCam.xy, h1 - uCam.z)) - range2 * 0.55) / (range2 * 0.4), 0.0, 1.0);
      if (k2 > 0.0) {
        float g2 = node.z * 2.0 / ${N.toFixed(1)};
        vec2 idx = floor((p + ${(LEAF_M * 2 ** (LEVELS - 2)).toFixed(1)}) / g2 + 0.5);
        p -= mod(idx, 2.0) * g2 * k2;
      }
    }
  }
#endif
  float h = terrainH(p);
  float e = max(node.z / ${N.toFixed(1)}, 0.25);
  float hx = terrainH(p + vec2(e, 0.0)) - terrainH(p - vec2(e, 0.0));
  float hn = terrainH(p + vec2(0.0, e)) - terrainH(p - vec2(0.0, e));
  vec3 objectNormal = normalize(vec3(-hx, 2.0 * e, hn));
  vP = p;
  vSpacing = node.z / ${N.toFixed(1)};
  vWorldN = objectNormal;
  vH = h;
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
  uniform sampler2D tACore;
  uniform vec3 uCoreInfo;
  uniform float uCoreOn;
  uniform vec3 uCamW;
  /** White balance of the ground photos (their colour divided by the game's light). */
  uniform vec3 uWB;
  /** Firm ground around the sample sites, starts and depot (no sand drifts): x, north. */
  uniform vec2 uClear[${MAX_CLEAR}];
  uniform int uClearCount;
  /** The rover over the ground: x, north, heading (rad), on; and its six wheel contacts. */
  uniform vec4 uRoverAO;
  uniform vec2 uWheelAO[6];
  varying vec2 vP;
  varying float vSpacing;
  varying vec3 vWorldN;
  varying float vH;

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
    if (uCoreOn > 0.5) {
      float wc = edgeW(uCoreInfo, p, ${CORE_RAMP_M.toFixed(1)});
      if (wc > 0.0) m = mix(m, texture(tACore, uvOf(uCoreInfo, p)).r, wc);
    }
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
  float gSunVis = 1.0;
  ${GLSL_SUN_VIS}

  vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
  }
  /** Value noise in [-1, 1] and its derivatives (after I. Quilez). */
  vec3 noised(vec2 x) {
    vec2 i = floor(x), f = fract(x);
    vec2 u = f * f * (3.0 - 2.0 * f), du = 6.0 * f * (1.0 - f);
    float a = hash12(i), b = hash12(i + vec2(1, 0)), c = hash12(i + vec2(0, 1)), d = hash12(i + vec2(1, 1));
    float k = a - b - c + d;
    return vec3(a + (b - a) * u.x + (c - a) * u.y + k * u.x * u.y,
                du * (vec2(b - a, c - a) + k * u.yx)) * 2.0 - vec3(1.0, 0.0, 0.0);
  }
  /** Voronoi cells with the exact border distance (after I. Quilez).
   *  Returns x = distance to the nearest border, yz = unit direction from that border into the
   *  cell, w = the cell's hash. */
  vec4 slabs(vec2 x) {
    vec2 n = floor(x), f = x - n;
    vec2 mg = vec2(0.0), mr = vec2(0.0);
    float md = 8.0;
    for (int j = -1; j <= 1; j++)
      for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(float(i), float(j));
        vec2 r = g + hash22(n + g) * 0.8 + 0.1 - f;
        float d = dot(r, r);
        if (d < md) { md = d; mr = r; mg = g; }
      }
    md = 8.0;
    vec2 dir = vec2(0.0, 1.0);
    for (int j = -2; j <= 2; j++)
      for (int i = -2; i <= 2; i++) {
        vec2 g = mg + vec2(float(i), float(j));
        vec2 r = g + hash22(n + g) * 0.8 + 0.1 - f;
        vec2 dr = r - mr;
        if (dot(dr, dr) > 1e-5) {
          vec2 nb = normalize(dr);
          float d = dot(0.5 * (mr + r), nb);
          if (d < md) { md = d; dir = -nb; }
        }
      }
    return vec4(md, dir, hash12(n + mg + 0.5));
  }
`;

/** Replaces the standard material's colour with the layered ground. */
const FRAGMENT_COLOR = /* glsl */ `
  float viewDist = length(vec3(vP.x, 0.0, -vP.y) - vec3(uCamW.x, 0.0, uCamW.z));
  // Texture coordinates: x east, y south (images are north-up). Derivatives taken here, in
  // uniform control flow, before the per-layer branches.
  vec2 gUv = vec2(vP.x, -vP.y);
  vec2 gDx = dFdx(gUv), gDy = dFdy(gUv);
  float pxM = max(length(gDx), length(gDy)); // metres per pixel
  float gFh = fwidth(vH);
  float m = macroLum(vP);
  float slope = 1.0 - clamp(vWorldN.y, 0.0, 1.0);
  float n1 = vnoise(vP * 0.045);
  float n2 = vnoise(vP * 0.37 + 17.0);
  float n3 = vnoise(vP * 0.9 - 5.0);
  // Mix: sand in dark, flat places; bedrock on slopes and bright outcrops; gravel in patches.
  float wSand = smoothstep(0.42, 0.22, m + 0.22 * (n1 - 0.5)) * (1.0 - smoothstep(0.06, 0.16, slope));
  // Sand drifts: patches of the sand where it is deep and soft (the rover's hazard: world.ts
  // sandAt computes the same). Darker, with stronger ripples, so they can be seen and avoided.
  float drift = wSand * smoothstep(0.6, 0.8, vnoise(vP * 0.02 + 7.0));
  if (drift > 0.0) {
    float dClear = 1e9;
    for (int i = 0; i < ${MAX_CLEAR}; i++) {
      if (i >= uClearCount) break;
      dClear = min(dClear, length(vP - uClear[i]));
    }
    drift *= smoothstep(${CLEAR_INNER_M.toFixed(1)}, ${CLEAR_OUTER_M.toFixed(1)}, dClear);
  }
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
  groundCol *= 1.0 - 0.24 * drift;
  // Slopes (the delta's sediments, the crater walls): layering, and darker exposed rock.
  float strataW = smoothstep(0.12, 0.35, slope);
  if (strataW > 0.0) {
    float b1 = sin(vH * 6.2832 / 9.0 + 3.0 * vnoise(vP * 0.004)) * (1.0 - smoothstep(1.5, 3.0, gFh));
    float b2 = sin(vH * 6.2832 / 2.6 + 2.0 * vnoise(vP * 0.02)) * (1.0 - smoothstep(0.43, 0.87, gFh));
    groundCol *= 1.0 + strataW * (0.08 * b1 + 0.035 * b2 - 0.1);
  }
#if TERRAIN_FX
  vec3 fxN = vec3(0.0);
  // The delta front's broken layered bedrock, as at Wildcat Ridge: a pavement of flat, angular
  // plates a few centimetres to half a metre across, lighter and more orange than the darker sand
  // between them; some plates are missing, some broken into smaller pieces.
  float fxNear = (1.0 - smoothstep(28.0, 65.0, viewDist)) * (1.0 - smoothstep(0.06, 0.14, pxM));
  float wPave = smoothstep(0.42, 0.62, m + 0.55 * (vnoise(vP * 0.08 + 3.0) - 0.5))
              * (1.0 - smoothstep(0.14, 0.38, slope)) * (1.0 - 0.75 * w.z) * fxNear;
  if (wPave > 0.01) {
    const mat2 R = mat2(0.94, 0.34, -0.34, 0.94);
    vec2 warp = 0.07 * vec2(vnoise(vP * 1.7), vnoise(vP * 1.7 + 9.0));
    vec2 q = vP + warp;
    const float CELL_A = 0.38;
    vec4 s = slabs(R * q / CELL_A);
    float edgeM = s.x * CELL_A;
    vec2 dirW = s.yz * R; // back to east/north
    float id = s.w;
    // Broken into ~0.2 m pieces in places (not where they would shimmer, far away).
    float split = smoothstep(0.35, 0.65, vnoise(vP * 0.7 + 11.0)) * (1.0 - smoothstep(0.012, 0.035, pxM));
    if (split > 0.0) {
      const float CELL_B = 0.16;
      vec4 s2 = slabs(q / CELL_B + 0.5);
      float e2 = s2.x * CELL_B + (1.0 - split) * 0.12;
      if (e2 < edgeM) { edgeM = e2; dirW = s2.yz; id = s2.w; }
    }
    // Sand fills the gaps where plates have drifted apart; some plates are gone.
    float gap = 0.02 + 0.07 * pow(vnoise(vP * 1.3 + 4.0), 1.2);
    float aa = pxM * 1.2 + 0.002;
    float cluster = smoothstep(0.38, 0.62, vnoise(vP * 0.55 + 21.0));
    float present = step(0.42 + 0.3 * w.z, fract(id * 7.31)) * step(0.45, cluster * (0.4 + fract(id * 2.9)));
    // Each plate buried in the sand to its own depth: sizes vary from plate to plate.
    float bury = 0.1 * fract(id * 3.71) * fract(id * 5.3 + 0.4);
    float slab = smoothstep(gap + bury, gap + bury + aa, edgeM) * present;
    // Plate surface: the bedrock photo at a per-plate offset; each plate its own tone.
    float sc = uGroundScale[3];
    vec3 bed = textureGrad(tGround, vec3(gUv * sc + vec2(id * 7.1, id * 3.7), 3.0), gDx * sc, gDy * sc).rgb;
    // Muted: the plates differ from the ground around them by a few tens of percent in brightness,
    // not in hue (a stronger contrast read as a tiled floor).
    float tone = 0.9 + 0.22 * fract(id * 17.3);
    vec3 slabCol = mix(bed, groundCol, 0.5) * vec3(1.1, 1.04, 0.98) * tone;
    // The rock is laminated: lighter, worn rims at the plates' edges.
    float rim = 1.0 - smoothstep(gap, gap + 0.025, edgeM);
    slabCol *= 1.0 + 0.07 * rim;
    // Between them: darker sand, darker still deep in the cracks (shadowed).
    // (Only next to a plate: where one is missing, no crack outline is drawn.)
    vec3 sandCol = uGroundMean[2] * (0.7 + 0.25 * n3) * mix(1.0 - 0.2 * present, 1.0, smoothstep(0.0, gap, edgeM));
    groundCol = mix(groundCol, mix(sandCol, slabCol, slab), wPave * mix(0.2, 0.8, present));
    // Normals: each plate bevelled at its edges and a little tilted.
    float bevel = 1.0 - smoothstep(gap, gap + 0.035, edgeM);
    vec2 tilt = (vec2(fract(id * 13.7), fract(id * 91.3)) - 0.5) * 0.18;
    fxN.xy += (-dirW * bevel * 0.8 * slab + tilt * slab) * wPave;
    gDetailNormal = normalize(mix(gDetailNormal, vec3(0.0, 0.0, 1.0), 0.35 * slab * wPave));
  }
  // Wind ripples in the sand: crests across the prevailing wind, steep lee faces.
  float wRip = max(w.z, drift) * (1.0 - smoothstep(25.0, 60.0 + 40.0 * drift, viewDist)) * (1.0 - smoothstep(0.08, 0.2, pxM));
  if (wRip > 0.01) {
    vec2 wd = vec2(0.93, 0.37);
    float lambda = 0.85;
    float ph = dot(vP, wd) / lambda + 1.6 * vnoise(vP * 0.12) + 0.5 * vnoise(vP * 0.55 + 2.0);
    float fr = fract(ph);
    float dh = fr < 0.72 ? 1.0 / 0.72 : -1.0 / 0.28;
    float hr = fr < 0.72 ? fr / 0.72 : (1.0 - fr) / 0.28;
    fxN.xy -= wd * dh * (0.035 / lambda) * 1.45 * wRip * (1.0 + 1.0 * drift);
    groundCol *= 1.0 + 0.08 * (hr - 0.5) * wRip;
  }
  // Distant slopes: rugged relief shading (ridges and gullies finer than the mesh).
  float farW = smoothstep(60.0, 220.0, viewDist);
  if (farW > 0.0) {
    float relief = 0.12 + 0.9 * smoothstep(0.04, 0.3, slope);
    vec2 g = vec2(0.0);
    float lambda = 420.0;
    for (int i = 0; i < 6; i++) {
      float vis = smoothstep(4.0, 8.0, lambda / max(pxM, 1e-3));
      if (vis > 0.0) {
        vec3 nd = noised(vP / lambda + vec2(float(i) * 5.1, 1.7));
        // Ridged noise (0.5 − |n|) with an amplitude of 0.15 λ.
        g += -sign(nd.x) * nd.yz * 0.15 * vis;
      }
      lambda *= 0.45;
    }
    fxN.xy += g * relief * farW;
  }
  gDetailNormal = normalize(gDetailNormal + vec3(fxN.xy, 0.0));
#endif
  // Far away, where the ground photos have faded to their mean colour, the orbital image sets
  // the tones, with a hint of colour: dark sand greyer, bright dust and bedrock warmer.
  float farK = 1.0 - fade;
  orb = mix(orb, mix(1.0, 0.5 + 1.0 * m, 0.85), farK);
  vec3 tint = mix(vec3(0.94, 0.95, 0.97), vec3(1.06, 1.0, 0.93), smoothstep(0.25, 0.7, m));
  groundCol *= mix(vec3(1.0), tint, 0.2 + 0.45 * farK);
  // The terrain's own shadows (baked: sunShadow.ts), applied to the sunlight after lighting.
  gSunVis = sunVisAt(vP);
  diffuseColor.rgb = groundCol * orb * uWB;
`;

/**
 * Ambient occlusion under the rover: its body hides most of the sky from the ground beneath it,
 * and each wheel sits in a small dark contact. The shadow map only handles the Sun; without this
 * the ground under the rover was as bright as the open plain in the sky's light, and the rover
 * seemed to float.
 */
const ROVER_AO = /* glsl */ `
  if (uRoverAO.w > 0.5) {
    vec2 d = vP - uRoverAO.xy;
    float c = cos(uRoverAO.z), s = sin(uRoverAO.z);
    vec2 l = vec2(d.x * c - d.y * s, d.x * s + d.y * c); // across, along
    vec2 q = abs(l) - vec2(0.8, 1.2);
    float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
    float occ = 1.0 - 0.62 * (1.0 - smoothstep(-0.5, 1.3, sd));
    float contact = 1.0;
    for (int i = 0; i < 6; i++) {
      vec2 e = vP - uWheelAO[i];
      contact *= 1.0 - 0.55 * exp(-dot(e, e) / 0.05);
    }
    reflectedLight.indirectDiffuse *= occ * contact;
    reflectedLight.directDiffuse *= mix(1.0, contact, 0.5);
  }
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
  /** Each level is drawn up to this × its patch size. */
  private readonly range: number;

  constructor(
    terrain: Terrain,
    ground: GroundTextures,
    macro: MacroAlbedo,
    shadows: SunShadows,
    fx = true,
  ) {
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
      uClear: { value: Array.from({ length: MAX_CLEAR }, () => new Vector2()) },
      uClearCount: { value: 0 },
      tADetail: { value: macro.detail },
      tAMid: { value: macro.mid },
      tAFar: { value: macro.far },
      tACore: { value: macro.core?.texture ?? macro.detail },
      uCoreInfo: {
        value: macro.core
          ? new Vector3(macro.core.widthM, macro.core.heightM, macro.core.cellM)
          : new Vector3(1, 1, 1),
      },
      uCoreOn: { value: macro.core ? 1 : 0 },
      uWB: { value: new Vector3(...GROUND_WB) },
      uRoverAO: { value: new Vector4() },
      uWheelAO: { value: Array.from({ length: 6 }, () => new Vector2(1e6, 1e6)) },
    };
    for (const t of [
      macro.detail,
      macro.mid,
      macro.far,
      ...(macro.core ? [macro.core.texture] : []),
    ]) {
      t.minFilter = LinearMipmapLinearFilter;
      t.magFilter = LinearFilter;
    }

    const material = new MeshStandardMaterial({ roughness: 0.96, metalness: 0 });
    this.range = fx ? RANGE : RANGE_LOW;
    material.defines = {
      TERRAIN_FX: fx ? 1 : 0,
      TERRAIN_SEAMLESS: fx ? 1 : 0,
      TERRAIN_RANGE: this.range.toFixed(2),
    };
    material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      Object.assign(shader.uniforms, this.uniforms, shadows.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
        .replace('#include <beginnormal_vertex>', VERTEX_MAIN)
        .replace('#include <begin_vertex>', 'vec3 transformed = terrainPos;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
        .replace('#include <map_fragment>', FRAGMENT_COLOR)
        .replace('#include <normal_fragment_maps>', FRAGMENT_NORMAL)
        .replace(
          '#include <lights_fragment_end>',
          `#include <lights_fragment_end>
           reflectedLight.directDiffuse *= gSunVis;
           reflectedLight.directSpecular *= gSunVis;
           ${ROVER_AO}`,
        );
    };
    material.customProgramCacheKey = () => `copernico-terrain-${fx ? 1 : 0}`;

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
    // The generated relief adds up to about ±60 m beyond the 1 m model.
    this.minH = lo - 120;
    this.maxH = hi + 120;
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

  /**
   * The rover's footprint for its ambient occlusion on the ground: origin (local x, north),
   * heading (clockwise from north) and the six wheels' contact points; null when it is not there.
   */
  setRover(at: [number, number, number] | null, wheels: Array<[number, number]> = []): void {
    const u = this.uniforms.uRoverAO!.value as Vector4;
    if (!at) {
      u.w = 0;
      return;
    }
    u.set(at[0], at[1], at[2], 1);
    const list = this.uniforms.uWheelAO!.value as Vector2[];
    for (let i = 0; i < 6; i++) list[i]!.set(...(wheels[i] ?? [1e6, 1e6]));
  }

  /** Points kept free of sand drifts (local x, north). */
  setClear(points: Array<[number, number]>): void {
    const list = this.uniforms.uClear!.value as Vector2[];
    const n = Math.min(MAX_CLEAR, points.length);
    for (let i = 0; i < n; i++) list[i]!.set(points[i]![0], points[i]![1]);
    this.uniforms.uClearCount!.value = n;
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
    const finerRange = (size / 2) * this.range;
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

  /** The height layers as GPU textures (for baking the terrain's shadows). */
  get heightTextures(): { detail: DataTexture; mid: DataTexture; far: DataTexture } {
    return {
      detail: this.uniforms.tHDetail!.value as DataTexture,
      mid: this.uniforms.tHMid!.value as DataTexture,
      far: this.uniforms.tHFar!.value as DataTexture,
    };
  }

  dispose(): void {
    this.geometry.dispose();
    (this.mesh.material as MeshStandardMaterial).dispose();
    for (const k of ['tHDetail', 'tHMid', 'tHFar', 'tADetail', 'tAMid', 'tAFar'])
      (this.uniforms[k]!.value as DataTexture).dispose();
    void this.sphere;
  }
}
