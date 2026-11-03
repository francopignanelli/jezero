import { DEG_TO_RAD, RAD_TO_DEG } from '@copernico/domain';
import { follow, M_PER_DEG } from '../lib/math';

/**
 * Arcade driving model for the rover game, on the real (rendered) Jezero terrain. Pure: the ground
 * comes in through a height probe, so the model is testable without Cesium.
 *
 * Game choices, stated in the game's help: speeds are far above Perseverance's real top speed
 * (0.042 m/s) so a mission fits in minutes; the 30° climb limit, turning in place and the
 * nuclear power source (an MMRTG that slowly recharges the batteries) follow the real rover.
 */
export const DRIVE = {
  cruiseMps: 6,
  boostMps: 12,
  reverseMps: 2.5,
  accel: 2.5,
  boostAccel: 4,
  brake: 7,
  coast: 2.2,
  /** Yaw rate at a standstill (the rover turns in place) and at boost speed. */
  turnStopDegPerS: 70,
  turnFastDegPerS: 32,
  /** Perseverance is designed for 30° slopes. */
  maxGradeDeg: 30,
  tiltWarnDeg: 25,
  /** Height probes: front/back and left/right wheel lines. */
  probeHalfLengthM: 1.1,
  probeHalfWidthM: 1.3,
  /** The climb ahead is judged this far in front, so the rover stops before a wall, not inside it. */
  lookAheadM: 2.5,
  /** Battery (%): per metre driven, ×(1 + uphill° × uphillDrainPerDeg), ×boost factor. */
  drainPerM: 0.012,
  uphillDrainPerDeg: 0.05,
  boostDrainFactor: 2.2,
  rechargeStoppedPerS: 1.5,
  /** While driving the trickle only offsets part of the drain (cruise: about −0.05 %/s net). */
  rechargeMovingPerS: 0.02,
  /** After running flat, driving resumes at this charge. */
  resumeAtPct: 25,
  /** Distance kept from the edge of the 1 m terrain model. */
  edgeMarginM: 30,
} as const;

export interface GroundProbe {
  /** Rendered terrain height (m above the areoid) or undefined where tiles are not loaded yet. */
  height(lat: number, lon: number): number | undefined;
}

export interface DriveInput {
  /** −1 (reverse) … 1 (forward). */
  throttle: number;
  /** −1 (left, anticlockwise) … 1 (right). */
  steer: number;
  boost: boolean;
}

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export type Blocked = 'steep' | 'edge' | 'power' | null;

export interface RoverState {
  lat: number;
  lon: number;
  heightM: number;
  /** Clockwise from north. */
  headingRad: number;
  /** Along the heading, m/s (negative in reverse). */
  speed: number;
  /** Nose up positive; left side up positive. */
  pitchRad: number;
  rollRad: number;
  /** Smoothed steering input. */
  steer: number;
  batteryPct: number;
  odometerM: number;
  energyUsedPct: number;
  /** Climb along the direction of travel (°, uphill positive). */
  gradeDeg: number;
  tiltDeg: number;
  blocked: Blocked;
  recharging: boolean;
}

export function initialRover(
  lat: number,
  lon: number,
  headingRad: number,
  heightM = 0,
): RoverState {
  return {
    lat,
    lon,
    heightM,
    headingRad,
    speed: 0,
    pitchRad: 0,
    rollRad: 0,
    steer: 0,
    batteryPct: 100,
    odometerM: 0,
    energyUsedPct: 0,
    gradeDeg: 0,
    tiltDeg: 0,
    blocked: null,
    recharging: false,
  };
}

/** A point `forwardM` ahead and `rightM` to the right of (lat, lon) facing `headingRad`. */
export function offsetPoint(
  lat: number,
  lon: number,
  headingRad: number,
  forwardM: number,
  rightM: number,
): { lat: number; lon: number } {
  const s = Math.sin(headingRad);
  const c = Math.cos(headingRad);
  const north = forwardM * c - rightM * s;
  const east = forwardM * s + rightM * c;
  return {
    lat: lat + north / M_PER_DEG,
    lon: lon + east / (M_PER_DEG * Math.cos(lat * DEG_TO_RAD)),
  };
}

/** Ground distance (m) between two nearby points (local flat approximation). */
export function groundDistanceM(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const north = (b.lat - a.lat) * M_PER_DEG;
  const east = (b.lon - a.lon) * M_PER_DEG * Math.cos(a.lat * DEG_TO_RAD);
  return Math.hypot(north, east);
}

/** Compass bearing (rad, clockwise from north) from a to b. */
export function bearingRad(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const north = b.lat - a.lat;
  const east = (b.lon - a.lon) * Math.cos(a.lat * DEG_TO_RAD);
  return Math.atan2(east, north);
}

const inside = (b: Bounds, lat: number, lon: number, marginM: number) => {
  const dLat = marginM / M_PER_DEG;
  const dLon = marginM / (M_PER_DEG * Math.cos(lat * DEG_TO_RAD));
  return lat > b.south + dLat && lat < b.north - dLat && lon > b.west + dLon && lon < b.east - dLon;
};

const approach = (v: number, target: number, rate: number) =>
  v < target ? Math.min(target, v + rate) : Math.max(target, v - rate);

/** Speed factor for a climb: free downhill (a little faster), falling to 0 at the 30° limit. */
export function gradeFactor(gradeDeg: number): number {
  if (gradeDeg <= 0) return 1 + Math.min(0.2, -gradeDeg / 60);
  return Math.max(0, 1 - (gradeDeg / DRIVE.maxGradeDeg) ** 2);
}

/** Advances the rover by `dt` seconds. Returns a new state (the input is not modified). */
export function stepRover(
  prev: RoverState,
  input: DriveInput,
  dt: number,
  ground: GroundProbe,
  bounds: Bounds,
): RoverState {
  const s: RoverState = { ...prev, blocked: null };
  const { lat, lon, headingRad: h } = s;

  // Power: running flat stops the rover until the MMRTG has recharged it to resumeAtPct.
  if (s.batteryPct <= 0) s.recharging = true;
  if (s.recharging && s.batteryPct >= DRIVE.resumeAtPct) s.recharging = false;
  const throttle = s.recharging ? 0 : Math.max(-1, Math.min(1, input.throttle));
  if (s.recharging) s.blocked = 'power';

  // Climb ahead in the direction the rover is driven (or about to be).
  const dir = Math.sign(throttle || s.speed) || 1;
  const here = ground.height(lat, lon);
  const aheadPt = offsetPoint(lat, lon, h, dir * DRIVE.lookAheadM, 0);
  const ahead = ground.height(aheadPt.lat, aheadPt.lon);
  const climb =
    here !== undefined && ahead !== undefined
      ? Math.atan2(ahead - here, DRIVE.lookAheadM) * RAD_TO_DEG
      : 0;
  const factor = gradeFactor(climb);

  // Speed: towards the target set by the throttle, limited by the climb ahead.
  const boost = input.boost && throttle > 0;
  const top = boost ? DRIVE.boostMps : DRIVE.cruiseMps;
  const target =
    throttle > 0
      ? top * throttle * factor
      : throttle < 0
        ? DRIVE.reverseMps * throttle * factor
        : 0;
  const braking = target === 0 || Math.sign(target) !== Math.sign(s.speed);
  const rate =
    throttle === 0 ? DRIVE.coast : braking ? DRIVE.brake : boost ? DRIVE.boostAccel : DRIVE.accel;
  s.speed = approach(s.speed, target, rate * dt);
  if (factor === 0 && throttle !== 0) {
    s.speed = 0;
    s.blocked = 'steep';
  }

  // Steering: smoothed input; the rover can turn in place, a little slower when fast.
  s.steer += (input.steer - s.steer) * follow(dt, 0.12);
  const fast = Math.min(1, Math.abs(s.speed) / DRIVE.boostMps);
  const yawRate =
    (DRIVE.turnStopDegPerS + (DRIVE.turnFastDegPerS - DRIVE.turnStopDegPerS) * fast) * DEG_TO_RAD;
  s.headingRad = h + s.steer * yawRate * dt;

  // Move, staying on the 1 m terrain model.
  const stepM = s.speed * dt;
  const next = offsetPoint(lat, lon, s.headingRad, stepM, 0);
  if (inside(bounds, next.lat, next.lon, DRIVE.edgeMarginM)) {
    s.lat = next.lat;
    s.lon = next.lon;
  } else if (stepM !== 0) {
    s.speed = 0;
    s.blocked = 'edge';
  }
  const moved = s.blocked === 'edge' ? 0 : Math.abs(stepM);
  s.odometerM += moved;

  // Wheels on the ground: height and attitude from four probes around the rover.
  const p = (f: number, r: number) => {
    const q = offsetPoint(s.lat, s.lon, s.headingRad, f, r);
    return ground.height(q.lat, q.lon);
  };
  const hf = p(DRIVE.probeHalfLengthM, 0);
  const hb = p(-DRIVE.probeHalfLengthM, 0);
  const hl = p(0, -DRIVE.probeHalfWidthM);
  const hr = p(0, DRIVE.probeHalfWidthM);
  if (hf !== undefined && hb !== undefined && hl !== undefined && hr !== undefined) {
    const height = (hf + hb + hl + hr) / 4;
    // First contact with the ground (or a jump in loaded detail): snap instead of easing.
    s.heightM =
      Math.abs(height - s.heightM) > 20
        ? height
        : s.heightM + (height - s.heightM) * follow(dt, 0.06);
    const pitch = Math.atan2(hf - hb, 2 * DRIVE.probeHalfLengthM);
    const roll = Math.atan2(hl - hr, 2 * DRIVE.probeHalfWidthM);
    s.pitchRad += (pitch - s.pitchRad) * follow(dt, 0.1);
    s.rollRad += (roll - s.rollRad) * follow(dt, 0.1);
  }
  s.gradeDeg = s.speed >= 0 ? s.pitchRad * RAD_TO_DEG : -s.pitchRad * RAD_TO_DEG;
  s.tiltDeg = Math.acos(Math.min(1, Math.cos(s.pitchRad) * Math.cos(s.rollRad))) * RAD_TO_DEG;

  // Battery: driving drains it (more uphill and when boosting); the MMRTG trickle-charges it.
  const drain =
    moved *
    DRIVE.drainPerM *
    (1 + Math.max(0, s.gradeDeg) * DRIVE.uphillDrainPerDeg) *
    (boost ? DRIVE.boostDrainFactor : 1);
  const charge =
    (Math.abs(s.speed) < 0.05 ? DRIVE.rechargeStoppedPerS : DRIVE.rechargeMovingPerS) * dt;
  s.energyUsedPct += drain;
  s.batteryPct = Math.max(0, Math.min(100, s.batteryPct - drain + charge));
  return s;
}
