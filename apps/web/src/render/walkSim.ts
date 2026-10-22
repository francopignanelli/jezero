import {
  CallbackPositionProperty,
  CallbackProperty,
  Cartesian3,
  Cartographic,
  type CesiumWidget,
  Color,
  ColorMaterialProperty,
  EasingFunction,
  type Ellipsoid,
  Entity,
  HeadingPitchRange,
  Math as CesiumMath,
  Matrix4,
  PolylineGlowMaterialProperty,
} from 'cesium';
import { normalizeLon180 } from '@copernico/domain';
import { pointAt, type Track } from '../lib/routeTrack';
import { flightPeak } from './flight';
import { smoothstep } from '../lib/math';

/**
 * Cinematic walk simulation along a computed route. Everything moves inside the render loop
 * (CallbackProperty entities, camera set every frame), so the crew marker, its trail and the camera
 * stay in lockstep at the display frame rate.
 *
 * Motion: progress follows a speed profile (slow start, slowing near each stop and at the end), so
 * it accelerates and decelerates instead of moving at a constant rate. The camera follows with
 * frame-rate-independent exponential smoothing of its target, heading and terrain clearance.
 * Display choices only: the HUD reports the planner's real walking times.
 */

export interface WalkContext {
  widget: CesiumWidget;
  ellipsoid: Ellipsoid;
  suspend(on: boolean): void;
  requestRender(): void;
  /** Frames the whole route at the end. */
  frameRoute(): Promise<void>;
}

export interface WalkSpec {
  /** Draped route (metres above the areoid, as drawn). */
  track: Track;
  /** Distances along `track` (m) of the intermediate stops and the end. */
  stops: number[];
  /** Seconds for the walk itself (the intro flight and the final framing come on top). */
  durationS: number;
  onFrame(frame: WalkFrame): void;
}

export interface WalkFrame {
  phase: 'intro' | 'walk' | 'arrive' | 'outro';
  distanceM: number;
  fraction: number;
  /** Index into `stops` of the stop just reached (one frame), else null. */
  arrived: number | null;
}

export interface WalkRun {
  done: Promise<boolean>;
  stop(): void;
  setPaused(paused: boolean): void;
}

const LOOK_AHEAD_M = 170;
const RANGE_M = 430;
const PITCH_DEG = -21;
const MIN_CLEARANCE_M = 70;
const SLOW_NEAR_STOP_M = 90;
const HOLD_AT_STOP_S = 0.8;

/** Fraction of the remaining gap to close this frame for a time constant tau (frame-rate free). */
const follow = (dt: number, tau: number) => 1 - Math.exp(-dt / tau);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/**
 * Start time of the frame being rendered (the rAF timestamp), not the moment this code runs: steps
 * are then proportional to the time between displayed frames, whatever work came earlier in the frame.
 */
const frameTime = () => {
  const t = document.timeline?.currentTime;
  return typeof t === 'number' ? t : performance.now();
};

/**
 * Time-to-distance table: walking eases in at the start, slows nearly to a halt at each intermediate
 * stop and holds there HOLD_AT_STOP_S, and eases out at the end. `durationS` includes the holds.
 */
export function speedTable(totalM: number, stops: number[], durationS: number) {
  const step = 4;
  const n = Math.max(2, Math.ceil(totalM / step) + 1);
  const dist = new Float64Array(n);
  const time = new Float64Array(n);
  const inner = stops.filter((s) => s > step && s < totalM - step).sort((a, b) => a - b);
  const speed = (d: number) => {
    let near = 0;
    for (const s of inner)
      near = Math.max(near, 1 - smoothstep(0, SLOW_NEAR_STOP_M, Math.abs(d - s)));
    const ends = Math.min(smoothstep(0, 180, d), smoothstep(totalM, totalM - 180, d));
    return (0.12 + 0.88 * ends) * (1 - 0.92 * near);
  };
  for (let i = 1; i < n; i++) {
    dist[i] = Math.min(totalM, i * step);
    const a = speed(dist[i - 1]!);
    const b = speed(dist[i]!);
    time[i] = time[i - 1]! + ((dist[i]! - dist[i - 1]!) * (1 / a + 1 / b)) / 2;
  }
  const holdS = Math.min(HOLD_AT_STOP_S, (0.25 * durationS) / Math.max(1, inner.length));
  const scale = (durationS - holdS * inner.length) / (time[n - 1]! || 1);
  for (let i = 0; i < n; i++) time[i] = time[i]! * scale;
  const walkTime = n - 1;
  const timeAt = (d: number) => {
    const i = Math.min(n - 2, Math.floor(d / step));
    const f = (d - dist[i]!) / (dist[i + 1]! - dist[i]! || 1);
    return time[i]! + (time[i + 1]! - time[i]!) * f;
  };
  // Walking-clock time at which each stop is reached; the clock stands still for the hold.
  const arrive = inner.map(timeAt);
  return (t: number): number => {
    let w = t;
    arrive.forEach((a, i) => {
      const start = a + i * holdS;
      if (t > start) w -= Math.min(holdS, t - start);
    });
    if (w <= 0) return 0;
    if (w >= time[walkTime]!) return totalM;
    let lo = 0;
    let hi = walkTime;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (time[mid]! <= w) lo = mid;
      else hi = mid;
    }
    const f = (w - time[lo]!) / (time[hi]! - time[lo]! || 1);
    return dist[lo]! + (dist[hi]! - dist[lo]!) * f;
  };
}

function canvas(size: number, draw: (g: CanvasRenderingContext2D, c: number) => void) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size / 2);
  return c;
}
const GLOW = () =>
  canvas(128, (g, c) => {
    const r = g.createRadialGradient(c, c, 0, c, c, c);
    r.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    r.addColorStop(0.18, 'rgba(160, 255, 236, 0.85)');
    r.addColorStop(0.45, 'rgba(70, 230, 200, 0.28)');
    r.addColorStop(1, 'rgba(70, 230, 200, 0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 2 * c, 2 * c);
  });
/** Crew marker: solid dot in a white ring over a soft dark shadow (reads on light and dark ground). */
const DOT = () =>
  canvas(64, (g, c) => {
    const shadow = g.createRadialGradient(c, c, 14, c, c, c);
    shadow.addColorStop(0, 'rgba(0, 0, 0, 0.45)');
    shadow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = shadow;
    g.fillRect(0, 0, 2 * c, 2 * c);
    g.beginPath();
    g.arc(c, c, 19, 0, 2 * Math.PI);
    g.fillStyle = '#ffffff';
    g.fill();
    g.beginPath();
    g.arc(c, c, 13, 0, 2 * Math.PI);
    g.fillStyle = '#14c79c';
    g.fill();
  });
const RING = () =>
  canvas(128, (g, c) => {
    g.beginPath();
    g.arc(c, c, c - 6, 0, 2 * Math.PI);
    g.lineWidth = 5;
    g.strokeStyle = 'rgba(255, 255, 255, 1)';
    g.stroke();
  });
/**
 * Heading beam: a soft wedge opening forward from the centre. Billboards rotate about their centre,
 * so the wedge starts there and the lower half stays empty.
 */
const BEAM = () =>
  canvas(256, (g, c) => {
    const half = CesiumMath.toRadians(30);
    const fade = g.createRadialGradient(c, c, 0, c, c, c);
    fade.addColorStop(0, 'rgba(110, 250, 220, 0.75)');
    fade.addColorStop(0.55, 'rgba(110, 250, 220, 0.28)');
    fade.addColorStop(1, 'rgba(110, 250, 220, 0)');
    g.beginPath();
    g.moveTo(c, c);
    g.arc(c, c, c, -Math.PI / 2 - half, -Math.PI / 2 + half);
    g.closePath();
    g.fillStyle = fade;
    g.fill();
  });

export function startWalk(ctx: WalkContext, spec: WalkSpec): WalkRun {
  const { widget, ellipsoid } = ctx;
  const camera = widget.camera;
  const scene = widget.scene;
  const { track } = spec;
  const total = track.totalM;
  const at = (d: number) => {
    const p = pointAt(track, Math.min(total, Math.max(0, d)));
    return Cartesian3.fromDegrees(normalizeLon180(p.lon), p.lat, p.heightM + 1.5, ellipsoid);
  };
  const cartesians = track.points.map((p) =>
    Cartesian3.fromDegrees(normalizeLon180(p.lon), p.lat, p.heightM + 0.5, ellipsoid),
  );
  const distanceAt = speedTable(total, spec.stops, spec.durationS);

  let d = 0; // distance walked (m)
  let t = 0; // walk clock (s)
  let clock = 0; // wall clock for pulses (s)
  let paused = false;
  let stopped = false;
  let phase: WalkFrame['phase'] = 'intro';
  let nextStop = 0;
  const walker = at(0);

  // ---- entities ----
  const entities: Entity[] = [];
  const add = (e: Entity) => {
    entities.push(e);
    widget.entities.add(e);
    return e;
  };
  const walkerPos = new CallbackPositionProperty(() => walker, false);
  const always = Number.POSITIVE_INFINITY;
  const trailPositions = new CallbackProperty(() => {
    // Track vertices behind the walker, then the walker itself.
    let lo = 0;
    let hi = track.cumM.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (track.cumM[mid]! <= d) lo = mid;
      else hi = mid;
    }
    const pts = cartesians.slice(0, lo + 1);
    pts.push(walker);
    return pts;
  }, false);
  add(
    new Entity({
      polyline: {
        positions: trailPositions,
        width: 22,
        material: new PolylineGlowMaterialProperty({
          color: Color.fromCssColorString('#5cf5d2'),
          glowPower: 0.2,
          taperPower: 1,
        }),
        depthFailMaterial: new PolylineGlowMaterialProperty({
          color: Color.fromCssColorString('#5cf5d2').withAlpha(0.5),
          glowPower: 0.2,
          taperPower: 1,
        }),
      },
    }),
  );
  add(
    new Entity({
      polyline: {
        positions: trailPositions,
        width: 3,
        material: new ColorMaterialProperty(Color.WHITE.withAlpha(0.95)),
        depthFailMaterial: new ColorMaterialProperty(Color.WHITE.withAlpha(0.5)),
      },
    }),
  );
  const glow = GLOW();
  add(
    new Entity({
      position: walkerPos,
      billboard: {
        image: glow,
        width: new CallbackProperty(() => 58 + 6 * Math.sin(clock * 2.1), false),
        height: new CallbackProperty(() => 58 + 6 * Math.sin(clock * 2.1), false),
        disableDepthTestDistance: always,
      },
    }),
  );
  // One slow ping, eased out: expands fast, then lingers as it fades.
  const ring = RING();
  const ping = () => EasingFunction.QUADRATIC_OUT((clock % 2.4) / 2.4);
  add(
    new Entity({
      position: walkerPos,
      billboard: {
        image: ring,
        width: new CallbackProperty(() => 18 + 64 * ping(), false),
        height: new CallbackProperty(() => 18 + 64 * ping(), false),
        color: new CallbackProperty(
          () => Color.fromCssColorString('#9ff7e6').withAlpha(0.6 * (1 - ping()) ** 1.4),
          false,
        ),
        disableDepthTestDistance: always,
      },
    }),
  );
  // Heading beam under the dot, pointing along the path; it fades in and out with the walk.
  let beam = 0;
  const beamAxis = new Cartesian3(0, 0, 1);
  const axisScratch = new Cartesian3();
  add(
    new Entity({
      position: walkerPos,
      billboard: {
        image: BEAM(),
        width: 92,
        height: 92,
        alignedAxis: new CallbackProperty(() => {
          // At the end both points clamp to the last vertex: keep the last valid axis (normalising
          // a zero vector throws inside the render and stops it).
          const v = Cartesian3.subtract(at(d + 30), at(d - 10), axisScratch);
          if (Cartesian3.magnitudeSquared(v) > 1e-6) Cartesian3.normalize(v, beamAxis);
          return beamAxis;
        }, false),
        color: new CallbackProperty(() => Color.WHITE.withAlpha(beam), false),
        disableDepthTestDistance: always,
      },
    }),
  );
  add(
    new Entity({
      position: walkerPos,
      billboard: { image: DOT(), width: 25, height: 25, disableDepthTestDistance: always },
    }),
  );
  // One-shot pulses when a stop is reached.
  const pulses: Array<{ entity: Entity; start: number }> = [];
  const pulseAt = (position: Cartesian3) => {
    const start = clock;
    const k = () => Math.min(1, (clock - start) / 1.5);
    const entity = add(
      new Entity({
        position,
        billboard: {
          image: ring,
          width: new CallbackProperty(() => 20 + 150 * EasingFunction.QUADRATIC_OUT(k()), false),
          height: new CallbackProperty(() => 20 + 150 * EasingFunction.QUADRATIC_OUT(k()), false),
          color: new CallbackProperty(
            () => Color.fromCssColorString('#ffd59e').withAlpha(0.95 * (1 - k())),
            false,
          ),
          disableDepthTestDistance: always,
        },
      }),
    );
    pulses.push({ entity, start });
  };

  // ---- camera ----
  const target = Cartesian3.clone(walker);
  const bearing = (from: number) => {
    const a = pointAt(track, from);
    let b = pointAt(track, Math.min(total, from + LOOK_AHEAD_M));
    if (Math.abs(b.lat - a.lat) + Math.abs(b.lon - a.lon) < 1e-9)
      b = pointAt(track, Math.min(total, from + 1));
    const dLon =
      (normalizeLon180(b.lon) - normalizeLon180(a.lon)) * Math.cos(CesiumMath.toRadians(a.lat));
    return Math.atan2(dLon, b.lat - a.lat);
  };
  let heading = bearing(0);
  let pitchOffset = 0;
  const scratch = new Cartographic();
  const place = (h: number, p: number, r: number) => {
    camera.lookAt(target, new HeadingPitchRange(h, p, r));
    camera.lookAtTransform(Matrix4.IDENTITY);
  };

  ctx.suspend(true);
  const canvasEl = widget.canvas;
  const userStop = () => {
    stopped = true;
  };
  canvasEl.addEventListener('pointerdown', userStop);
  canvasEl.addEventListener('wheel', userStop);

  const done = new Promise<boolean>((resolve) => {
    let last = frameTime();
    let holdUntil = 0;
    let completed = false;
    let finished = false;
    let removeTick = () => {};
    const finish = () => {
      if (finished) return;
      finished = true;
      removeTick();
      if (!widget.isDestroyed()) camera.cancelFlight();
      canvasEl.removeEventListener('pointerdown', userStop);
      canvasEl.removeEventListener('wheel', userStop);
      if (!widget.isDestroyed()) for (const e of entities) widget.entities.remove(e);
      ctx.suspend(false);
      ctx.requestRender();
      resolve(completed);
    };
    const publish = (frame: WalkFrame) => {
      try {
        spec.onFrame(frame);
      } catch (err) {
        console.error('[Copernico] walk HUD', err); // the HUD must never stop the walk
      }
    };

    /** Lowest pitch (most downward) that keeps the camera MIN_CLEARANCE_M above the ground. */
    const scratchC = new Cartographic();
    const pitchFor = (h: number, basePitch: number, range: number) => {
      const tc = Cartographic.fromCartesian(target, ellipsoid, scratchC);
      if (!tc) return basePitch;
      const horizontal = range * Math.cos(basePitch);
      const back = h + Math.PI; // the camera sits behind the target
      const R = ellipsoid.maximumRadius;
      const lat = tc.latitude + (horizontal * Math.cos(back)) / R;
      const lon = tc.longitude + (horizontal * Math.sin(back)) / (R * Math.cos(tc.latitude));
      const ground = scene.globe.getHeight(Cartographic.fromRadians(lon, lat, 0, scratch));
      if (ground === undefined) return basePitch;
      const need = ground + MIN_CLEARANCE_M - tc.height; // camera height above the target needed
      const have = -range * Math.sin(basePitch);
      if (need <= have) return basePitch;
      return -Math.asin(Math.min(0.95, need / range));
    };

    // Runs once per rendered frame, before rendering: camera and markers stay in lockstep.
    const tick = () => {
      if (finished) return;
      if (stopped || widget.isDestroyed()) return finish();
      const now = frameTime();
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      clock += dt;
      beam += ((phase === 'walk' && !paused ? 1 : 0) - beam) * follow(dt, 0.35);
      let arrived: number | null = null;
      if (phase === 'walk' && !paused) {
        t += dt;
        d = distanceAt(t);
        while (nextStop < spec.stops.length && d >= spec.stops[nextStop]! - 0.5) {
          arrived = nextStop;
          pulseAt(at(spec.stops[nextStop]!));
          nextStop++;
        }
        if (d >= total - 0.01) {
          phase = 'arrive';
          holdUntil = clock + 1.6;
        }
      }
      Cartesian3.clone(at(d), walker);
      for (let i = pulses.length - 1; i >= 0; i--) {
        if (clock - pulses[i]!.start > 1.6) {
          widget.entities.remove(pulses[i]!.entity);
          pulses.splice(i, 1);
        }
      }
      if (phase === 'walk' || phase === 'arrive') {
        // Follow camera: target, heading and terrain-clearance pitch, each exponentially smoothed.
        Cartesian3.lerp(target, walker, follow(dt, 0.22), target);
        heading += wrap(bearing(d) - heading) * follow(dt, 1.1);
        const range = RANGE_M * (1 + 0.05 * Math.sin(clock * 0.35));
        const base = CesiumMath.toRadians(PITCH_DEG);
        const wanted = pitchFor(heading, base, range) - base;
        pitchOffset += (wanted - pitchOffset) * follow(dt, 0.8);
        place(heading, base + pitchOffset, range);
      }
      if (phase === 'arrive' && clock >= holdUntil) {
        phase = 'outro';
        completed = true;
        removeTick();
        publish({ phase, distanceM: total, fraction: 1, arrived: null });
        void ctx.frameRoute().then(finish, finish);
        return;
      }
      publish({
        phase,
        distanceM: d,
        fraction: total > 0 ? d / total : 1,
        arrived,
      });
      ctx.requestRender(); // keep rendering: the next frame runs this again
    };
    removeTick = scene.preRender.addEventListener(tick);

    // Intro: glide from the current view to the follow pose behind the start, then walk.
    const save = {
      position: Cartesian3.clone(camera.positionWC),
      direction: Cartesian3.clone(camera.directionWC),
      up: Cartesian3.clone(camera.upWC),
    };
    const base = CesiumMath.toRadians(PITCH_DEG);
    pitchOffset = pitchFor(heading, base, RANGE_M) - base;
    place(heading, base + pitchOffset, RANGE_M);
    const destination = Cartesian3.clone(camera.positionWC);
    const orientation = { heading: camera.heading, pitch: camera.pitch, roll: 0 };
    camera.setView({
      destination: save.position,
      orientation: { direction: save.direction, up: save.up },
    });
    camera.flyTo({
      destination,
      orientation,
      duration: 2.4,
      easingFunction: EasingFunction.QUADRATIC_IN_OUT,
      maximumHeight: flightPeak(save.position, destination, ellipsoid),
      complete: () => {
        phase = 'walk';
        last = frameTime();
      },
      cancel: () => {
        if (phase === 'intro') stopped = true;
      },
    });
    ctx.requestRender();
  });

  return {
    done,
    stop: () => {
      stopped = true;
    },
    setPaused: (p) => {
      paused = p;
    },
  };
}
