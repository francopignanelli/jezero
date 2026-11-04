import { describe, expect, it } from 'vitest';
import type { SampleSite } from '../data/surfaceData';
import { M_PER_DEG } from '../lib/math';
import {
  decodeHeights,
  edgeWeight,
  sampleBicubic,
  sampleBilinear,
  LocalFrame,
  type HeightsMeta,
} from './world/heights';
import {
  CraterField,
  bakeCraters,
  craterProfile,
  generateCraters,
  latticeHash,
  microRelief,
} from './world/features';
import { CLASSES, rocksInCell, type GroundInfo } from './world/rocks';
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
import { readCareer, recordRock, recordSample, resetProgress } from './career';
import { ROCK_TYPES, mainElements, rockKey, rockType, spectrum } from './science';
import {
  DRIVE,
  HAZARD,
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

describe('hazards', () => {
  const sandy = (sand: number): GroundProbe => ({ ...flat, sand: () => sand });

  it('soft sand: slip slows the rover, sinkage grows until it is stuck; backing out frees it', () => {
    const firm = drive(initialRover(LAT, LON, 0), { throttle: 1 }, 4);
    const loose = drive(initialRover(LAT, LON, 0), { throttle: 1 }, 4, sandy(0.4));
    expect(loose.speed).toBeLessThan(firm.speed * 0.85);
    expect(loose.sinkage).toBe(0); // not deep: slips but does not dig in
    let s = drive(initialRover(LAT, LON, 0), { throttle: 1 }, 20, sandy(1));
    expect(s.stuck).toBe(true);
    expect(s.blocked).toBe('sand');
    expect(s.speed).toBeLessThanOrEqual(0);
    s = drive(s, { throttle: -1 }, 3, sandy(1));
    expect(s.stuck).toBe(false);
    expect(s.sinkage).toBeLessThan(HAZARD.freeAt);
  });

  it('sharp rocks wear the wheels when driven over fast, not slowly; worn wheels are slower', () => {
    const rocky: GroundProbe = { ...flat, rock: () => 0.4 };
    const fast = drive(initialRover(LAT, LON, 0), { throttle: 1 }, 6, rocky);
    expect(fast.wheelsPct).toBeLessThan(100);
    const slow = drive({ ...initialRover(LAT, LON, 0) }, { throttle: 0.3 }, 6, rocky);
    expect(slow.wheelsPct).toBe(100);
    const worn = drive({ ...initialRover(LAT, LON, 0), wheelsPct: 10 }, { throttle: 1 }, 5);
    expect(worn.speed).toBeLessThan(DRIVE.cruiseMps * 0.7);
  });

  it('a boulder ahead blocks as a rock, a step of bare ground as a slope', () => {
    // A 1.5 m step 4 m north of the start; with a rock on it, or bare.
    const stepAt = LAT + 4 / M_PER_DEG;
    const wall = (rock: number): GroundProbe => ({
      height: (lat) => -2_500 + (lat > stepAt ? 1.5 : 0),
      rock: (lat) => (lat > stepAt ? rock : 0),
    });
    expect(drive(initialRover(LAT, LON, 0), { throttle: 1 }, 4, wall(0.8)).blocked).toBe('rock');
    expect(drive(initialRover(LAT, LON, 0), { throttle: 1 }, 4, wall(0)).blocked).toBe('steep');
  });

  it('refuses to drive onto a side slope over 30°', () => {
    // A plane rising 40° towards the east; driving north traverses it sideways.
    const side: GroundProbe = {
      height: (_lat, lon) =>
        -2_500 +
        (lon - LON) * M_PER_DEG * Math.cos((LAT * Math.PI) / 180) * Math.tan((40 * Math.PI) / 180),
    };
    const s = drive(initialRover(LAT, LON, 0), { throttle: 1 }, 3, side);
    expect(s.blocked).toBe('tilt');
    expect(s.odometerM).toBeLessThan(1);
  });

  it('a dust storm lowers the top speed through the environment', () => {
    let s = initialRover(LAT, LON, 0);
    for (let i = 0; i < 300; i++)
      s = stepRover(s, { throttle: 1, steer: 0, boost: false }, 1 / 60, flat, BOUNDS, {
        speedFactor: 0.5,
      });
    expect(s.speed).toBeCloseTo(DRIVE.cruiseMps * 0.5, 2);
  });
});

describe('science and collection', () => {
  it('rock types are deterministic per rock and follow the area', () => {
    const key = rockKey(12.34, -56.78);
    expect(rockType('floor', key, true)).toBe(rockType('floor', key, true));
    const count = (area: 'floor' | 'margin', type: string) => {
      let n = 0;
      for (let i = 0; i < 2000; i++)
        if (rockType(area, rockKey(i * 1.7, i * -0.9), false) === type) n++;
      return n;
    };
    expect(count('margin', 'carbonate')).toBeGreaterThan(count('floor', 'carbonate'));
    expect(count('floor', 'basalt')).toBeGreaterThan(count('margin', 'basalt'));
    for (const t of ROCK_TYPES) {
      expect(mainElements(t).length).toBeGreaterThan(1);
      const sp = spectrum(t, 'k');
      expect(Math.max(...sp)).toBeGreaterThan(0.3);
    }
  });

  it('keeps the collection: samples once, rocks with double points for a first find', () => {
    resetProgress();
    recordSample('sample-1');
    recordSample('sample-1');
    expect(readCareer().samples).toEqual(['sample-1']);
    expect(recordRock('olivine', 'floor:1:2', 15)).toEqual({ points: 30, first: true });
    expect(recordRock('olivine', 'floor:3:4', 15)).toEqual({ points: 15, first: false });
    const c = readCareer();
    expect(c.rocks.olivine).toBe(2);
    expect(c.science).toBe(45);
    expect(c.analysed).toContain('floor:1:2');
    resetProgress();
    expect(readCareer().samples).toEqual([]);
  });
});

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

  it('one press, stopped in a ring, runs the whole coring sequence', () => {
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
    // Stopped inside: one frame with the key down starts it; it then runs without the key.
    p = stepProgress(p, at(target.lat, target.lon), targets, true, 0.1).progress;
    expect(p.action?.kind).toBe('core');
    let collected = false;
    for (let t = 0.1; t < CORE_S + 0.2; t += 0.1) {
      const r = stepProgress(p, at(target.lat, target.lon), targets, false, 0.1);
      p = r.progress;
      if (r.event?.kind === 'collected') collected = true;
    }
    expect(collected).toBe(true);
    expect(p.collected).toEqual([target.id]);
    expect(p.action).toBeNull();
    // A collected site cannot be cored again.
    expect(
      stepProgress(p, at(target.lat, target.lon), targets, true, 0.1).progress.action,
    ).toBeNull();
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

describe('game world data', () => {
  const meta: HeightsMeta = {
    file: '',
    cols: 4,
    rows: 3,
    cellM: 1,
    widthM: 4,
    heightM: 3,
    baseM: -2500,
    stepM: 0.01,
    rangeM: 0,
  };

  it('decodes delta-coded rows (running sums modulo 2^16) into metres above the world base', () => {
    // Absolute steps per row: [100, 150, 140, 65535] / [0, 1, 2, 3] / [7, 7, 7, 7].
    const coded = new Uint16Array([100, 50, 65526, 65395, 0, 1, 1, 1, 7, 0, 0, 0]);
    const l = decodeHeights(coded, meta, -2510);
    expect(Array.from(l.data.slice(0, 4)).map((v) => +v.toFixed(2))).toEqual([
      11, 11.5, 11.4, 665.35,
    ]);
    expect(Array.from(l.data.slice(4, 8)).map((v) => +v.toFixed(2))).toEqual([
      10, 10.01, 10.02, 10.03,
    ]);
  });

  it('samples at pixel centres exactly; bicubic agrees on planes; nothing outside', () => {
    // A plane rising 1 m per metre east: heights equal to the column index.
    const data = new Float32Array([0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3]);
    const l = { cols: 4, rows: 3, cellM: 1, widthM: 4, heightM: 3, data };
    // Pixel centre of column 1 is at x = −2 + 1.5 = −0.5.
    expect(sampleBilinear(l, -0.5, 0)).toBeCloseTo(1, 6);
    expect(sampleBilinear(l, 0, 0)).toBeCloseTo(1.5, 6);
    expect(sampleBicubic(l, 0, 0)).toBeCloseTo(1.5, 6);
    expect(sampleBilinear(l, 5, 0)).toBeUndefined();
    expect(edgeWeight(l, 0, 0, 0.25)).toBe(1);
    expect(edgeWeight(l, 1.9, 0, 0.25)).toBe(0);
  });

  it('local frame round-trips and is metric', () => {
    const f = new LocalFrame(18.44, 77.45);
    const [x, n] = f.toLocal(18.441, 77.451);
    expect(n).toBeCloseTo(0.001 * M_PER_DEG, 3);
    expect(x).toBeCloseTo(0.001 * M_PER_DEG * Math.cos((18.44 * Math.PI) / 180), 3);
    const back = f.toLatLon(x, n);
    expect(back.lat).toBeCloseTo(18.441, 10);
    expect(back.lon).toBeCloseTo(77.451, 10);
  });

  it('rocks are deterministic per cell, within their size class, more on bright ground', () => {
    const ground = (bright: number): GroundInfo => ({
      height: () => 0,
      brightness: () => bright,
      slope: () => 0,
    });
    const a = rocksInCell(3, -7, CLASSES[0]!, ground(0.5));
    expect(rocksInCell(3, -7, CLASSES[0]!, ground(0.5))).toEqual(a);
    let dark = 0;
    let bright = 0;
    for (let i = 0; i < 200; i++) {
      dark += rocksInCell(i, 0, CLASSES[0]!, ground(0.2)).length;
      const rocks = rocksInCell(i, 0, CLASSES[0]!, ground(0.9));
      bright += rocks.length;
      for (const r of rocks) {
        expect((2 * Math.max(r.sx, r.sz)) / 1.3).toBeLessThanOrEqual(CLASSES[0]!.maxM + 1e-9);
        expect(r.topM).toBeGreaterThan(0);
        expect(Math.abs(r.x - (i + 0.5) * CLASSES[0]!.cellM)).toBeLessThanOrEqual(
          CLASSES[0]!.cellM / 2,
        );
      }
    }
    expect(bright).toBeGreaterThan(dark * 1.5);
  });

  it('craters: deterministic, clear of the sample sites, and baked as bowl and rim', () => {
    const keep: Array<[number, number]> = [
      [0, 0],
      [300, -200],
    ];
    const a = generateCraters('floor', 1700, 1700, keep);
    expect(generateCraters('floor', 1700, 1700, keep)).toEqual(a);
    expect(a.length).toBeGreaterThan(80);
    for (const c of a) {
      for (const [x, n] of keep)
        expect(Math.hypot(c.x - x, c.north - n)).toBeGreaterThan(c.radiusM * 2.4 + 18 - 1e-6);
      // Inside the 1 m model, away from its edges.
      expect(Math.abs(c.x) + c.radiusM * 3).toBeLessThan(850);
    }
    // Profile: below the surroundings at the centre, raised at the rim, nothing beyond 3 R.
    const c = a[0]!;
    expect(craterProfile(c, 0)).toBeLessThan(-c.depthM * 0.5);
    expect(craterProfile(c, c.radiusM)).toBeGreaterThan(0);
    expect(craterProfile(c, c.radiusM * 3.1)).toBe(0);
    // Continuous at the rim crest.
    expect(
      Math.abs(craterProfile(c, c.radiusM * 0.9999) - craterProfile(c, c.radiusM * 1.0001)),
    ).toBeLessThan(0.01);
    const cols = 400;
    const heights = {
      cols,
      rows: cols,
      cellM: 1,
      widthM: cols,
      heightM: cols,
      data: new Float32Array(cols * cols),
    };
    const one = { ...c, x: 0.5, north: -0.5, radiusM: 20 };
    const grey = {
      data: new Uint8Array(cols * cols).fill(128),
      width: cols,
      height: cols,
      cellM: 1,
    };
    bakeCraters([one], heights, grey);
    expect(heights.data[200 * cols + 200]!).toBeLessThan(-1);
    expect(heights.data[200 * cols + 220]!).toBeGreaterThan(0);
    // Boulders on the fresh rim, none far away.
    const field = new CraterField([one]);
    expect(field.rockiness(20.5, -0.5)).toBeGreaterThan(1);
    expect(field.rockiness(150, 150)).toBe(0);
  });

  it('micro-relief: a lattice hash in [0, 1], centimetre bumps, smooth', () => {
    for (let i = -5; i < 5; i++) {
      const h = latticeHash(i * 9973, -i * 7);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(1);
    }
    let max = 0;
    for (let k = 0; k < 2000; k++) {
      const x = (k % 50) * 0.37 - 9;
      const n = Math.floor(k / 50) * 0.41 - 8;
      const h = microRelief(x, n);
      max = Math.max(max, Math.abs(h));
      expect(Math.abs(microRelief(x + 0.01, n) - h)).toBeLessThan(0.003);
    }
    expect(max).toBeGreaterThan(0.01);
    expect(max).toBeLessThan(0.08);
  });
});
