import {
  apply,
  icrfToMarsFixed,
  MARS_SPHERE_RADIUS_M,
  mul,
  raDecToVector,
  solarSystemFromMars,
  type Mat3,
  type SkyBody,
} from '@copernico/domain';
import { compileProgram, finishEquirectTexture } from './gl';
import { smoothstep } from '../lib/math';

/**
 * Scientifically positioned space background rendered BEHIND the (transparent) Cesium canvas, so the
 * planet and terrain occlude it naturally.
 *
 * Accuracy: star, planet, Sun and Milky Way directions are exact to catalog/ephemeris precision:
 * ICRF → Mars body-fixed (IAU 2015 rotation at the scene time) → camera. Angular sizes are true
 * (the Sun is a 0.3–0.4° disc; planets are unresolved points). Brightness is enhanced relative to a
 * camera exposed for sunlit Mars, and the daytime surface sky tint is illustrative.
 */

export type SkyQuality = 'hd' | 'sd' | 'none';

interface StarFile {
  stars: Array<[number, number, number, string]>;
  classColours: Record<string, [number, number, number]>;
}

export interface SkyView {
  /** World (Mars-fixed) → eye rotation, row-major. Eye looks down −Z with +Y up. */
  viewRotation: Mat3;
  fovyRad: number;
  aspect: number;
  /** Unit "up" at the camera (world frame) and camera height above the reference sphere (m). */
  up: [number, number, number];
  heightM: number;
}

const SKY_VS = `#version 300 es
in vec2 a_pos;
out vec2 v_ndc;
void main() { v_ndc = a_pos; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const SKY_FS = `#version 300 es
precision highp float;
in vec2 v_ndc;
out vec4 outColor;
uniform mat3 u_eyeToIcrf;
uniform mat3 u_eyeToWorld;
uniform vec2 u_tanHalf;
uniform sampler2D u_milkyWay;
uniform sampler2D u_milkyWayNext;
uniform float u_mix;
uniform float u_gain;
uniform float u_day;
uniform vec3 u_up;
uniform float u_camDist; // camera distance from the planet centre, in planet radii
uniform vec3 u_sun;      // unit sun direction, world frame
uniform float u_glow;    // limb glow strength (seen from orbit only)
const float PI = 3.141592653589793;
// Dusty limb glow, as orbital images show it. Real dust and haze layers reach ~40–60 km and the dust
// scale height is ~11 km, which would be under a pixel at globe scale: the widths here (≈40 km and
// ≈170 km) are a display exaggeration, the colour is the Mastcam-Z horizon sky.
const vec3 GLOW_COLOUR = vec3(0.95, 0.64, 0.40);
const float BLACK_POINT = 0.035;
const vec3 SKY_HORIZON = vec3(0.87, 0.68, 0.49);
const vec3 SKY_15 = vec3(0.69, 0.55, 0.40);
const vec3 SKY_ZENITH = vec3(0.45, 0.36, 0.27);
void main() {
  vec3 dEye = normalize(vec3(v_ndc.x * u_tanHalf.x, v_ndc.y * u_tanHalf.y, -1.0));
  vec3 d = normalize(u_eyeToIcrf * dEye);
  float ra = atan(d.y, d.x);
  float dec = asin(clamp(d.z, -1.0, 1.0));
  vec2 uv = vec2(fract(0.5 - ra / (2.0 * PI)), 0.5 - dec / PI);
  // Screen-space gradients drive mip selection (no aliasing when the texture is minified). The RA
  // coordinate wraps 1 → 0 at the seam; removing that jump keeps the seam pixels at the right LOD.
  vec2 gx = dFdx(uv);
  vec2 gy = dFdy(uv);
  gx.x -= round(gx.x);
  gy.x -= round(gy.x);
  // Slight LOD bias (~0.5 mip level): the unresolved star field reads as a smooth band instead of
  // per-pixel grain; bright stars are drawn separately as points from BSC5 and stay sharp.
  gx *= 1.4;
  gy *= 1.4;
  vec3 mw = mix(textureGrad(u_milkyWay, uv, gx, gy).rgb, textureGrad(u_milkyWayNext, uv, gx, gy).rgb, u_mix) * u_gain;
  // Display black point: hides the sub-threshold speckle of unresolved faint stars so the Milky Way
  // reads as a band. Positions are unchanged; this is a tone choice like any exposure.
  mw = max(mw - BLACK_POINT, 0.0) / (1.0 - BLACK_POINT);
  // Daytime Mars sky: the horizon and +15° colours are averages sampled from the Mastcam-Z
  // panorama PIA26699 (natural colour, sol 1717); the zenith tone is extrapolated (illustrative).
  vec3 w = u_eyeToWorld * dEye;
  float h = clamp(dot(normalize(w), u_up), -1.0, 1.0);
  vec3 sky = mix(SKY_HORIZON, SKY_15, smoothstep(0.0, 0.27, h));
  sky = mix(sky, SKY_ZENITH, smoothstep(0.27, 1.0, h));
  vec3 colour = mix(mw * (1.0 - u_day), sky, u_day);
  if (u_glow > 0.0) {
    vec3 wn = normalize(w);
    vec3 cam = u_up * u_camDist;
    float b = dot(cam, wn);
    float alt = sqrt(max(dot(cam, cam) - b * b, 0.0)) - 1.0; // closest-approach altitude (radii)
    // Below the reference sphere too: the limb is terrain (up to ~8 km lower), and the opaque globe
    // hides the glow wherever terrain is, so no dark gap is left between the two.
    if (b < 0.0) {
      vec3 tangent = cam - b * wn;
      float lit = smoothstep(-0.2, 0.35, dot(normalize(tangent), u_sun));
      float h = max(alt, 0.0);
      float g = 0.45 * exp(-h / 0.014) + 0.22 * exp(-h / 0.06);
      colour += GLOW_COLOUR * g * lit * u_glow;
    }
  }
  outColor = vec4(colour, 1.0);
}`;

const STAR_VS = `#version 300 es
in vec3 a_dir;
in float a_mag;
in vec3 a_color;
uniform mat3 u_icrfToEye;
uniform vec2 u_tanHalf;
uniform float u_pixelRatio;
uniform float u_visibility;
out vec3 v_color;
out float v_alpha;
void main() {
  vec3 e = u_icrfToEye * a_dir;
  if (e.z >= -1e-4) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  vec2 ndc = vec2(e.x / (-e.z * u_tanHalf.x), e.y / (-e.z * u_tanHalf.y));
  gl_Position = vec4(ndc, 0.0, 1.0);
  // Brightness from V magnitude: flux ∝ 10^(-0.4 m). Size grows slowly with flux (display convention).
  float flux = pow(10.0, -0.4 * (a_mag - 6.5));
  gl_PointSize = clamp(1.3 + 0.9 * log2(1.0 + flux) * 0.5, 1.3, 7.0) * u_pixelRatio;
  v_alpha = clamp(0.28 + 0.12 * log2(flux + 1.0), 0.28, 1.0) * u_visibility;
  v_color = a_color;
}`;

const STAR_FS = `#version 300 es
precision mediump float;
in vec3 v_color;
in float v_alpha;
out vec4 outColor;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  float core = exp(-r2 * 3.5);
  // Premultiplied alpha (blend ONE, ONE_MINUS_SRC_ALPHA): colour must carry the same factor, or
  // faint stars render at full brightness and daylight can never hide them.
  float a = core * v_alpha;
  outColor = vec4(v_color * a, a);
}`;

const SUN_VS = `#version 300 es
in vec3 a_dir;
uniform mat3 u_icrfToEye;
uniform vec2 u_tanHalf;
uniform float u_size;
void main() {
  vec3 e = u_icrfToEye * a_dir;
  if (e.z >= -1e-4) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  gl_Position = vec4(e.x / (-e.z * u_tanHalf.x), e.y / (-e.z * u_tanHalf.y), 0.0, 1.0);
  gl_PointSize = u_size;
}`;

const SUN_FS = `#version 300 es
precision mediump float;
uniform float u_discFraction;
out vec4 outColor;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float disc = u_discFraction;
  vec3 c;
  float a;
  if (r <= disc) {
    float mu = sqrt(1.0 - (r / disc) * (r / disc));
    c = vec3(1.0, 0.97, 0.9) * (0.4 + 0.6 * mu); // limb darkening (linear law, u ≈ 0.6)
    a = 1.0;
  } else {
    float g = exp(-8.0 * (r - disc) / (1.0 - disc));
    c = vec3(1.0, 0.92, 0.8) * g * 0.6; // glare halo (illustrative)
    a = g * 0.6;
  }
  outColor = vec4(c * a, a);
}`;

const transpose = (m: Mat3): Mat3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
/** WebGL mat3 uniforms are column-major: upload the transpose of a row-major matrix. */
const glMat = (m: Mat3) => new Float32Array(transpose(m));

const PLANET_COLOURS: Record<string, [number, number, number]> = {
  Mercury: [0.85, 0.82, 0.78],
  Venus: [1.0, 0.97, 0.88],
  Earth: [0.72, 0.85, 1.0],
  Jupiter: [1.0, 0.93, 0.8],
  Saturn: [1.0, 0.9, 0.7],
  Uranus: [0.75, 0.93, 0.95],
  Neptune: [0.65, 0.75, 1.0],
};

const FADE_MS = 900;

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      img.decode().then(
        () => resolve(img),
        () => resolve(img),
      );
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export class SkyRenderer {
  /** 0 at night … 1 in daylight at the camera's location (last render). */
  daylight = 1;
  readonly canvas: HTMLCanvasElement;
  readonly labels: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private skyProgram: WebGLProgram;
  private starProgram: WebGLProgram;
  private sunProgram: WebGLProgram;
  private quad: WebGLVertexArrayObject;
  private stars: WebGLVertexArrayObject | null = null;
  private planets: WebGLVertexArrayObject;
  private planetBuffer: WebGLBuffer;
  private starCount = 0;
  private texture: WebGLTexture | null = null;
  /** HD texture fading in over the 4K one (progressive load). */
  private nextTexture: WebGLTexture | null = null;
  private fadeStartMs = 0;
  private destroyed = false;
  private icrfToWorld: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  private bodies: SkyBody[] = [];
  enabled = true;

  constructor(host: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.labels = document.createElement('canvas');
    for (const c of [this.canvas, this.labels]) {
      c.className = 'sky-layer';
      c.setAttribute('aria-hidden', 'true');
    }
    // Stacking (bottom → top): sky, planet labels, then the transparent Cesium canvas.
    host.prepend(this.labels);
    host.prepend(this.canvas);
    const gl = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      premultipliedAlpha: true,
    });
    if (!gl) throw new Error('WebGL2 unavailable for sky');
    this.gl = gl;
    this.skyProgram = compileProgram(gl, SKY_VS, SKY_FS);
    this.starProgram = compileProgram(gl, STAR_VS, STAR_FS);
    this.sunProgram = compileProgram(gl, SUN_VS, SUN_FS);

    this.quad = gl.createVertexArray()!;
    gl.bindVertexArray(this.quad);
    const qb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.skyProgram, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.planets = gl.createVertexArray()!;
    this.planetBuffer = gl.createBuffer()!;
    gl.bindVertexArray(null);
  }

  /** HD (8192 × 4096) when the GPU supports 8K textures, otherwise 4K only. */
  chooseQuality(): Exclude<SkyQuality, 'none'> {
    const maxTexture = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) as number;
    return maxTexture >= 8192 ? 'hd' : 'sd';
  }

  /** True while the HD texture is fading in (the caller keeps rendering until it ends). */
  get animating(): boolean {
    return this.nextTexture !== null;
  }

  /**
   * Progressive load: resolves once the star catalog and the light Milky Way (2K, 0.55 MB) are on the GPU,
   * so the scene can be revealed quickly. If the GPU supports 8K, the sharper texture (4K, or 8K on large screens) then loads
   * in the background once `hdAfter` settles, so it does not compete with the first terrain tiles,
   * and cross-fades in; `onQuality('hd')` reports the upgrade. Positions are identical in both
   * textures; only the detail changes.
   */
  async load(
    starsUrl: string,
    milkyWay: { hd: string; sd: string },
    onQuality?: (quality: SkyQuality) => void,
    hdAfter: Promise<unknown> = Promise.resolve(),
  ): Promise<{ stars: boolean; quality: SkyQuality }> {
    const target = this.chooseQuality();
    const [starFile, sd] = await Promise.all([
      fetch(starsUrl).then((r) => (r.ok ? (r.json() as Promise<StarFile>) : null)),
      loadImage(milkyWay.sd),
    ]);
    // Destroyed meanwhile (e.g. React StrictMode's discarded first mount): its context is gone, and
    // a failed 4K upload must not start the 8K fallback download.
    if (this.destroyed) return { stars: false, quality: 'none' };
    if (starFile) {
      const data = new Float32Array(starFile.stars.length * 7);
      starFile.stars.forEach(([ra, dec, mag, cls], i) => {
        const d = raDecToVector(ra, dec);
        const c = starFile.classColours[cls] ?? [255, 244, 234];
        data.set([d[0], d[1], d[2], mag, c[0] / 255, c[1] / 255, c[2] / 255], i * 7);
      });
      this.stars = this.pointVao(data, this.gl.STATIC_DRAW);
      this.starCount = starFile.stars.length;
    }
    let quality: SkyQuality = 'none';
    if (sd) {
      this.texture = this.upload(sd);
      if (this.texture) quality = 'sd';
    }
    if (target === 'hd') {
      if (quality === 'none') {
        // 4K failed: wait for HD rather than revealing an empty sky.
        const hd = await loadImage(milkyWay.hd);
        this.texture = hd ? this.upload(hd) : null;
        if (this.texture) quality = 'hd';
      } else {
        void hdAfter.then(() => this.upgrade(milkyWay.hd, onQuality));
      }
    }
    this.gl.finish(); // the first texture is on the GPU before the scene is revealed
    return { stars: starFile !== null, quality };
  }

  private async upgrade(url: string, onQuality?: (quality: SkyQuality) => void): Promise<void> {
    // Decoded off the main thread (createImageBitmap from a Blob); an <img> would be decoded on it,
    // again for every crop.
    if (this.destroyed) return;
    let image: ImageBitmap;
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      image = await createImageBitmap(await res.blob());
    } catch {
      return;
    }
    if (this.destroyed) return image.close();
    const texture = await this.uploadInStrips(image);
    image.close();
    if (!texture) return; // out of GPU memory for 8K: keep 4K
    this.nextTexture = texture;
    this.fadeStartMs = performance.now();
    onQuality?.('hd');
  }

  /** Uploads an equirectangular image with a full mip chain; null if the GPU rejects it. */
  private upload(image: HTMLImageElement): WebGLTexture | null {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
    if (gl.getError() !== gl.NO_ERROR) {
      gl.deleteTexture(texture);
      return null;
    }
    finishEquirectTexture(gl);
    return texture;
  }

  /**
   * Same texture as upload(), from a decoded bitmap sent in 512-row strips, one per frame, so the
   * 8K image never blocks the main thread (decoding and uploading it in one go took ~0.9 s).
   * Mipmaps are generated once at the end.
   */
  private async uploadInStrips(image: ImageBitmap): Promise<WebGLTexture | null> {
    const gl = this.gl;
    const { width: w, height: h } = image;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1 + Math.floor(Math.log2(Math.max(w, h))), gl.RGB8, w, h);
    if (gl.getError() !== gl.NO_ERROR) {
      gl.deleteTexture(texture);
      return null;
    }
    const STRIP = 512;
    for (let y = 0; y < h; y += STRIP) {
      let strip: ImageBitmap;
      try {
        strip = await createImageBitmap(image, 0, y, w, Math.min(STRIP, h - y));
      } catch {
        gl.deleteTexture(texture);
        return null;
      }
      if (this.destroyed) {
        strip.close();
        return null;
      }
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y, gl.RGB, gl.UNSIGNED_BYTE, strip);
      strip.close();
      await new Promise((r) => requestAnimationFrame(r));
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    finishEquirectTexture(gl);
    return texture;
  }

  private pointVao(
    data: Float32Array,
    usage: number,
    buffer?: WebGLBuffer,
    vao?: WebGLVertexArrayObject,
  ): WebGLVertexArrayObject {
    const gl = this.gl;
    const v = vao ?? gl.createVertexArray()!;
    gl.bindVertexArray(v);
    const b = buffer ?? gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, usage);
    const attrs: Array<[string, number, number]> = [
      ['a_dir', 3, 0],
      ['a_mag', 1, 12],
      ['a_color', 3, 16],
    ];
    for (const [name, size, offset] of attrs) {
      const loc = gl.getAttribLocation(this.starProgram, name);
      if (loc < 0) continue;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 28, offset);
    }
    gl.bindVertexArray(null);
    return v;
  }

  destroy(): void {
    this.destroyed = true;
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.canvas.remove();
    this.labels.remove();
  }

  /** Scene time: Mars orientation (IAU 2015) and Sun/planet positions (astronomy-engine). */
  setTime(utcMs: number): void {
    this.icrfToWorld = icrfToMarsFixed(utcMs);
    this.bodies = solarSystemFromMars(utcMs);
    const planets = this.bodies.filter((b) => b.id !== 'Sun');
    const data = new Float32Array(planets.length * 7);
    planets.forEach((b, i) => {
      const c = PLANET_COLOURS[b.id] ?? [1, 1, 1];
      data.set([...b.directionIcrf, b.magnitude, ...c], i * 7);
    });
    this.pointVao(data, this.gl.DYNAMIC_DRAW, this.planetBuffer, this.planets);
  }

  /** Sun direction in the Mars-fixed world frame (for daylight fading). */
  sunWorld(): [number, number, number] | null {
    const sun = this.bodies.find((b) => b.id === 'Sun');
    return sun ? apply(this.icrfToWorld, sun.directionIcrf) : null;
  }

  render(view: SkyView): void {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.labels.width = w;
      this.labels.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.008, 0.012, 0.024, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const ctx2d = this.labels.getContext('2d');
    ctx2d?.clearRect(0, 0, w, h);
    if (!this.enabled) return;

    const tanY = Math.tan(view.fovyRad / 2);
    const tanHalf = [tanY * view.aspect, tanY] as const;
    const icrfToEye = mul(view.viewRotation, this.icrfToWorld);
    const eyeToIcrf = transpose(icrfToEye);
    const eyeToWorld = transpose(view.viewRotation);

    // Daylight near the surface: fade stars and blend an illustrative dusty sky.
    const sun = this.sunWorld();
    const sunUp = sun ? sun[0] * view.up[0] + sun[1] * view.up[1] + sun[2] * view.up[2] : -1;
    const lowAltitude = 1 - smoothstep(20_000, 80_000, view.heightM);
    this.daylight = smoothstep(-0.1, 0.15, sunUp);
    const day = this.daylight * lowAltitude;

    let fade = 0;
    if (this.nextTexture) {
      fade = Math.min(1, (performance.now() - this.fadeStartMs) / FADE_MS);
      if (fade >= 1) {
        gl.deleteTexture(this.texture);
        this.texture = this.nextTexture;
        this.nextTexture = null;
        fade = 0;
      }
    }
    if (this.texture) {
      gl.useProgram(this.skyProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.nextTexture ?? this.texture);
      gl.uniform1i(gl.getUniformLocation(this.skyProgram, 'u_milkyWay'), 0);
      gl.uniform1i(gl.getUniformLocation(this.skyProgram, 'u_milkyWayNext'), 1);
      gl.uniform1f(gl.getUniformLocation(this.skyProgram, 'u_mix'), fade);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniformMatrix3fv(
        gl.getUniformLocation(this.skyProgram, 'u_eyeToIcrf'),
        false,
        glMat(eyeToIcrf),
      );
      gl.uniformMatrix3fv(
        gl.getUniformLocation(this.skyProgram, 'u_eyeToWorld'),
        false,
        glMat(eyeToWorld),
      );
      gl.uniform2f(gl.getUniformLocation(this.skyProgram, 'u_tanHalf'), tanHalf[0], tanHalf[1]);
      gl.uniform1f(gl.getUniformLocation(this.skyProgram, 'u_gain'), 0.4);
      gl.uniform1f(gl.getUniformLocation(this.skyProgram, 'u_day'), day * 0.85);
      gl.uniform3f(gl.getUniformLocation(this.skyProgram, 'u_up'), ...view.up);
      gl.uniform1f(
        gl.getUniformLocation(this.skyProgram, 'u_camDist'),
        1 + view.heightM / MARS_SPHERE_RADIUS_M,
      );
      gl.uniform3f(gl.getUniformLocation(this.skyProgram, 'u_sun'), ...(sun ?? [0, 0, 1]));
      gl.uniform1f(
        gl.getUniformLocation(this.skyProgram, 'u_glow'),
        smoothstep(150_000, 600_000, view.heightM),
      );
      gl.bindVertexArray(this.quad);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const drawPoints = (
      program: WebGLProgram,
      vao: WebGLVertexArrayObject,
      count: number,
      visibility: number,
    ) => {
      gl.useProgram(program);
      gl.uniformMatrix3fv(gl.getUniformLocation(program, 'u_icrfToEye'), false, glMat(icrfToEye));
      gl.uniform2f(gl.getUniformLocation(program, 'u_tanHalf'), tanHalf[0], tanHalf[1]);
      gl.uniform1f(gl.getUniformLocation(program, 'u_pixelRatio'), dpr);
      gl.uniform1f(gl.getUniformLocation(program, 'u_visibility'), visibility);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.POINTS, 0, count);
    };
    if (this.stars) drawPoints(this.starProgram, this.stars, this.starCount, 1 - day);
    const planetCount = this.bodies.length - 1;
    if (planetCount > 0) drawPoints(this.starProgram, this.planets, planetCount, 1 - day * 0.6);
    this.drawSun(icrfToEye, tanHalf, h, dpr);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);

    if (ctx2d && day < 0.6) this.drawLabels(ctx2d, icrfToEye, tanHalf, w, h, dpr, 1 - day);
  }

  private drawSun(
    icrfToEye: Mat3,
    tanHalf: readonly [number, number],
    heightPx: number,
    dpr: number,
  ): void {
    const sun = this.bodies.find((b) => b.id === 'Sun');
    if (!sun) return;
    const gl = this.gl;
    // True angular size: disc radius (px) = tan(θ/2) / tan(fovy/2) · height/2. The sprite is larger
    // only to hold the (illustrative) glare halo around the true-size disc.
    const discPx = Math.max(
      1.5 * dpr,
      (Math.tan((sun.angularDiameterDeg * Math.PI) / 360) / tanHalf[1]) * (heightPx / 2),
    );
    const spritePx = Math.max(16 * dpr, discPx * 6);
    gl.useProgram(this.sunProgram);
    gl.uniformMatrix3fv(
      gl.getUniformLocation(this.sunProgram, 'u_icrfToEye'),
      false,
      glMat(icrfToEye),
    );
    gl.uniform2f(gl.getUniformLocation(this.sunProgram, 'u_tanHalf'), tanHalf[0], tanHalf[1]);
    gl.uniform1f(gl.getUniformLocation(this.sunProgram, 'u_size'), spritePx);
    gl.uniform1f(gl.getUniformLocation(this.sunProgram, 'u_discFraction'), discPx / (spritePx / 2));
    const loc = gl.getAttribLocation(this.sunProgram, 'a_dir');
    gl.bindVertexArray(null);
    gl.disableVertexAttribArray(loc);
    gl.vertexAttrib3f(loc, sun.directionIcrf[0], sun.directionIcrf[1], sun.directionIcrf[2]);
    gl.drawArrays(gl.POINTS, 0, 1);
  }

  private drawLabels(
    ctx: CanvasRenderingContext2D,
    icrfToEye: Mat3,
    tanHalf: readonly [number, number],
    w: number,
    h: number,
    dpr: number,
    alpha: number,
  ): void {
    ctx.font = `${11 * dpr}px "IBM Plex Sans", system-ui, sans-serif`;
    ctx.fillStyle = `rgba(200, 208, 220, ${0.75 * alpha})`;
    for (const b of this.bodies) {
      const e = apply(icrfToEye, b.directionIcrf);
      if (e[2] >= 0) continue;
      const x = ((e[0] / (-e[2] * tanHalf[0])) * 0.5 + 0.5) * w;
      const y = (0.5 - (e[1] / (-e[2] * tanHalf[1])) * 0.5) * h;
      if (x < 0 || y < 0 || x > w || y > h) continue;
      ctx.fillText(b.id, x + 6 * dpr, y - 6 * dpr);
    }
  }
}
