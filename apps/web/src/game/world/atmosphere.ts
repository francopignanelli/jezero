import { ShaderChunk, type Vector3 } from 'three';
import { SKY_15_OVER_HORIZON } from './sky';

/**
 * Dust haze that thins with height, replacing three.js's exponential fog for every built-in
 * material in the game.
 *
 * Mars's air carries suspended dust everywhere. Two layers:
 * - the well-mixed dust of the whole column, as in the planner (marsScene.ts): scale height 11 km,
 *   vertical optical depth 0.4 (Perseverance measured τ ≈ 0.3–0.6 at Jezero outside dust storms);
 * - a dustier layer in the lowest few hundred metres over the crater floor, where the daytime
 *   convection and the dust devils lift it (a stylised choice for depth: its strength is not a
 *   measurement).
 * So distant low plains fade into a pale veil, while ridges, the delta tops and the crater rim,
 * standing above the low layer, stay as silhouettes, each farther one paler than the last.
 *
 * Each layer's density at height h above the world base (the crater floor) is β · e^(−h/H).
 * Integrated along the ray from the camera to the point, its optical depth is
 *   τ = β · e^(−h_cam/H) · d · (1 − e^(−Δh/H)) / (Δh/H).
 * fogDensity is the two layers' β together at the floor; the haze factor is 1 − e^(−τ)
 * (Beer–Lambert).
 *
 * Its colour depends on the direction, as the sky's does at the horizon (sky.ts): brighter towards
 * the Sun, with the warm glow of the light the dust scatters forwards, dimmer away from it. So
 * distant hills fade into the sky behind them, and the view towards the Sun is hazier. Like the
 * sky, it darkens with the ray's elevation and its Sun-side glow stays low: a far ridge a few
 * degrees up fades towards the sky just behind it, never brighter than it.
 */
/** Scale height of the whole column's dust (m), and of the low layer (m). */
export const HAZE_SCALE_M = 11_000;
export const LOW_HAZE_SCALE_M = 500;
/** The column's share of the extinction at the floor: β = 0.4 / 11 km = 3.6e-5 /m of the game's 2.0e-4. */
export const COLUMN_SHARE = 0.18;

let installed = false;

export function installHeightHaze(sun?: Vector3): void {
  if (installed) return;
  installed = true;
  const s = sun ? sun.clone().normalize() : null;
  const sunGlsl = s
    ? `vec3(${s.x.toFixed(5)}, ${s.y.toFixed(5)}, ${s.z.toFixed(5)})`
    : 'vec3(0.0, -1.0, 0.0)';
  ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorld;
#endif`;
  ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  // World position from the view-space one (rigid view matrix: R^T (p − t)).
  vFogWorld = transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);
#endif`;
  ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
    // ∫ e^(−h/H) ds along a ray from height hc to ht (length d), for k = 1/H:
    // d · (e^(−k·hc) − e^(−k·ht)) / (k·(ht − hc)), or d · e^(−k·hc) on a level ray.
    float hazeColumn(float hc, float ht, float d, float k) {
      float ec = exp(-k * hc);
      float dh = k * (ht - hc);
      return abs(dh) > 1e-4 ? d * (ec - exp(-k * ht)) / dh : d * ec;
    }
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
  ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    vec3 hazeRay = vFogWorld - cameraPosition;
    // Heights kept where the exponentials stay finite (below the floor only by a few hundred m).
    float hazeHc = clamp(cameraPosition.y, -800.0, 60000.0);
    float hazeHt = clamp(vFogWorld.y, -800.0, 60000.0);
    float hazeD = length(hazeRay);
    // Column dust, then the low layer.
    float hazeTau = fogDensity * (
        ${COLUMN_SHARE.toFixed(4)} * hazeColumn(hazeHc, hazeHt, hazeD, ${(1 / HAZE_SCALE_M).toExponential(6)})
      + ${(1 - COLUMN_SHARE).toFixed(4)} * hazeColumn(hazeHc, hazeHt, hazeD, ${(1 / LOW_HAZE_SCALE_M).toExponential(6)}));
    float fogFactor = 1.0 - exp(-max(hazeTau, 0.0));
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  #ifdef FOG_EXP2
    // As the sky at the horizon: ×(1.01 + 0.11 cos θ), plus the forward glow (scaled with the haze
    // brightness, so it dims in a dust storm).
    float hazeMu = dot(hazeRay / max(length(hazeRay), 1e-3), ${sunGlsl});
    float hazeLum = dot(fogColor, vec3(0.3333)) / 0.45;
    vec3 hazeSun = ${sunGlsl};
    float hazeUp = max(hazeRay.y / max(hazeD, 1e-3), 0.0);
    float hazeSide = pow(clamp(0.5 + 0.5 * dot(normalize(hazeRay.xz + vec2(1e-5)), normalize(hazeSun.xz + vec2(1e-5))), 0.0, 1.0), 3.0)
                   * exp(-hazeUp * 4.0);
    vec3 hazeCol = fogColor * (1.01 + 0.11 * hazeMu)
                 + vec3(1.0, 0.86, 0.64) * hazeLum
                   * (0.15 * pow(max(hazeMu, 0.0), 3.0) + 0.25 * pow(max(hazeMu, 0.0), 7.0))
                 + vec3(1.0, 0.92, 0.72) * hazeLum * 0.42 * hazeSide;
  #else
    vec3 hazeCol = fogColor;
  #endif
  #ifdef FOG_EXP2
    hazeCol *= mix(vec3(1.0), vec3(${SKY_15_OVER_HORIZON.map((v) => v.toFixed(4)).join(', ')}), smoothstep(0.0, 0.27, hazeUp));
  #endif
  gl_FragColor.rgb = mix(gl_FragColor.rgb, hazeCol, fogFactor);
#endif`;
}
