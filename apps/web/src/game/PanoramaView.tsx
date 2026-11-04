import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DATA_VERSION, dataUrl } from '../config';
import { PANORAMA_CREDIT, PANORAMAS } from '../data/catalog';
import { compileProgram, finishEquirectTexture } from '../render/gl';
import { PANORAMA_FS, PANORAMA_VS } from '../render/panoramaShader';

const RAD = Math.PI / 180;

/**
 * The real Mastcam-Z 360° panorama of a place, opened when the rover takes it (or from the
 * inventory): the same viewer geometry as the planner's (measured compass, horizon and mast tilt).
 * Drag or arrow keys to look, wheel or +/− to zoom.
 */
export function PanoramaView({
  id,
  startYawDeg,
  onClose,
}: {
  id: string;
  startYawDeg: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const pano = PANORAMAS.find((p) => p.id === id);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const g = pano?.geometry;
    if (!canvas || !pano || !g) return;
    const gl = canvas.getContext('webgl2', { antialias: false });
    if (!gl) {
      setFailed(true);
      return;
    }
    let disposed = false;
    let raf = 0;
    const view = { yawDeg: startYawDeg, pitch: -0.1, fovY: 65 * RAD };
    const program = compileProgram(gl, PANORAMA_VS, PANORAMA_FS);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture();
    const maskTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, maskTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    const uni = (name: string) => gl.getUniformLocation(program, name);
    const top = g.elevationDeg.top * RAD;
    const bottom = g.elevationDeg.bottom * RAD;
    let ready = false;

    const draw = () => {
      raf = 0;
      if (disposed || !ready) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(canvas.clientWidth * dpr);
      const h = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.useProgram(program);
      view.pitch = Math.min(35 * RAD, Math.max(bottom + view.fovY / 2, view.pitch));
      view.yawDeg = ((view.yawDeg % 360) + 360) % 360;
      const tanY = Math.tan(view.fovY / 2);
      gl.uniform1f(uni('u_yaw'), view.yawDeg * RAD);
      gl.uniform1f(uni('u_pitch'), view.pitch);
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
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, maskTex);
      gl.uniform1i(uni('u_mask'), 1);
      gl.activeTexture(gl.TEXTURE0);
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
        finishEquirectTexture(gl);
        ready = true;
        setLoaded(true);
        request();
      })
      .catch(() => !disposed && setFailed(true));
    const maskImg = new Image();
    maskImg.src = dataUrl(`${pano.file.replace('_8k.webp', '_mask.png')}?v=${DATA_VERSION}`);
    void maskImg.decode().then(
      () => {
        if (disposed) return;
        gl.bindTexture(gl.TEXTURE_2D, maskTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, maskImg);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        request();
      },
      () => {},
    );

    let drag: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      drag = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      const k = view.fovY / canvas.clientHeight;
      view.yawDeg -= ((e.clientX - drag.x) * k) / RAD;
      view.pitch += (e.clientY - drag.y) * k;
      drag = { x: e.clientX, y: e.clientY };
      request();
    };
    const onUp = () => {
      drag = null;
    };
    const zoom = (f: number) => {
      view.fovY = Math.min(90 * RAD, Math.max(12 * RAD, view.fovY * f));
      request();
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom(e.deltaY > 0 ? 1.1 : 1 / 1.1);
    };
    const onKey = (e: KeyboardEvent) => {
      const step = view.fovY / RAD / 6;
      if (e.key === 'ArrowLeft') view.yawDeg -= step;
      else if (e.key === 'ArrowRight') view.yawDeg += step;
      else if (e.key === 'ArrowUp') view.pitch += (step * RAD) / 2;
      else if (e.key === 'ArrowDown') view.pitch -= (step * RAD) / 2;
      else if (e.key === '+' || e.key === '=') zoom(1 / 1.15);
      else if (e.key === '-') zoom(1.15);
      else return;
      e.preventDefault();
      request();
    };
    // A slow look around until the player takes over.
    let auto = true;
    let lastT = performance.now();
    const spin = (now: number) => {
      if (disposed) return;
      const dt = (now - lastT) / 1000;
      lastT = now;
      if (auto && ready && !drag) {
        view.yawDeg += dt * 6;
        request();
      }
      requestAnimationFrame(spin);
    };
    const stopAuto = () => {
      auto = false;
    };
    requestAnimationFrame(spin);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerdown', stopAuto);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    window.addEventListener('keydown', stopAuto);
    window.addEventListener('resize', request);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerdown', stopAuto);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', stopAuto);
      window.removeEventListener('resize', request);
      gl.deleteTexture(tex);
      gl.deleteTexture(maskTex);
      gl.deleteProgram(program);
      gl.deleteBuffer(buf);
      gl.deleteVertexArray(vao);
    };
  }, [pano, startYawDeg]);

  if (!pano) return null;
  return (
    <div className="game-pano" role="dialog" aria-modal="true" aria-labelledby="game-pano-title">
      <canvas ref={canvasRef} aria-label={t('game.pano.view', { name: pano.title })} />
      <div className="game-panel game-pano-bar">
        <div className="game-panel-title">{t('game.pano.kicker')}</div>
        <h2 id="game-pano-title">{pano.title}</h2>
        <p className="meta">
          {t('game.pano.sols', { first: pano.sols[0], last: pano.sols[1], date: pano.date })} ·{' '}
          {PANORAMA_CREDIT} ({pano.reference})
        </p>
        <p>{t(`game.pano.about.${pano.id}`, { defaultValue: '' })}</p>
        <p className="meta">
          {failed ? t('game.pano.failed') : loaded ? t('game.pano.hint') : t('game.pano.loading')}
        </p>
        <button type="button" className="btn btn-primary" autoFocus onClick={onClose}>
          {t('game.pano.close')}
        </button>
      </div>
    </div>
  );
}
