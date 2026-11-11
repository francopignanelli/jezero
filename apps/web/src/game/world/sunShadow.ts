import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type Material,
  type Texture,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from 'three';
import { DETAIL_RAMP_M, MID_RAMP_M, type HeightLayer } from './heights';

/**
 * Sunlight blocked by the terrain itself: the delta's scarp, crater rims, hills and the crater
 * wall cast their shadows on the ground (and on the rover and rocks), everywhere, not only in the
 * shadow map's few tens of metres around the rover.
 *
 * The Sun does not move in the game, so this is baked once per area, on the GPU: for every texel
 * of each height layer (1 m, 8 m, 50 m), a ray is marched towards the Sun over the terrain, and
 * the highest horizon angle found is compared with the Sun's elevation. A margin of ±1.4° makes
 * the edge soft: the Sun's own disc and the light scattered by the dust blur it. Marching uses the
 * layers' own heights; the generated relief (micro-relief, ridges) casts none.
 */

/** A 1×1 white texture: fully lit until the bake is done. */
function lit(): DataTexture {
  const t = new DataTexture(
    new Uint8Array([255, 255, 255, 255]),
    1,
    1,
    RGBAFormat,
    UnsignedByteType,
  );
  t.needsUpdate = true;
  return t;
}

/** Uniforms shared by every material that receives the terrain's shadows. */
export interface SunShadowUniforms {
  tSDetail: { value: Texture };
  tSMid: { value: Texture };
  tSFar: { value: Texture };
  uSDetail: { value: Vector2 };
  uSMid: { value: Vector2 };
  uSFar: { value: Vector2 };
}

/** GLSL: \`float sunVisAt(vec2 p)\`, 0 (in the terrain's shadow) … 1 (lit), at a local point. */
export const GLSL_SUN_VIS = /* glsl */ `
  uniform sampler2D tSDetail;
  uniform sampler2D tSMid;
  uniform sampler2D tSFar;
  uniform vec2 uSDetail; // width, height (m)
  uniform vec2 uSMid;
  uniform vec2 uSFar;
  float sunEdge(vec2 size, vec2 p, float ramp) {
    float d = min(size.x * 0.5 - abs(p.x), size.y * 0.5 - abs(p.y));
    return smoothstep(0.0, 1.0, clamp(d / ramp, 0.0, 1.0));
  }
  vec2 sunUv(vec2 size, vec2 p) { return p / size + 0.5; }
  float sunVisAt(vec2 p) {
    float v = texture(tSFar, sunUv(uSFar, p)).r;
    float wm = sunEdge(uSMid, p, ${MID_RAMP_M.toFixed(1)});
    if (wm > 0.0) v = mix(v, texture(tSMid, sunUv(uSMid, p)).r, wm);
    float wd = sunEdge(uSDetail, p, ${DETAIL_RAMP_M.toFixed(1)});
    if (wd > 0.0) v = mix(v, texture(tSDetail, sunUv(uSDetail, p)).r, wd);
    return v;
  }
`;

const BAKE_VS = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const BAKE_FS = /* glsl */ `
  precision highp float;
  uniform sampler2D tHDetail;
  uniform sampler2D tHMid;
  uniform sampler2D tHFar;
  uniform vec3 uDetailInfo; // width, height, cell (m)
  uniform vec3 uMidInfo;
  uniform vec3 uFarInfo;
  uniform vec2 uSize;     // extent of the layer being baked (m)
  uniform vec2 uSun2;     // Sun direction on the ground (x east, north), unit
  uniform float uTanSun;  // tangent of the Sun's elevation
  uniform float uStep0;   // first step (m)
  uniform float uMaxT;    // how far to look (m)
  uniform float uUseFar;
  varying vec2 vUv;

  float hFetch(sampler2D t, ivec2 c) {
    ivec2 s = textureSize(t, 0);
    return texelFetch(t, clamp(c, ivec2(0), s - 1), 0).r;
  }
  float hBilinear(sampler2D t, vec3 info, vec2 p) {
    vec2 g = vec2((p.x + info.x * 0.5) / info.z - 0.5, (info.y * 0.5 - p.y) / info.z - 0.5);
    vec2 f = fract(g);
    ivec2 c = ivec2(floor(g));
    return mix(mix(hFetch(t, c), hFetch(t, c + ivec2(1, 0)), f.x),
               mix(hFetch(t, c + ivec2(0, 1)), hFetch(t, c + ivec2(1, 1)), f.x), f.y);
  }
  float edgeW(vec3 info, vec2 p, float ramp) {
    float d = min(info.x * 0.5 - abs(p.x), info.y * 0.5 - abs(p.y)) - info.z;
    return smoothstep(0.0, 1.0, clamp(d / ramp, 0.0, 1.0));
  }
  float bakeH(vec2 p) {
    float wm = edgeW(uMidInfo, p, ${MID_RAMP_M.toFixed(1)});
    float h = uUseFar > 0.5 || wm < 1.0 ? hBilinear(tHFar, uFarInfo, p) : 0.0;
    if (wm > 0.0) h = mix(h, hBilinear(tHMid, uMidInfo, p), wm);
    float wd = edgeW(uDetailInfo, p, ${DETAIL_RAMP_M.toFixed(1)});
    if (wd > 0.0) h = mix(h, hBilinear(tHDetail, uDetailInfo, p), wd);
    return h;
  }
  void main() {
    vec2 p = (vUv - 0.5) * uSize;
    float h0 = bakeH(p) + 0.2;
    float t = uStep0;
    float horizon = -1.0;
    for (int i = 0; i < 150; i++) {
      if (t > uMaxT) break;
      horizon = max(horizon, (bakeH(p + uSun2 * t) - h0) / t);
      t = t * 1.055 + uStep0 * 0.3;
    }
    float vis = smoothstep(-0.025, 0.025, uTanSun - horizon);
    gl_FragColor = vec4(vec3(vis), 1.0);
  }
`;

export class SunShadows {
  readonly uniforms: SunShadowUniforms = {
    tSDetail: { value: lit() },
    tSMid: { value: lit() },
    tSFar: { value: lit() },
    uSDetail: { value: new Vector2(1e6, 1e6) },
    uSMid: { value: new Vector2(1e6, 1e6) },
    uSFar: { value: new Vector2(1e6, 1e6) },
  };
  private targets: WebGLRenderTarget[] = [];

  /**
   * Bakes the shadows of an area's terrain for a Sun direction (world: x east, y up, z south).
   * `scale` < 1 bakes at a lower resolution (low graphics quality).
   */
  bake(
    renderer: WebGLRenderer,
    layers: { detail: HeightLayer; mid: HeightLayer; far: HeightLayer },
    heights: { detail: Texture; mid: Texture; far: Texture },
    sun: Vector3,
    scale = 1,
  ): void {
    this.dispose();
    const horiz = Math.hypot(sun.x, sun.z);
    const material = new ShaderMaterial({
      vertexShader: BAKE_VS,
      fragmentShader: BAKE_FS,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tHDetail: { value: heights.detail },
        tHMid: { value: heights.mid },
        tHFar: { value: heights.far },
        uDetailInfo: {
          value: new Vector3(layers.detail.widthM, layers.detail.heightM, layers.detail.cellM),
        },
        uMidInfo: { value: new Vector3(layers.mid.widthM, layers.mid.heightM, layers.mid.cellM) },
        uFarInfo: { value: new Vector3(layers.far.widthM, layers.far.heightM, layers.far.cellM) },
        uSize: { value: new Vector2() },
        uSun2: { value: new Vector2(sun.x / horiz, -sun.z / horiz) },
        uTanSun: { value: sun.y / horiz },
        uStep0: { value: 1 },
        uMaxT: { value: 1 },
        uUseFar: { value: 1 },
      },
    });
    const quad = new Mesh(new PlaneGeometry(2, 2), material);
    quad.frustumCulled = false;
    const scene = new Scene();
    scene.add(quad);
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const previous = renderer.getRenderTarget();
    // Resolution (m per texel), first step and reach of the march per layer.
    const jobs: Array<[keyof typeof layers, number, number, number]> = [
      ['detail', 1, 0.8, 700],
      ['mid', 8, 6, 7000],
      ['far', 50, 40, 30000],
    ];
    for (const [name, cell, step0, maxT] of jobs) {
      const l = layers[name];
      const w = Math.max(1, Math.round((l.widthM / cell) * scale));
      const h = Math.max(1, Math.round((l.heightM / cell) * scale));
      const rt = new WebGLRenderTarget(w, h, {
        format: RGBAFormat,
        type: UnsignedByteType,
        generateMipmaps: true,
        minFilter: LinearMipmapLinearFilter,
        magFilter: LinearFilter,
        depthBuffer: false,
      });
      material.uniforms.uSize!.value.set(l.widthM, l.heightM);
      material.uniforms.uStep0!.value = step0;
      material.uniforms.uMaxT!.value = maxT;
      // The detail layer's rays stay within the mid layer: the far one need not be read there.
      material.uniforms.uUseFar!.value = name === 'detail' ? 0 : 1;
      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);
      this.targets.push(rt);
      const key = name === 'detail' ? 'Detail' : name === 'mid' ? 'Mid' : 'Far';
      this.uniforms[`tS${key}`].value = rt.texture;
      this.uniforms[`uS${key}`].value.set(l.widthM, l.heightM);
    }
    renderer.setRenderTarget(previous);
    quad.geometry.dispose();
    material.dispose();
  }

  dispose(): void {
    for (const rt of this.targets) rt.dispose();
    this.targets = [];
  }
}

/**
 * Makes a standard material receive the terrain's shadows: its direct (sun) light is scaled by
 * the baked visibility at the fragment's world position. Chains any onBeforeCompile already set.
 */
export function receiveSunShadow(material: Material, shadows: SunShadows): void {
  // Once per material: a material shared by several meshes is often listed more than once, and
  // patching it twice declares vSunWorld twice (the shader would not compile, nothing drawn).
  if (material.userData.sunShadow) return;
  material.userData.sunShadow = true;
  const before = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
    before(shader, renderer);
    Object.assign(shader.uniforms, shadows.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSunWorld;')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
         {
           vec4 sw = vec4(transformed, 1.0);
           #ifdef USE_INSTANCING
             sw = instanceMatrix * sw;
           #endif
           vSunWorld = (modelMatrix * sw).xyz;
         }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vSunWorld;\n${GLSL_SUN_VIS}`)
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
         {
           float sunVis = sunVisAt(vec2(vSunWorld.x, -vSunWorld.z));
           reflectedLight.directDiffuse *= sunVis;
           reflectedLight.directSpecular *= sunVis;
         }`,
      );
  };
}
