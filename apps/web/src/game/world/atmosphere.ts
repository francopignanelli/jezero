import { ShaderChunk } from 'three';

/**
 * Dust haze that thins with height, replacing three.js's exponential fog for every built-in
 * material in the game.
 *
 * Mars's air carries suspended dust everywhere (a typical optical depth of 0.3–0.6 at Jezero). In
 * the game the haze is concentrated in the lowest kilometres, a stylised choice for depth. Over
 * the crater floor it is dense, so distant plains fade into it while the rim and the delta tops
 * stand out above it.
 *
 * The density at height h above the world base is fogDensity · e^(−h/H). Integrated along the
 * ray from the camera to the point, the optical depth is
 *   τ = fogDensity · e^(−h_cam/H) · d · (1 − e^(−Δh/H)) / (Δh/H).
 * The haze factor is then 1 − e^(−τ) (Beer–Lambert).
 */
export const HAZE_SCALE_M = 1400;

let installed = false;

export function installHeightHaze(): void {
  if (installed) return;
  installed = true;
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
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
  ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    vec3 hazeRay = vFogWorld - cameraPosition;
    float hazeK = ${(1 / HAZE_SCALE_M).toExponential(6)};
    float hazeDh = hazeRay.y * hazeK;
    float hazeShape = abs(hazeDh) > 1e-4 ? (1.0 - exp(-hazeDh)) / hazeDh : 1.0;
    float hazeTau = fogDensity * exp(-clamp(cameraPosition.y, -800.0, 6000.0) * hazeK)
                  * length(hazeRay) * hazeShape;
    float fogFactor = 1.0 - exp(-max(hazeTau, 0.0));
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
#endif`;
}
