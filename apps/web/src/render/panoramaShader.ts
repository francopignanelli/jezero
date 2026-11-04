/**
 * Shaders of the 360° viewer for the real Mastcam-Z panoramas (the planner's PanoramaViewer and the
 * rover game's discoveries): a full-screen quad looking into the mosaic's cylinder.
 */
export const PANORAMA_VS = `#version 300 es
in vec2 a_pos;
out vec2 v_ndc;
void main() { v_ndc = a_pos; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

// The mosaic is a cylinder: its width spans u_span of compass azimuth starting at u_az0 (growing to
// the right when u_dir = 1), rows are linear in elevation from u_top to u_bottom, and the mast tilt
// left in it is undone (photo elevation = true elevation + tilt). All measured by the pipeline.
// Above the photographed strip the sky continues as a plain gradient from the photo's top rows.
// u_mask marks the areas the camera did not image (the rover's own body), filled smoothly by the
// pipeline; they are always shown hatched, so the filled ground is never mistaken for photo.
export const PANORAMA_FS = `#version 300 es
precision highp float;
in vec2 v_ndc;
out vec4 outColor;
uniform sampler2D u_pano;
uniform sampler2D u_mask;
uniform float u_yaw;
uniform float u_pitch;
uniform vec2 u_tanHalf;
uniform float u_top;
uniform float u_bottom;
uniform float u_az0;
uniform float u_dir;
uniform float u_span;
uniform float u_tilt;
uniform float u_tiltAz;
const float PI = 3.141592653589793;
void main() {
  vec3 d = normalize(vec3(v_ndc.x * u_tanHalf.x, v_ndc.y * u_tanHalf.y, -1.0));
  float cp = cos(u_pitch), sp = sin(u_pitch);
  // Positive pitch looks up.
  d = vec3(d.x, d.y * cp - d.z * sp, d.y * sp + d.z * cp);
  float cy = cos(u_yaw), sy = sin(u_yaw);
  d = vec3(d.x * cy - d.z * sy, d.y, d.x * sy + d.z * cy);
  float az = atan(d.x, -d.z); // compass azimuth, clockwise from north
  float el = asin(clamp(d.y, -1.0, 1.0)) + u_tilt * cos(az - u_tiltAz);
  float u = fract(u_dir * (az - u_az0) / (2.0 * PI)) * (2.0 * PI) / u_span;
  vec2 uv = vec2(u, (u_top - el) / (u_top - u_bottom));
  vec2 gx = dFdx(uv), gy = dFdy(uv);
  gx.x -= round(gx.x);
  gy.x -= round(gy.x);
  if (uv.y < 0.0) {
    // Above the photographed strip (not imagery): the top-row sky colour of this azimuth, darkening
    // toward an illustrative zenith tone.
    vec3 edge = textureLod(u_pano, vec2(uv.x, 0.0), 6.0).rgb;
    float k = smoothstep(0.0, 1.0, (el - u_top) / (0.5 * PI - u_top));
    outColor = vec4(mix(edge, vec3(0.45, 0.36, 0.27), k), 1.0);
    return;
  }
  if (uv.y > 1.0) {
    outColor = vec4(textureLod(u_pano, vec2(uv.x, 1.0), 6.0).rgb * 0.6, 1.0);
    return;
  }
  vec3 photo = textureGrad(u_pano, uv, gx, gy).rgb;
  // Feather the top 3% of the photo into the extrapolated sky so there is no seam.
  if (uv.y < 0.03) photo = mix(textureLod(u_pano, vec2(uv.x, 0.0), 6.0).rgb, photo, smoothstep(0.0, 0.03, uv.y));
  // Unimaged (filled) areas: marked in the photo's own colour, not a foreign hatch: faint diagonal
  // lines of the same hue over the smooth fill, with soft edges (the outline of the missing frames
  // is stair-stepped).
  vec2 px = 1.5 / vec2(textureSize(u_mask, 0));
  float m = 0.0;
  for (int i = -1; i <= 1; i++)
    for (int j = -1; j <= 1; j++) m += texture(u_mask, uv + vec2(i, j) * px).r;
  m = smoothstep(0.15, 0.85, m / 9.0);
  float line = smoothstep(0.32, 0.48, abs(fract((gl_FragCoord.x + gl_FragCoord.y) / 16.0) - 0.5));
  photo = mix(photo, photo * (0.91 + 0.09 * line), m);
  outColor = vec4(photo, 1.0);
}`;
