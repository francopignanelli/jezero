import { describe, expect, it } from 'vitest';
import type { SampleSite } from '../data/surfaceData';
import { M_PER_DEG } from '../lib/math';
import {
  CORE_S,
  MISSIONS,
  isComplete,
  missionTargets,
  nearestRemaining,
  newProgress,
  realSols,
  remaining,
  stepProgress,
  tubesIn,
} from './missions';
import {
  DRIVE,
  bearingRad,
  gradeFactor,
  groundDistanceM,
  initialRover,
  offsetPoint,
  stepRover,
  type Bounds,
  type GroundProbe,
  type RoverState,
} from './roverSim';

const LAT = 18.44;
const LON = 77.45;
const BOUNDS: Bounds = { west: 77.4, south: 18.4, east: 77.5, north: 18.48 };
const flat: GroundProbe = { height: () => -2_500 };
/** A plane rising `deg` degrees towards the north. */
const rampNorth = (deg: number): GroundProbe => ({
  height: (lat) => -2_500 + (lat - LAT) * M_PER_DEG * Math.tan((deg * Math.PI) / 180),
});

function drive(
  s: RoverState,
  input: { throttle: number; steer?: number; boost?: boolean },
  seconds: number,
  ground = flat,
  bounds = BOUNDS,
): RoverState {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt)
    s = stepRover(s, { steer: 0, boost: false, ...input }, dt, ground, bounds);
  return s;
}

describe('rover driving', () => {
  it('accelerates to cruise speed on flat ground and moves along its heading', () => {
    const s = drive(initialRover(LAT, LON, 0, -2_500), { throttle: 1 }, 5);
    expect(s.speed).toBeCloseTo(DRIVE.cruiseMps, 3);
    expect(s.lat).toBeGreaterThan(LAT);
    expect(Math.abs(s.lon - LON)).toBeLessThan(1e-9); // heading 0 = due north
    expect(s.odometerM).toBeGreaterThan(20);
    expect(s.heightM).toBeCloseTo(-2_500, 3);
  });

  it('is faster with boost, and boost drains the battery faster', () => {
    const cruise = drive(initialRover(LAT, LON, 0), { throttle: 1 }, 20);
    const boost = drive(initialRover(LAT, LON, 0), { throttle: 1, boost: true }, 20);
    expect(boost.speed).toBeCloseTo(DRIVE.boostMps, 3);
    expect(boost.energyUsedPct / boost.odometerM).toBeGreaterThan(
      (cruise.energyUsedPct / cruise.odometerM) * 2,
    );
  });

  it('turns in place when stopped', () => {
    const s = drive(initialRover(LAT, LON, 0), { throttle: 0, steer: 1 }, 1);
    expect(s.odometerM).toBe(0);
    expect((s.headingRad * 180) / Math.PI).toBeGreaterThan(50);
  });

  it('slows on climbs and stops before slopes over 30°', () => {
    const gentle = drive(initialRover(LAT, LON, 0), { throttle: 1 }, 6, rampNorth(15));
    expect(gentle.speed).toBeGreaterThan(0);
    expect(gentle.speed).toBeLessThan(DRIVE.cruiseMps);
    expect(gentle.gradeDeg).toBeCloseTo(15, 0);
    const wall = drive(initialRover(LAT, LON, 0), { throttle: 1 }, 6, rampNorth(32));
    expect(wall.speed).toBe(0);
    expect(wall.blocked).toBe('steep');
    expect(wall.odometerM).toBe(0);
    // Driving down the same slope is allowed.
    const down = drive(initialRover(LAT, LON, Math.PI), { throttle: 1 }, 3, rampNorth(32));
    expect(down.odometerM).toBeGreaterThan(5);
  });

  it('pitches with the ground and rolls on a side slope', () => {
    const up = drive(initialRover(LAT, LON, 0), { throttle: 0 }, 2, rampNorth(10));
    expect((up.pitchRad * 180) / Math.PI).toBeCloseTo(10, 0);
    expect(Math.abs(up.rollRad)).toBeLessThan(1e-6);
    // Facing east, the slope rising to the north lifts the rover's left side.
    const side = drive(initialRover(LAT, LON, Math.PI / 2), { throttle: 0 }, 2, rampNorth(10));
    expect((side.rollRad * 180) / Math.PI).toBeCloseTo(10, 0);
    expect(side.tiltDeg).toBeCloseTo(10, 0);
  });

  it('keeps off the edge of the terrain model', () => {
    const nearEdge = BOUNDS.north - (DRIVE.edgeMarginM + 2) / M_PER_DEG;
    const s = drive(initialRover(nearEdge, LON, 0), { throttle: 1 }, 5);
    expect(s.blocked).toBe('edge');
    expect(s.lat).toBeLessThan(BOUNDS.north - DRIVE.edgeMarginM / M_PER_DEG);
  });

  it('stops when the battery runs flat and resumes once the MMRTG has recharged it', () => {
    // Driving drains it, even with the MMRTG trickle.
    const driven = drive({ ...initialRover(LAT, LON, 0), batteryPct: 50 }, { throttle: 1 }, 30);
    expect(driven.batteryPct).toBeLessThan(50);
    let s: RoverState = { ...initialRover(LAT, LON, 0), batteryPct: 0 };
    s = drive(s, { throttle: 1 }, 1);
    expect(s.recharging).toBe(true);
    expect(s.odometerM).toBe(0);
    expect(s.blocked).toBe('power');
    const t = (DRIVE.resumeAtPct / DRIVE.rechargeStoppedPerS) * 1.1;
    s = drive(s, { throttle: 0 }, t);
    expect(s.recharging).toBe(false);
    s = drive(s, { throttle: 1 }, 1);
    expect(s.speed).toBeGreaterThan(0);
  });

  it('keeps the last height and attitude where terrain is not loaded yet', () => {
    const none: GroundProbe = { height: () => undefined };
    const s = drive(initialRover(LAT, LON, 0, -2_480), { throttle: 1 }, 1, none);
    expect(s.heightM).toBe(-2_480);
    expect(s.pitchRad).toBe(0);
  });

  it('grade factor: free downhill, zero at the 30° limit', () => {
    expect(gradeFactor(-10)).toBeGreaterThan(1);
    expect(gradeFactor(0)).toBe(1);
    expect(gradeFactor(DRIVE.maxGradeDeg)).toBe(0);
  });

  it('geometry helpers agree with each other', () => {
    const p = offsetPoint(LAT, LON, Math.PI / 4, 100, 0);
    expect(groundDistanceM({ lat: LAT, lon: LON }, p)).toBeCloseTo(100, 1);
    expect(bearingRad({ lat: LAT, lon: LON }, p)).toBeCloseTo(Math.PI / 4, 3);
  });
});

const site = (sampleNumber: string, lat: number, lon: number, sol: string): SampleSite => ({
  sampleNumber,
  sol,
  earthDate: '',
  name: `S${sampleNumber}`,
  outcrop: '',
  location: '',
  sampleType: 'Rock Core',
  rockType: 'Igneous',
  lat,
  lon,
  elevationM: 0,
  positionCorrectedFromEastingNorthing: false,
});

describe('missions', () => {
  const floor = MISSIONS.find((m) => m.id === 'floor')!;
  const delta = MISSIONS.find((m) => m.id === 'delta')!;
  const samples = [
    site('1', 18.4277, 77.4517, '164'),
    site('2 & 3', 18.4307, 77.4443, '194 & 196'),
    site('10 & 11', 18.4589, 77.4062, '490 & 495'),
  ];

  it('builds targets from the sample catalogue, with tubes per site and the depot last', () => {
    const t = missionTargets(floor, samples);
    expect(t.map((x) => x.id)).toEqual(['sample-1', 'sample-2 & 3']);
    expect(t.map((x) => x.tubes)).toEqual([1, 2]);
    expect(tubesIn('17 & 18')).toBe(2);
    expect(realSols(t)).toEqual([164, 196]);
    const d = missionTargets(delta, samples);
    expect(d.at(-1)?.kind).toBe('depot');
  });

  it('cores a sample only while stopped in its ring, holding the key for CORE_S', () => {
    const targets = missionTargets(floor, samples);
    const at = (lat: number, lon: number, speed = 0): RoverState => ({
      ...initialRover(lat, lon, 0),
      speed,
    });
    const target = targets[0]!;
    let p = newProgress();
    // Moving: nothing happens.
    expect(
      stepProgress(p, at(target.lat, target.lon, 2), targets, true, 1).progress.action,
    ).toBeNull();
    // Outside the ring: nothing happens.
    const away = offsetPoint(target.lat, target.lon, 0, target.radiusM + 5, 0);
    expect(stepProgress(p, at(away.lat, away.lon), targets, true, 1).progress.action).toBeNull();
    // Stopped inside, held: progress, then the sample.
    let collected = false;
    for (let t = 0; t < CORE_S + 0.2; t += 0.1) {
      const r = stepProgress(p, at(target.lat, target.lon), targets, true, 0.1);
      p = r.progress;
      if (r.event?.kind === 'collected') collected = true;
    }
    expect(collected).toBe(true);
    expect(p.collected).toEqual([target.id]);
    // Releasing the key resets a coring in progress.
    const other = targets[1]!;
    p = stepProgress(p, at(other.lat, other.lon), targets, true, 1).progress;
    expect(p.action?.heldS).toBe(1);
    p = stepProgress(p, at(other.lat, other.lon), targets, false, 0.1).progress;
    expect(p.action).toBeNull();
  });

  it('opens the depot only once every sample is in, and completes on the drop', () => {
    const targets = missionTargets(delta, samples);
    const p = newProgress();
    expect(remaining(targets, p).map((t) => t.kind)).toEqual(['sample']);
    const done = { ...p, collected: ['sample-10 & 11'] };
    const next = nearestRemaining(initialRover(18.45, 77.41, 0), targets, done);
    expect(next?.kind).toBe('depot');
    expect(isComplete(targets, done)).toBe(false);
    expect(isComplete(targets, { ...done, deposited: true })).toBe(true);
  });
});
