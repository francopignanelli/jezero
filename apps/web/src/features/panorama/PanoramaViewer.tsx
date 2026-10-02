import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../app/store';
import { DATA_VERSION, dataUrl } from '../../config';
import { PANORAMAS } from '../../data/catalog';
import { IconX } from '../../ui/icons';

const VS = `#version 300 es
in vec2 a_pos;
out vec2 v_ndc;
void main() { v_ndc = a_pos; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

// The mosaic is an equirectangular strip: 360° of azimuth from u_top down to u_bottom elevation
// (level horizon estimated in the catalog). Each screen pixel's view ray is mapped to (azimuth,
// elevation). Above the strip the sky continues as a plain gradient from the photo's top rows.
const FS = `#version 300 es
precision highp float;
in vec2 v_ndc;
out vec4 outColor;
uniform sampler2D u_pano;
uniform float u_yaw;
uniform float u_pitch;
uniform vec2 u_tanHalf;
uniform float u_top;
uniform float u_bottom;
const float PI = 3.141592653589793;
void main() {
  vec3 d = normalize(vec3(v_ndc.x * u_tanHalf.x, v_ndc.y * u_tanHalf.y, -1.0));
  float cp = cos(u_pitch), sp = sin(u_pitch);
  // Positive pitch looks up.
  d = vec3(d.x, d.y * cp - d.z * sp, d.y * sp + d.z * cp);
  float cy = cos(u_yaw), sy = sin(u_yaw);
  d = vec3(d.x * cy - d.z * sy, d.y, d.x * sy + d.z * cy);
  float az = atan(d.x, -d.z);
  float el = asin(clamp(d.y, -1.0, 1.0));
  vec2 uv = vec2(fract(az / (2.0 * PI) + 0.5), (u_top - el) / (u_top - u_bottom));
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
    outColor = vec4(0.18, 0.14, 0.11, 1.0);
    return;
  }
  vec3 photo = textureGrad(u_pano, uv, gx, gy).rgb;
  // Feather the top 3% of the photo into the extrapolated sky so there is no seam.
  if (uv.y < 0.03) photo = mix(textureLod(u_pano, vec2(uv.x, 0.0), 6.0).rgb, photo, smoothstep(0.0, 0.03, uv.y));
  outColor = vec4(photo, 1.0);
}`;

function compile(gl: WebGL2RenderingContext): WebGLProgram {
  const make = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, make(gl.VERTEX_SHADER, VS));
  gl.attachShader(p, make(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  return p;
}

/**
 * Full-screen 360° viewer for a real Mastcam-Z panorama. Drag (or arrow keys) to look around,
 * wheel or +/− to zoom. The image is shown as published; only the viewing geometry is computed.
 */
export function PanoramaViewer() {
  const { t } = useTranslation();
  const id = useApp((s) => s.panoramaOpen);
  const close = useApp((s) => s.setPanoramaOpen);
  const pano = PANORAMAS.find((p) => p.id === id);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef({ yaw: 0, pitch: 0, fovY: (60 * Math.PI) / 180 });
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!pano) return;
    const canvas = canvasRef.current!;
    const gl = canvas.getContext('webgl2', { antialias: false });
    if (!gl) {
      setFailed(true);
      return;
    }
    let raf = 0;
    let disposed = false;
    const program = compile(gl);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture();
    const top = (pano.elevationDeg.top * Math.PI) / 180;
    const bottom = (pano.elevationDeg.bottom * Math.PI) / 180;

    const draw = () => {
      raf = 0;
      if (disposed) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(canvas.clientWidth * dpr);
      const h = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.useProgram(program);
      const v = view.current;
      // Never below the photographed strip; up to 35° above the horizon (sky gradient beyond the photo).
      v.pitch = Math.min((35 * Math.PI) / 180, Math.max(bottom + v.fovY / 2, v.pitch));
      const tanY = Math.tan(v.fovY / 2);
      gl.uniform1f(gl.getUniformLocation(program, 'u_yaw'), v.yaw);
      gl.uniform1f(gl.getUniformLocation(program, 'u_pitch'), v.pitch);
      gl.uniform2f(gl.getUniformLocation(program, 'u_tanHalf'), tanY * (w / h), tanY);
      gl.uniform1f(gl.getUniformLocation(program, 'u_top'), top);
      gl.uniform1f(gl.getUniformLocation(program, 'u_bottom'), bottom);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(gl.getUniformLocation(program, 'u_pano'), 0);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    const request = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };

    const img = new Image();
    img.decoding = 'async';
    img.src = dataUrl(`${pano.file}?v=${DATA_VERSION}`);
    img
      .decode()
      .then(() => {
        if (disposed) return;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
        if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
        setLoaded(true);
        request();
      })
      .catch(() => setFailed(true));

    // Interaction: drag to look, wheel to zoom, keyboard for both.
    let drag: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      drag = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      const v = view.current;
      const k = v.fovY / canvas.clientHeight;
      v.yaw -= (e.clientX - drag.x) * k;
      v.pitch += (e.clientY - drag.y) * k;
      drag = { x: e.clientX, y: e.clientY };
      request();
    };
    const onUp = () => {
      drag = null;
    };
    const zoom = (factor: number) => {
      const v = view.current;
      v.fovY = Math.min((80 * Math.PI) / 180, Math.max((12 * Math.PI) / 180, v.fovY * factor));
      request();
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom(e.deltaY > 0 ? 1.1 : 1 / 1.1);
    };
    const onKey = (e: KeyboardEvent) => {
      const v = view.current;
      const step = v.fovY / 8;
      if (e.key === 'Escape') close(null);
      else if (e.key === 'ArrowLeft') v.yaw -= step;
      else if (e.key === 'ArrowRight') v.yaw += step;
      else if (e.key === 'ArrowUp') v.pitch += step;
      else if (e.key === 'ArrowDown') v.pitch -= step;
      else if (e.key === '+' || e.key === '=') zoom(1 / 1.15);
      else if (e.key === '-') zoom(1.15);
      else return;
      e.preventDefault();
      request();
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', request);
    canvas.focus();
    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', request);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      setLoaded(false);
    };
  }, [pano, close]);

  if (!pano) return null;
  return (
    <div className="pano" role="dialog" aria-modal="true" aria-labelledby="pano-title">
      <canvas
        ref={canvasRef}
        className="pano-canvas"
        tabIndex={0}
        aria-label={t('panorama.canvasLabel')}
      />
      {!loaded && !failed && <p className="pano-status">{t('panorama.loading')}</p>}
      {failed && <p className="pano-status">{t('panorama.failed')}</p>}
      <div className="pano-caption">
        <div>
          <h2 id="pano-title">{pano.title}</h2>
          <p>
            {t('panorama.caption', {
              instrument: pano.instrument,
              images: pano.images,
              sol: pano.sol,
              date: pano.date,
            })}
          </p>
          <p className="meta">
            {pano.credit} · {pano.photojournal} · {t('panorama.hint')}
          </p>
          <p className="meta">{t('panorama.limits')}</p>
        </div>
        <button
          type="button"
          className="popover-close"
          aria-label={t('panorama.close')}
          onClick={() => close(null)}
        >
          <IconX />
        </button>
      </div>
    </div>
  );
}
