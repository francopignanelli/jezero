import { elevationAngleDeg, greatCircleDistance, initialBearingDeg } from '@copernico/domain';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../app/store';
import { DATA_VERSION, dataUrl } from '../../config';
import { PANORAMA_CREDIT, PANORAMAS, POIS, type Panorama } from '../../data/catalog';
import { currentScene } from '../../render/sceneRegistry';
import { IconX } from '../../ui/icons';

const VS = `#version 300 es
in vec2 a_pos;
out vec2 v_ndc;
void main() { v_ndc = a_pos; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

// The mosaic is a cylinder: its width spans u_span of compass azimuth starting at u_az0 (growing to
// the right when u_dir = 1), rows are linear in elevation from u_top to u_bottom, and the mast tilt
// left in it is undone (photo elevation = true elevation + tilt). All measured by the pipeline.
// Above the photographed strip the sky continues as a plain gradient from the photo's top rows.
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

const RAD = Math.PI / 180;
const MAST_M = 2; // Mastcam-Z above the ground (as in the pipeline)

/** A place drawn inside the photo at its true direction. */
interface Target {
  key: string;
  kind: 'poi' | 'panorama';
  id: string;
  name: string;
  azimuthDeg: number;
  elevationDeg: number;
  distanceM: number;
  /** Terrain between the camera and the place hides it (it is labelled at its direction anyway). */
  hidden: boolean;
  /** A POI where another panorama was taken: its label carries a "360°" chip to walk there. */
  panoramaId?: string | undefined;
}

/** Stem lengths tried in turn (px), so labels of nearby places stagger instead of overlapping. */
const STEMS = [18, 44, 70, 96];

interface View {
  yawDeg: number;
  pitch: number;
  fovY: number;
}

/** Screen position (px) of a direction, or null when it is behind the viewer or off screen. */
function project(view: View, azDeg: number, elDeg: number, w: number, h: number) {
  const az = azDeg * RAD;
  const el = elDeg * RAD;
  // World direction in the shader's frame (north = −z, east = +x, up = +y), then undo yaw and pitch.
  let x = Math.cos(el) * Math.sin(az);
  let y = Math.sin(el);
  let z = -Math.cos(el) * Math.cos(az);
  const cy = Math.cos(view.yawDeg * RAD);
  const sy = Math.sin(view.yawDeg * RAD);
  [x, z] = [x * cy + z * sy, -x * sy + z * cy];
  const cp = Math.cos(view.pitch);
  const sp = Math.sin(view.pitch);
  [y, z] = [y * cp + z * sp, -y * sp + z * cp];
  if (z >= -1e-3) return null;
  const tanY = Math.tan(view.fovY / 2);
  const tanX = tanY * (w / h);
  const sx = (x / -z / tanX + 1) * 0.5 * w;
  const sy2 = (1 - y / -z / tanY) * 0.5 * h;
  if (sx < -40 || sx > w + 40 || sy2 < -40 || sy2 > h + 40) return null;
  return { x: sx, y: sy2 };
}

/** Places around a panorama with their true direction, elevation and terrain occlusion. */
async function targetsFor(pano: Panorama): Promise<Target[]> {
  const scene = currentScene();
  const g = pano.geometry;
  if (!scene || !g) return [];
  const origin = { lat: pano.position.lat, lon: pano.position.lon };
  const candidates = [
    ...POIS.filter((p) => p.id !== pano.poiId).map((p) => ({
      kind: 'poi' as const,
      id: p.id,
      name: p.name,
      lat: p.lat,
      lon: p.lon,
      maxM: 8_000,
    })),
    // Panoramas at a POI are reached through that POI's label; the others get their own label.
    ...PANORAMAS.filter((p) => p.id !== pano.id && !p.poiId).map((p) => ({
      kind: 'panorama' as const,
      id: p.id,
      name: p.title,
      lat: p.position.lat,
      lon: p.position.lon,
      maxM: 6_000,
    })),
  ]
    .map((c) => ({ ...c, d: greatCircleDistance(origin, c) }))
    .filter((c) => c.d > 30 && c.d <= c.maxM);
  // One batched terrain request: each place plus 24 points along the line of sight to it.
  const STEPS = 24;
  const points = candidates.flatMap((c) =>
    Array.from({ length: STEPS + 1 }, (_, i) => {
      const f = (i + 1) / (STEPS + 1);
      return {
        lat: origin.lat + (c.lat - origin.lat) * f,
        lon: origin.lon + (c.lon - origin.lon) * f,
      };
    }),
  );
  const heights = await scene.sampleTerrain(points);
  const camera = g.groundM + MAST_M;
  return candidates.map((c, k) => {
    const hs = heights.slice(k * (STEPS + 1), (k + 1) * (STEPS + 1));
    const target = hs[STEPS]! + 1.5; // a person-height point at the place
    const elevationDeg = elevationAngleDeg(c.d, camera, target);
    const hidden = hs
      .slice(0, STEPS)
      .some(
        (h, i) =>
          Number.isFinite(h) &&
          elevationAngleDeg((c.d * (i + 1)) / (STEPS + 1), camera, h) > elevationDeg + 0.05,
      );
    return {
      key: `${c.kind}:${c.id}`,
      kind: c.kind,
      id: c.id,
      name: c.name,
      azimuthDeg: initialBearingDeg(origin, c),
      elevationDeg,
      distanceM: c.d,
      hidden,
      ...(c.kind === 'poi'
        ? { panoramaId: PANORAMAS.find((p) => p.poiId === c.id && p.id !== pano.id)?.id }
        : {}),
    };
  });
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/**
 * Full-screen 360° viewer for real Mastcam-Z panoramas. The compass direction, horizon and mast tilt
 * are measured (skyline matched to the terrain horizon), so places nearby are drawn at their true
 * direction and other panoramas can be walked to. Drag or arrow keys to look, wheel or +/− to zoom.
 */
export function PanoramaViewer() {
  const { t } = useTranslation();
  const id = useApp((s) => s.panoramaOpen);
  const open = useApp((s) => s.setPanoramaOpen);
  const pano = PANORAMAS.find((p) => p.id === id);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const tapeRef = useRef<HTMLDivElement>(null);
  const view = useRef<View>({ yawDeg: 0, pitch: 0, fovY: 60 * RAD });
  const wasOpen = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [targets, setTargets] = useState<Target[]>([]);
  const targetsRef = useRef<Target[]>([]);
  targetsRef.current = targets;
  const redraw = useRef<() => void>(() => {});

  // Opening from the map looks the way the 3D camera was looking; walking keeps the heading.
  if (pano && !wasOpen.current) {
    view.current.yawDeg = currentScene()?.cameraHeadingDeg() ?? 0;
    view.current.pitch = 0;
  }
  wasOpen.current = !!pano;

  useEffect(() => {
    if (!pano) return;
    let cancelled = false;
    setTargets([]);
    void targetsFor(pano).then((list) => {
      if (!cancelled) setTargets(list);
    });
    return () => {
      cancelled = true;
    };
  }, [pano]);

  useEffect(() => {
    redraw.current();
  }, [targets]);

  useEffect(() => {
    const g = pano?.geometry;
    if (!pano || !g) return;
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
    const top = g.elevationDeg.top * RAD;
    const bottom = g.elevationDeg.bottom * RAD;
    const uni = (name: string) => gl.getUniformLocation(program, name);

    const placeOverlay = (w: number, h: number) => {
      const v = view.current;
      const overlay = overlayRef.current;
      if (overlay) {
        // Greedy placement: visible places first, nearer first; each tries a few stem lengths.
        const els = new Map(
          (Array.from(overlay.children) as HTMLElement[]).map((el) => [el.dataset.key, el]),
        );
        const order = [...targetsRef.current].sort(
          (a, b) => Number(a.hidden) - Number(b.hidden) || a.distanceM - b.distanceM,
        );
        const taken: Array<[number, number, number, number]> = [];
        for (const tg of order) {
          const el = els.get(tg.key);
          if (!el) continue;
          el.style.visibility = 'hidden';
          const s = project(v, tg.azimuthDeg, tg.elevationDeg, w, h);
          if (!s) continue;
          const bw = el.offsetWidth;
          const bh = el.offsetHeight;
          for (const stem of STEMS) {
            const box: [number, number, number, number] = [
              s.x - bw / 2 - 4,
              s.y - stem - bh - 3,
              s.x + bw / 2 + 4,
              s.y - stem + 3,
            ];
            if (taken.some((t) => box[0] < t[2] && box[2] > t[0] && box[1] < t[3] && box[3] > t[1]))
              continue;
            taken.push(box);
            el.style.visibility = 'visible';
            el.style.setProperty('--stem', `${stem}px`);
            el.style.transform = `translate3d(${Math.round(s.x)}px, ${Math.round(s.y)}px, 0)`;
            break;
          }
        }
      }
      const tape = tapeRef.current;
      if (tape) {
        const hfov = (2 * Math.atan(Math.tan(v.fovY / 2) * (w / h))) / RAD;
        for (const el of Array.from(tape.children) as HTMLElement[]) {
          const az = Number(el.dataset.az);
          const delta = ((az - v.yawDeg + 540) % 360) - 180;
          const visible = Math.abs(delta) < hfov / 2;
          el.style.visibility = visible ? 'visible' : 'hidden';
          if (visible) el.style.left = `${50 + (delta / hfov) * 100}%`;
        }
      }
    };

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
      v.pitch = Math.min(35 * RAD, Math.max(bottom + v.fovY / 2, v.pitch));
      v.yawDeg = ((v.yawDeg % 360) + 360) % 360;
      const tanY = Math.tan(v.fovY / 2);
      gl.uniform1f(uni('u_yaw'), v.yawDeg * RAD);
      gl.uniform1f(uni('u_pitch'), v.pitch);
      gl.uniform2f(uni('u_tanHalf'), tanY * (w / h), tanY);
      gl.uniform1f(uni('u_top'), top);
      gl.uniform1f(uni('u_bottom'), bottom);
      gl.uniform1f(uni('u_az0'), g.azimuthAtLeftDeg * RAD);
      gl.uniform1f(uni('u_dir'), g.direction);
      gl.uniform1f(uni('u_span'), g.spanDeg * RAD);
      gl.uniform1f(uni('u_tilt'), g.tiltDeg * RAD);
      gl.uniform1f(uni('u_tiltAz'), g.tiltTowardAzimuthDeg * RAD);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(uni('u_pano'), 0);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      placeOverlay(canvas.clientWidth, canvas.clientHeight);
    };
    const request = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };
    redraw.current = request;

    setLoaded(false);
    setFailed(false);
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
      v.yawDeg -= ((e.clientX - drag.x) * k) / RAD;
      v.pitch += (e.clientY - drag.y) * k;
      drag = { x: e.clientX, y: e.clientY };
      request();
    };
    const onUp = () => {
      drag = null;
    };
    const zoom = (factor: number) => {
      const v = view.current;
      v.fovY = Math.min(80 * RAD, Math.max(8 * RAD, v.fovY * factor));
      request();
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom(e.deltaY > 0 ? 1.1 : 1 / 1.1);
    };
    const onKey = (e: KeyboardEvent) => {
      const v = view.current;
      const step = v.fovY / 8;
      if (e.key === 'Escape') open(null);
      else if (e.key === 'ArrowLeft') v.yawDeg -= step / RAD;
      else if (e.key === 'ArrowRight') v.yawDeg += step / RAD;
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
      redraw.current = () => {};
      if (raf) cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', request);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, [pano, open]);

  if (!pano || !pano.geometry) return null;
  const g = pano.geometry;
  const solText =
    pano.sols[0] === pano.sols[1] ? `${pano.sols[0]}` : `${pano.sols[0]}–${pano.sols[1]}`;
  const km = (m: number) =>
    m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
  const showPoi = (poiId: string) => {
    const s = useApp.getState();
    open(null);
    s.selectPoi(poiId);
    s.setTab('science');
  };
  return (
    <div className="pano" role="dialog" aria-modal="true" aria-labelledby="pano-title">
      <canvas
        // A fresh canvas per panorama: the previous one's WebGL context is released on cleanup, and
        // getContext() on the same element would hand back that lost context (a black view).
        key={pano.id}
        ref={canvasRef}
        className="pano-canvas"
        tabIndex={0}
        aria-label={t('panorama.canvasLabel')}
      />
      <div className="pano-tape" ref={tapeRef} aria-hidden="true">
        {Array.from({ length: 24 }, (_, i) => i * 15).map((az) => (
          <span
            key={az}
            data-az={az}
            className={az % 45 === 0 ? 'pano-tick pano-tick-major' : 'pano-tick'}
          >
            {az % 45 === 0 ? COMPASS[az / 45] : az}
          </span>
        ))}
      </div>
      <div className="pano-overlay" ref={overlayRef}>
        {targets.map((tg) =>
          tg.kind === 'panorama' ? (
            <button
              key={tg.key}
              data-key={tg.key}
              type="button"
              className={`pano-label pano-label-walk${tg.hidden ? ' pano-label-hidden' : ''}`}
              onClick={() => open(tg.id)}
            >
              <span className="pano-label-dot" aria-hidden="true" />
              {t('panorama.walkTo', { name: tg.name, distance: km(tg.distanceM) })}
            </button>
          ) : (
            <button
              key={tg.key}
              data-key={tg.key}
              type="button"
              className={`pano-label${tg.hidden ? ' pano-label-hidden' : ''}`}
              onClick={() => showPoi(tg.id)}
            >
              <span className="pano-label-dot" aria-hidden="true" />
              {tg.name} · {km(tg.distanceM)}
              {tg.hidden && (
                <span className="pano-label-note"> · {t('panorama.behindTerrain')}</span>
              )}
              {tg.panoramaId && (
                <span
                  className="annotation-chip"
                  role="link"
                  onClick={(e) => {
                    e.stopPropagation();
                    open(tg.panoramaId!);
                  }}
                >
                  360°
                </span>
              )}
            </button>
          ),
        )}
      </div>
      {!loaded && !failed && <p className="pano-status">{t('panorama.loading')}</p>}
      {failed && <p className="pano-status">{t('panorama.failed')}</p>}
      <div className="pano-caption">
        <div>
          <h2 id="pano-title">{pano.title}</h2>
          <p>{t('panorama.caption', { sols: solText, date: pano.date })}</p>
          <p className="meta">
            {PANORAMA_CREDIT} · {pano.reference} · {t('panorama.hint')}
          </p>
          <p className="meta">
            {t('panorama.measured', { residual: g.medianResidualDeg.toFixed(2) })}
          </p>
        </div>
        <button
          type="button"
          className="popover-close"
          aria-label={t('panorama.close')}
          onClick={() => open(null)}
        >
          <IconX />
        </button>
      </div>
    </div>
  );
}
