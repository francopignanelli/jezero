import { useEffect, useRef } from 'react';
import { DATA_VERSION, dataUrl } from '../config';

/** Canvas size (CSS px) and geometry of the loader. */
const W = 440;
const H = 330;
const R = 132; // planet radius
const CX = W / 2;
const CY = H / 2;
const RING = { rx: 206, ry: 52, tilt: (-14 * Math.PI) / 180 };
const ORBIT_S = 5.5; // seconds per orbit of the satellite
const SPIN_S = 90; // seconds per planet rotation (display, not Mars's real 24.6 h)

const VS = `#version 300 es
in vec2 a_pos;
out vec2 v;
void main() { v = a_pos * ${(1.18).toFixed(2)}; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

// A lit sphere textured with the whole-planet Viking + MOLA relief map, with a soft dusty rim and a
// faint halo just outside the disc. Light from the upper left, as in the reference image.
const FS = `#version 300 es
precision highp float;
in vec2 v;
out vec4 o;
uniform sampler2D u_map;
uniform float u_rot;
uniform float u_ready;
const float PI = 3.141592653589793;
const vec3 L = normalize(vec3(-0.62, 0.48, 0.62));
const vec3 RIM = vec3(1.0, 0.56, 0.30);
void main() {
  float r2 = dot(v, v);
  vec2 dir = normalize(v + 1e-6);
  float lit2d = clamp(dot(dir, normalize(L.xy)) * 0.5 + 0.5, 0.0, 1.0);
  if (r2 > 1.0) {
    float d = sqrt(r2) - 1.0;
    float halo = exp(-d * 22.0) * (0.15 + 0.85 * lit2d * lit2d) * 0.55;
    o = vec4(RIM * halo, halo);
    return;
  }
  vec3 n = vec3(v, sqrt(1.0 - r2));
  // Axial tilt toward the viewer's upper right (25°, as Mars), then spin.
  float t = radians(25.0);
  vec3 a = vec3(n.x * cos(t) - n.y * sin(t), n.x * sin(t) + n.y * cos(t), n.z);
  float lon = atan(a.x, a.z) + u_rot;
  float lat = asin(clamp(a.y, -1.0, 1.0));
  vec2 uv = vec2(fract(lon / (2.0 * PI) + 0.5), 0.5 - lat / PI);
  vec3 base = mix(vec3(0.62, 0.30, 0.17), pow(texture(u_map, uv).rgb, vec3(0.9)) * 1.32, u_ready);
  float diff = max(dot(n, L), 0.0);
  float shade = 0.035 + 1.08 * pow(diff, 0.85);
  vec3 col = base * shade;
  // Dust in the limb on the lit side, and a soft edge so the disc is antialiased.
  float fres = pow(1.0 - n.z, 3.0);
  col += RIM * fres * (0.25 + 0.75 * smoothstep(0.0, 0.6, diff)) * 0.55;
  float edge = smoothstep(1.0, 0.985, sqrt(r2));
  o = vec4(col * edge, edge);
}`;

function planetRenderer(size: number) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false });
  if (!gl) return null;
  const make = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, make(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, make(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const tex = gl.createTexture();
  let ready = 0;
  const img = new Image();
  img.src = dataUrl(`sky/mars_globe_2k.webp?v=${DATA_VERSION}`);
  void img.decode().then(() => {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    ready = performance.now();
  });
  return {
    canvas,
    draw(rot: number) {
      gl.viewport(0, 0, size, size);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(prog);
      gl.uniform1f(gl.getUniformLocation(prog, 'u_rot'), rot);
      // The texture fades in over 0.6 s once decoded (a plain Mars tone before).
      gl.uniform1f(
        gl.getUniformLocation(prog, 'u_ready'),
        ready ? Math.min(1, (performance.now() - ready) / 600) : 0,
      );
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    dispose() {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}

/** Point on the tilted orbit ellipse at parameter t; z > 0 is in front of the planet. */
function orbitPoint(t: number): [number, number, number] {
  const x = RING.rx * Math.cos(t);
  const y = RING.ry * Math.sin(t);
  const c = Math.cos(RING.tilt);
  const s = Math.sin(RING.tilt);
  return [CX + x * c - y * s, CY + x * s + y * c, Math.sin(t)];
}

/**
 * Rotating Mars with an orbiting satellite as the loading animation. The orbit's far half passes
 * behind the planet (drawn before it), the near half in front (drawn after it).
 */
export function PlanetLoader() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    const planetPx = Math.round(2 * R * 1.18 * dpr);
    const planet = planetRenderer(planetPx);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t0 = performance.now();
    let raf = 0;

    const SEG = 220;
    const TRAIL = 1.9; // radians of glowing trail behind the satellite
    const drawRing = (front: boolean, dot: number) => {
      ctx.lineCap = 'round';
      for (let i = 0; i < SEG; i++) {
        const a0 = (i / SEG) * 2 * Math.PI;
        const a1 = ((i + 1) / SEG) * 2 * Math.PI;
        const [x0, y0, z0] = orbitPoint(a0);
        const [x1, y1] = orbitPoint(a1);
        if (z0 > 0 !== front) continue;
        const behind = (((dot - a0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const trail = behind < TRAIL ? (1 - behind / TRAIL) ** 2 : 0;
        ctx.strokeStyle = `rgba(255, 236, 214, ${0.2 + 0.75 * trail})`;
        ctx.lineWidth = 1 + 1.2 * trail;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
    };
    const drawSatellite = (t: number) => {
      const [x, y] = orbitPoint(t);
      const g = ctx.createRadialGradient(x, y, 0, x, y, 13);
      g.addColorStop(0, 'rgba(255, 255, 255, 1)');
      g.addColorStop(0.35, 'rgba(255, 238, 220, 0.75)');
      g.addColorStop(1, 'rgba(255, 220, 190, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, 13, 0, 2 * Math.PI);
      ctx.fill();
    };

    const frame = () => {
      const s = reduced ? 0 : (performance.now() - t0) / 1000;
      const dot = (s / ORBIT_S) * 2 * Math.PI + 2.4;
      const dotFront = Math.sin(dot) > 0;
      ctx.clearRect(0, 0, W, H);
      drawRing(false, dot);
      if (!dotFront) drawSatellite(dot);
      if (planet) {
        planet.draw((s / SPIN_S) * 2 * Math.PI);
        const size = 2 * R * 1.18;
        ctx.drawImage(planet.canvas, CX - size / 2, CY - size / 2, size, size);
      } else {
        const g = ctx.createRadialGradient(CX - R * 0.35, CY - R * 0.35, R * 0.1, CX, CY, R);
        g.addColorStop(0, '#f0a06a');
        g.addColorStop(0.55, '#b5562f');
        g.addColorStop(1, '#2a120a');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(CX, CY, R, 0, 2 * Math.PI);
        ctx.fill();
      }
      drawRing(true, dot);
      if (dotFront) drawSatellite(dot);
      if (!reduced) raf = requestAnimationFrame(frame);
    };
    frame();
    // With reduced motion the first frame is drawn once; redraw when the texture has faded in.
    const still = reduced ? window.setTimeout(frame, 1500) : 0;
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(still);
      planet?.dispose();
    };
  }, []);

  return (
    <canvas
      ref={ref}
      className="loading-planet"
      style={{ width: W, height: H }}
      aria-hidden="true"
    />
  );
}
