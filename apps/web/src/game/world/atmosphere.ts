import { ShaderChunk, type Vector3 } from 'three';

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
 *
 * Its colour depends on the direction, as the sky's does at the horizon (sky.ts): brighter towards
 * the Sun, with the warm glow of the light the dust scatters forwards, dimmer away from it. So
 * distant hills fade into the sky behind them, and the view towards the Sun is hazier.
 */
export const HAZE_SCALE_M = 1400;

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
  #ifdef FOG_EXP2
    // As the sky at the horizon: ×(1.01 + 0.11 cos θ), plus the forward glow (scaled with the haze
    // brightness, so it dims in a dust storm).
    float hazeMu = dot(hazeRay / max(length(hazeRay), 1e-3), ${sunGlsl});
    float hazeLum = dot(fogColor, vec3(0.3333)) / 0.45;
    vec3 hazeSun = ${sunGlsl};
    float hazeSide = pow(0.5 + 0.5 * dot(normalize(hazeRay.xz + vec2(1e-5)), normalize(hazeSun.xz + vec2(1e-5))), 3.0);
    vec3 hazeCol = fogColor * (1.01 + 0.11 * hazeMu)
                 + vec3(1.0, 0.86, 0.64) * hazeLum
                   * (0.15 * pow(max(hazeMu, 0.0), 3.0) + 0.25 * pow(max(hazeMu, 0.0), 7.0))
                 + vec3(1.0, 0.92, 0.72) * hazeLum * 0.42 * hazeSide;
  #else
    vec3 hazeCol = fogColor;
  #endif
  gl_FragColor.rgb = mix(gl_FragColor.rgb, hazeCol, fogFactor);
#endif`;
}
