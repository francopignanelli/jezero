import { M_PER_DEG, wrapAngle } from '../lib/math';

/**
 * Ingenuity flown by the player (mission 4, its flight 26). A take-off (spin-up, climb to 8 m), then
 * forward and back (W/S) and turning (A/D) at a constant height, a hover when nothing is pressed,
 * and a landing (descent, spin-down) where it is allowed. Its battery gives a fixed time in the air:
 * the real flight lasted 159 s; when it runs out, the helicopter lands where it is.
 *
 * Figures: flight 26 was flown at 8 m (NASA); Ingenuity's rotors spin up in a few seconds; its
 * horizontal speed reached 6.5 m/s on later flights (here up to 4.5, 6 with boost). Pure: tested in
 * game.test.ts; the session draws it (world.pilotIngenuity) and moves the camera behind it.
 */
export const HELI = {
  cruiseM: 8,
  spinUpS: 2.5,
  climbMps: 1.8,
  descendMps: 1.2,
  spinDownS: 1.5,
  maxMps: 4.5,
  boostMps: 6,
  accelMps2: 1.8,
  /** Braking when nothing is pressed (it holds position in a hover). */
  brakeMps2: 2.4,
  yawRadS: 0.9,
  /** An aerial photo: hover over a place this slowly for this long. */
  photoMaxMps: 1.6,
  photoHoldS: 1.2,
} as const;

export type HeliPhase = 'ground' | 'spinup' | 'climb' | 'fly' | 'descend' | 'down';

export interface HeliState {
  lat: number;
  lon: number;
  headingRad: number;
  /** Forward speed (m/s, negative backwards) and height above the ground (m). */
  speed: number;
  altM: number;
  phase: HeliPhase;
  /** Time in the phase (s), and time in the air so far (s) out of `budgetS`. */
  t: number;
  airS: number;
  budgetS: number;
  /** Hovering over a place to photograph it: which, and for how long. */
  photo: { id: string; s: number } | null;
  /** The last flight ended with the battery empty (not a landing the player chose). */
  forced: boolean;
  /** The action key was down at the last step (a press is when it goes down). */
  keyWas: boolean;
}

export interface HeliInput {
  throttle: number;
  steer: number;
  boost: boolean;
  /** The action key, down or not (a press takes off, or lands). */
  action: boolean;
}

export const newHeli = (
  at: { lat: number; lon: number },
  headingRad: number,
  budgetS: number,
): HeliState => ({
  lat: at.lat,
  lon: at.lon,
  headingRad,
  speed: 0,
  altM: 0,
  phase: 'ground',
  t: 0,
  airS: 0,
  budgetS,
  photo: null,
  forced: false,
  keyWas: false,
});

export const timeLeftS = (h: HeliState): number => Math.max(0, h.budgetS - h.airS);
export const airborne = (h: HeliState): boolean => h.phase === 'fly';

/**
 * One step. `canLand`: whether a landing may start here (the session checks the place). Returns
 * the new state and what happened: it took off, or it is down (landed or forced down).
 */
export function stepHeli(
  h: HeliState,
  input: HeliInput,
  dt: number,
  canLand: boolean,
  bounds: { west: number; south: number; east: number; north: number },
): { h: HeliState; event: 'takeoff' | 'down' | null } {
  const press = input.action && !h.keyWas;
  let s = { ...h, t: h.t + dt, keyWas: input.action };
  let event: 'takeoff' | 'down' | null = null;
  const flying = s.phase !== 'ground' && s.phase !== 'down';
  if (flying) s.airS += dt;
  switch (s.phase) {
    case 'ground':
    case 'down':
      if (press && timeLeftS(s) > 0) {
        s = { ...s, phase: 'spinup', t: 0, forced: false };
        event = 'takeoff';
      }
      break;
    case 'spinup':
      if (s.t >= HELI.spinUpS) s = { ...s, phase: 'climb', t: 0 };
      break;
    case 'climb':
      s.altM = Math.min(HELI.cruiseM, s.altM + HELI.climbMps * dt);
      if (s.altM >= HELI.cruiseM) s = { ...s, phase: 'fly', t: 0 };
      break;
    case 'fly':
      if (timeLeftS(s) <= 0) s = { ...s, phase: 'descend', t: 0, forced: true };
      else if (press && canLand) s = { ...s, phase: 'descend', t: 0, forced: false };
      break;
    case 'descend':
      s.altM = Math.max(0, s.altM - HELI.descendMps * dt);
      if (s.altM <= 0) s = { ...s, phase: 'down', t: 0 };
      break;
  }
  if (h.phase !== 'down' && s.phase === 'down') event = 'down';
  // Moving: only at height; it slows to a hover by itself, and stops to climb or descend.
  const steerable = s.phase === 'fly';
  const max = input.boost ? HELI.boostMps : HELI.maxMps;
  const want = steerable ? input.throttle * max : 0;
  const rate = steerable && input.throttle !== 0 ? HELI.accelMps2 : HELI.brakeMps2;
  const dv = want - s.speed;
  s.speed += Math.sign(dv) * Math.min(Math.abs(dv), rate * dt);
  if (steerable || s.phase === 'climb')
    s.headingRad = wrapAngle(s.headingRad + input.steer * HELI.yawRadS * dt);
  const d = s.speed * dt;
  if (d !== 0) {
    const north = Math.cos(s.headingRad) * d;
    const east = Math.sin(s.headingRad) * d;
    s.lat = Math.min(bounds.north, Math.max(bounds.south, s.lat + north / M_PER_DEG));
    s.lon = Math.min(
      bounds.east,
      Math.max(bounds.west, s.lon + east / (M_PER_DEG * Math.cos((s.lat * Math.PI) / 180))),
    );
  }
  return { h: s, event };
}

/**
 * Aerial photos: while it flies slowly inside a place's ring, the hold builds up; returns the
 * place photographed this step, if any.
 */
export function stepPhoto(
  h: HeliState,
  over: string | null,
  dt: number,
): { h: HeliState; taken: string | null } {
  if (!over || h.phase !== 'fly' || Math.abs(h.speed) > HELI.photoMaxMps)
    return { h: h.photo ? { ...h, photo: null } : h, taken: null };
  const s = h.photo?.id === over ? h.photo.s + dt : dt;
  if (s >= HELI.photoHoldS) return { h: { ...h, photo: null }, taken: over };
  return { h: { ...h, photo: { id: over, s } }, taken: null };
}
