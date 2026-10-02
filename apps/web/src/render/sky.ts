import {
  apply,
  icrfToMarsFixed,
  mul,
  raDecToVector,
  solarSystemFromMars,
  type Mat3,
  type SkyBody,
} from '@copernico/domain';

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
const float PI = 3.141592653589793;
const float BLACK_POINT = 0.035;
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
  // Illustrative daytime Mars sky (dust-scattered light): brighter, warmer toward the horizon.
  vec3 w = u_eyeToWorld * dEye;
  float h = clamp(dot(normalize(w), u_up), -1.0, 1.0);
  vec3 sky = mix(vec3(0.62, 0.47, 0.33), vec3(0.20, 0.15, 0.12), smoothstep(0.0, 0.9, h));
  outColor = vec4(mix(mw * (1.0 - u_day), sky, u_day), 1.0);
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

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const make = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, make(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  return p;
}

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
    this.skyProgram = compile(gl, SKY_VS, SKY_FS);
    this.starProgram = compile(gl, STAR_VS, STAR_FS);
    this.sunProgram = compile(gl, SUN_VS, SUN_FS);

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
   * Progressive load: resolves once the star catalog and the 4K Milky Way (2.7 MB) are on the GPU,
   * so the scene can be revealed quickly. If the GPU supports 8K, the HD texture then loads in the
   * background and cross-fades in; `onQuality('hd')` reports the upgrade. Positions are identical
   * in both textures; only the detail changes.
   */
  async load(
    starsUrl: string,
    milkyWay: { hd: string; sd: string },
    onQuality?: (quality: SkyQuality) => void,
  ): Promise<{ stars: boolean; quality: SkyQuality }> {
    const target = this.chooseQuality();
    const [starFile, sd] = await Promise.all([
      fetch(starsUrl).then((r) => (r.ok ? (r.json() as Promise<StarFile>) : null)),
      loadImage(milkyWay.sd),
    ]);
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
        void this.upgrade(milkyWay.hd, onQuality);
      }
    }
    this.gl.finish(); // the first texture is on the GPU before the scene is revealed
    return { stars: starFile !== null, quality };
  }

  private async upgrade(url: string, onQuality?: (quality: SkyQuality) => void): Promise<void> {
    const image = await loadImage(url);
    if (!image || this.destroyed) return;
    const texture = this.upload(image);
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
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) {
      const max = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number;
      gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, max));
    }
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
    const day = smoothstep(-0.1, 0.15, sunUp) * lowAltitude;

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
      gl.uniform1f(gl.getUniformLocation(this.skyProgram, 'u_gain'), 0.5);
      gl.uniform1f(gl.getUniformLocation(this.skyProgram, 'u_day'), day * 0.85);
      gl.uniform3f(gl.getUniformLocation(this.skyProgram, 'u_up'), ...view.up);
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

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
