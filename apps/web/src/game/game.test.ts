import { describe, expect, it } from 'vitest';
import { exploreFromHash, exploreLink } from '../data/gameAreas';
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
import { MeshStandardMaterial, ShaderLib, type WebGLProgramParametersWithUniforms } from 'three';
import { SunShadows, receiveSunShadow } from './world/sunShadow';
import {
  CHAPTERS,
  CORE_S,
  INGENUITY_MISSION,
  LANDING,
  LANDING_HARDWARE,
  DEPLOY_SLIDES,
  FREE_DELTA,
  FREE_LANDING,
  DEPLOY_SLIDE_S,
  DRIVE_STEP_M,
  STEP_S,
  VAN_ZYL,
  WRIGHT_FIELD,
  missionOf,
  FLIGHTS,
  PANORAMA_S,
  SAMPLE_TUBES,
  allTargets,
  chapterDone,
  expeditionDone,
  ingenuity,
  listedObjectives,
  newExpedition,
  nextTarget,
  objectiveDone,
  openTargets,
  stepExpedition,
  tubeRack,
  tubesIn,
  type Action,
  type ExpeditionEvent,
  type ExpeditionState,
  type Target,
} from './expedition';
import { NAV, NavGrid, follow, pathLength } from './navigation';
import {
  clearSave,
  readCareer,
  readSave,
  recordRock,
  recordSample,
  resetProgress,
  writeSave,
} from './career';
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

  it('soft sand: slip slows the rover, the wheels sink a little, and it never gets stuck', () => {
    const firm = drive(initialRover(LAT, LON, 0), { throttle: 1 }, 4);
    const loose = drive(initialRover(LAT, LON, 0), { throttle: 1 }, 4, sandy(0.4));
    expect(loose.speed).toBeLessThan(firm.speed * 0.85);
    expect(loose.sinkage).toBe(0); // not deep: slips but does not dig in
    const s = drive(initialRover(LAT, LON, 0), { throttle: 1 }, 20, sandy(1));
    expect(s.stuck).toBe(false);
    expect(s.sinkage).toBeLessThanOrEqual(HAZARD.maxSink);
    expect(s.speed).toBeGreaterThan(0.2);
    expect(s.speed).toBeLessThan(firm.speed * 0.5);
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
  it('rock types are deterministic per rock and follow its tone', () => {
    const key = rockKey(12.34, -56.78);
    expect(rockType(key, true)).toBe(rockType(key, true));
    const count = (dark: boolean, type: string) => {
      let n = 0;
      for (let i = 0; i < 2000; i++) if (rockType(rockKey(i * 1.7, i * -0.9), dark) === type) n++;
      return n;
    };
    // Dark boulders are mostly igneous, light layered rocks mostly sediments.
    expect(count(true, 'basalt')).toBeGreaterThan(count(false, 'basalt'));
    expect(count(false, 'clay')).toBeGreaterThan(count(true, 'clay'));
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

describe('expedition', () => {
  const samples = [
    site('10 & 11', 18.458931, 77.406175, '490 & 495'),
    site('12 & 13', 18.458637, 77.405889, '509 & 516'),
    site('14 & 15', 18.450726, 77.40144, '575 & 579'),
    site('16', 18.453636, 77.399114, '631'),
    site('17 & 18', 18.451314, 77.401218, '634 & 639'),
  ];
  const all = allTargets(samples);
  const at = (t: { lat: number; lon: number }, speed = 0): RoverState => ({
    ...initialRover(t.lat, t.lon, 0),
    speed,
  });
  /** Runs steps with the rover at a target until the sequence ends; returns state and events. */
  const run = (s0: ExpeditionState, t: Target, seconds: number) => {
    let s = s0;
    let action: Action | null = null;
    const events: ExpeditionEvent[] = [];
    for (let k = 0; k < seconds / 0.1; k++) {
      const r = stepExpedition(s, action, at(t), all, k === 0, 0.1);
      s = r.state;
      action = r.action;
      events.push(...r.events);
    }
    return { s, action, events };
  };
  const target = (id: string) => all.find((t) => t.id === id)!;

  it('builds every place of the map: the reach spot, five sites, three panoramas, the depot', () => {
    expect(all.map((t) => t.kind)).toEqual([
      'reach',
      'sample',
      'sample',
      'sample',
      'sample',
      'sample',
      'panorama',
      'panorama',
      'panorama',
      'depot',
    ]);
    expect(all.filter((t) => t.kind === 'sample').reduce((n, t) => n + t.tubes, 0)).toBe(9);
    expect(tubesIn('17 & 18')).toBe(2);
    expect(CHAPTERS.map((c) => c.sols[0])).toEqual([408, 436, 535, 648]);
  });

  it('opens one chapter at a time (plus the panorama spots), in order', () => {
    const s = newExpedition();
    const open = openTargets(s, all).map((t) => t.id);
    expect(open).toContain('reach-enchanted-lake');
    expect(open).not.toContain('sample-10 & 11');
    expect(open).not.toContain('depot');
    expect(open.filter((id) => id.startsWith('pano-'))).toHaveLength(3);
    expect(nextTarget(s, openTargets(s, all))?.id).toBe('reach-enchanted-lake');
  });

  it('chapter 1: reaching Enchanted Lake and one laser analysis open chapter 2', () => {
    let s = newExpedition();
    const r = stepExpedition(s, null, at(target('reach-enchanted-lake')), all, false, 0.1);
    expect(r.state.reached).toEqual(['enchanted-lake']);
    expect(r.events.map((e) => e.kind)).toEqual(['reached']);
    expect(chapterDone(r.state)).toBe(false); // the laser analysis is still to do
    s = { ...r.state, finds: [{ type: 'clay', key: 'k', points: 25, first: true }] };
    const r2 = stepExpedition(s, null, at(target('reach-enchanted-lake')), all, false, 0.1);
    expect(r2.state.chapter).toBe(1);
    expect(r2.events.map((e) => e.kind)).toEqual(['chapter']);
    expect(openTargets(r2.state, all).map((t) => t.id)).toContain('sample-10 & 11');
  });

  it('one press, stopped in a ring, runs the whole coring sequence', () => {
    const s = { ...newExpedition(), chapter: 1 };
    const t = target('sample-10 & 11');
    // Moving: nothing starts.
    expect(stepExpedition(s, null, at(t, 2), all, true, 0.1).action).toBeNull();
    // Outside the ring: nothing starts.
    const away = offsetPoint(t.lat, t.lon, 0, t.radiusM + 5, 0);
    expect(stepExpedition(s, null, at(away), all, true, 0.1).action).toBeNull();
    // Stopped inside: one frame with the key down starts it; it then runs without the key.
    const done = run(s, t, CORE_S + 0.3);
    expect(done.s.samples).toEqual(['10 & 11']);
    expect(done.events.map((e) => e.kind)).toEqual(['collected']);
    expect(done.action).toBeNull();
    // Cored once only.
    expect(stepExpedition(done.s, null, at(t), all, true, 0.1).action).toBeNull();
  });

  it('where a sample ring and a panorama spot overlap, the sample comes first', () => {
    const s = { ...newExpedition(), chapter: 1, samples: ['10 & 11'] };
    // Standing on the Wildcat Ridge panorama spot, 4 m from the sample site.
    const r = stepExpedition(s, null, at(target('pano-wildcat-ridge')), all, true, 0.1);
    expect(r.action?.kind).toBe('core');
    expect(r.action?.targetId).toBe('sample-12 & 13');
  });

  it('a panorama takes the mast a full turn, then the spot is done', () => {
    const t = target('pano-wildcat-ridge');
    const s = { ...newExpedition(), chapter: 1, samples: ['10 & 11', '12 & 13'] };
    const half = run(s, t, PANORAMA_S / 2);
    expect(half.action?.kind).toBe('panorama');
    const r = run(s, t, PANORAMA_S + 0.3);
    expect(r.s.panoramas).toEqual(['wildcat-ridge']);
    // The chapter's last main objective: chapter 3 opens.
    expect(r.events.map((e) => e.kind)).toEqual(['panorama', 'chapter']);
    expect(openTargets(r.s, all).some((x) => x.id === 'pano-wildcat-ridge')).toBe(false);
  });

  it('the depot opens in chapter 4; the drop and the last panorama end the expedition', () => {
    const s: ExpeditionState = {
      ...newExpedition(),
      chapter: 3,
      samples: ['10 & 11', '12 & 13', '14 & 15', '16', '17 & 18'],
      panoramas: ['wildcat-ridge', 'three-forks'],
      reached: ['enchanted-lake'],
    };
    expect(openTargets({ ...s, chapter: 2 }, all).some((t) => t.kind === 'depot')).toBe(false);
    const r = run(s, target('depot'), 3);
    expect(r.s.deposited).toBe(true);
    expect(r.events.map((e) => e.kind)).toEqual(['deposited', 'complete']);
    expect(expeditionDone(r.s)).toBe(true);
    // One tube of each pair is left at the depot.
    const rack = tubeRack(r.s);
    expect(rack).toHaveLength(SAMPLE_TUBES);
    expect(rack.filter((x) => x.earlier)).toHaveLength(9);
    expect(rack.filter((x) => x.depot).map((x) => x.number)).toEqual(['11', '13', '15', '18']);
    expect(rack.filter((x) => !x.number)).toHaveLength(SAMPLE_TUBES - 18);
  });

  it('Ingenuity: absent at first, then flies its real flights in their chapters', () => {
    const s = newExpedition();
    expect(ingenuity(s)).toBeNull();
    expect(ingenuity({ ...s, chapter: 1 })).toBeNull();
    const c3 = { ...s, chapter: 2 };
    expect(ingenuity(c3)).toEqual({ at: 0, next: 1 }); // at flight 30's airfield, flight 31 next
    expect(ingenuity({ ...c3, flights: [31, 32, 33, 34] })).toEqual({ at: 4, next: 5 });
    // Flight 36 (sol 642) is after chapter 3 ends (sol 639).
    expect(ingenuity({ ...c3, flights: [31, 32, 33, 34, 35] })?.next).toBeNull();
    // Chapter 4 catches up to where it really was (flight 36), whatever was watched.
    const c4 = ingenuity({ ...s, chapter: 3 });
    expect(FLIGHTS[c4!.at]!.flight).toBe(36);
    expect(FLIGHTS[c4!.next!]!.flight).toBe(37);
  });

  it('saves the expedition and drops a broken save', () => {
    clearSave();
    expect(readSave()).toBeNull();
    const state = { ...newExpedition(), chapter: 2, samples: ['10 & 11'] };
    const rover = {
      lat: 18.45,
      lon: 77.4,
      headingRad: 1,
      batteryPct: 80,
      wheelsPct: 90,
      odometerM: 1200,
      energyUsedPct: 30,
    };
    writeSave({ state, rover, elapsedS: 300, savedMs: 1, tubesAt: null });
    expect(readSave()?.state.samples).toEqual(['10 & 11']);
    expect(readSave()?.rover.odometerM).toBe(1200);
    localStorage.setItem('copernico.game.expedition.v1', '{"state":{"chapter":9}}');
    expect(readSave()).toBeNull();
    clearSave();
  });
});

describe('AutoNav', () => {
  // A 400 × 400 m flat area with a steep ridge across it (x from −200 to +200 at north = 0),
  // broken by a 20 m gap at x = 120.
  const ridge = (x: number, n: number) =>
    Math.abs(n) < 6 && Math.abs(x - 120) > 10 ? 12 * (1 - Math.abs(n) / 6) : 0;
  const grid = (obstacles: Array<{ x: number; north: number; radiusM: number }> = []) =>
    new NavGrid({
      widthM: 400,
      heightM: 400,
      marginM: 10,
      height: ridge,
      sand: () => 0,
      obstacles,
    });

  it('plans through the gap in a ridge too steep to drive', () => {
    const path = grid().plan([-100, -100], [-100, 100], 3)!;
    expect(path).not.toBeNull();
    // It crosses north = 0 through the gap.
    const crossing = path.find((p, i) => i && Math.sign(p[1]) !== Math.sign(path[i - 1]![1]));
    expect(crossing).toBeDefined();
    let cx = 0;
    for (let i = 1; i < path.length; i++) {
      const [ax, an] = path[i - 1]!;
      const [bx, bn] = path[i]!;
      if (an <= 0 && bn > 0) cx = ax + ((bx - ax) * -an) / (bn - an);
    }
    expect(Math.abs(cx - 120)).toBeLessThan(10);
    expect(pathLength(path)).toBeGreaterThan(400);
  });

  it('keeps clear of boulders, and finds no way into a closed ring', () => {
    const g = grid([{ x: 0, north: -100, radiusM: 1 }]);
    const path = g.plan([-50, -100], [50, -100], 2)!;
    for (let i = 1; i < path.length; i++) {
      const [ax, an] = path[i - 1]!;
      const [bx, bn] = path[i]!;
      for (let t = 0; t <= 1; t += 0.05)
        expect(Math.hypot(ax + (bx - ax) * t, an + (bn - an) * t + 100)).toBeGreaterThan(
          1 + NAV.rockClearM - NAV.cellM,
        );
    }
    const ring = grid(
      Array.from({ length: 40 }, (_, k) => ({
        x: Math.cos((k / 40) * 2 * Math.PI) * 30,
        north: -100 + Math.sin((k / 40) * 2 * Math.PI) * 30,
        radiusM: 3,
      })),
    );
    expect(ring.plan([-100, 100], [0, -100], 2)).toBeNull();
  });

  it('follows a path: turns in place when facing away, drives when aligned, stops at the goal', () => {
    const path: Array<[number, number]> = [
      [0, 0],
      [0, 50],
    ];
    const goal = { x: 0, north: 50, radiusM: 8 };
    const away = follow({ x: 0, north: 0, headingRad: Math.PI }, path, { index: 0 }, goal);
    expect(away.throttle).toBe(0);
    expect(Math.abs(away.steer)).toBe(1);
    const ahead = follow({ x: 0, north: 0, headingRad: 0 }, path, { index: 0 }, goal);
    expect(ahead.throttle).toBeGreaterThan(0.5);
    expect(Math.abs(ahead.steer)).toBeLessThan(0.05);
    expect(follow({ x: 0, north: 47, headingRad: 0 }, path, { index: 1 }, goal).done).toBe(true);
  });
});

describe('terrain shadows', () => {
  it("hook into three's standard shader: the chunks they patch are there", () => {
    const m = new MeshStandardMaterial();
    receiveSunShadow(m, new SunShadows());
    const shader = {
      uniforms: {},
      vertexShader: ShaderLib.physical.vertexShader,
      fragmentShader: ShaderLib.physical.fragmentShader,
    } as unknown as WebGLProgramParametersWithUniforms;
    m.onBeforeCompile(shader, undefined as never);
    expect(shader.vertexShader).toContain('vSunWorld = (modelMatrix * sw).xyz;');
    expect(shader.fragmentShader).toContain('reflectedLight.directDiffuse *= sunVis;');
    expect(shader.fragmentShader).toContain('float sunVisAt(vec2 p)');
    expect(Object.keys(shader.uniforms)).toEqual(
      expect.arrayContaining(['tSDetail', 'tSMid', 'tSFar', 'uSDetail']),
    );
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

describe('the landing mission', () => {
  const all = allTargets([], LANDING);
  const at = (t: { lat: number; lon: number }): RoverState => initialRover(t.lat, t.lon, 0);
  const place = (id: string) => all.find((t) => t.id === `reach-${id}`)!;
  const find = { type: ROCK_TYPES[0]!, key: 'landing:1', points: 10, first: true };

  it('has the three pieces of hardware as places, and only the first chapter open', () => {
    expect(all.map((t) => t.id)).toEqual([
      'reach-descent-stage',
      'reach-parachute',
      'reach-heat-shield',
    ]);
    const s = newExpedition('landing');
    expect(missionOf(s)).toBe(LANDING);
    expect(openTargets(s, all).map((t) => t.id)).toEqual(['reach-descent-stage']);
    expect(ingenuity(s)).toBeNull();
    expect(tubeRack(s).every((t) => t.number === null)).toBe(true);
  });

  it('opens the hardware chapter after the laser and the descent stage, and ends at the parachute', () => {
    let s = newExpedition('landing');
    let r = stepExpedition(s, null, at(place('descent-stage')), all, false, 0.1);
    expect(r.events.map((e) => e.kind)).toEqual(['reached']);
    expect(r.state.chapter).toBe(0); // the laser is still to do
    s = { ...r.state, finds: [find] };
    r = stepExpedition(s, null, at(place('descent-stage')), all, false, 0.1);
    expect(r.events.map((e) => e.kind)).toEqual(['chapter']);
    expect(r.state.chapter).toBe(1);
    r = stepExpedition(r.state, null, at(place('parachute')), all, false, 0.1);
    expect(r.events.map((e) => e.kind)).toEqual(['reached', 'complete']);
    expect(expeditionDone(r.state)).toBe(true);
  });

  it('places the hardware where HiRISE saw it, relative to the rover (landing-hardware.json)', () => {
    const rover = at(LANDING.start);
    const expected: Record<string, [number, number]> = {
      parachute: [1148, 293],
      'descent-stage': [697, 310],
      'heat-shield': [1468, 64],
    };
    for (const h of LANDING_HARDWARE) {
      const e = expected[h.id];
      if (!e) continue;
      expect(groundDistanceM(rover, h)).toBeGreaterThan(e[0] * 0.99);
      expect(groundDistanceM(rover, h)).toBeLessThan(e[0] * 1.01);
      const deg = ((bearingRad(rover, h) * 180) / Math.PI + 360) % 360;
      expect(Math.abs(deg - e[1])).toBeLessThan(1.5);
    }
  });

  it('keeps each mission’s progress apart', () => {
    clearSave('landing');
    clearSave('delta');
    const rover = {
      lat: LANDING.start.lat,
      lon: LANDING.start.lon,
      headingRad: 0,
      batteryPct: 90,
      wheelsPct: 100,
      odometerM: 300,
      energyUsedPct: 10,
    };
    writeSave({ state: newExpedition('landing'), rover, elapsedS: 60, savedMs: 1, tubesAt: null });
    expect(readSave('landing')?.rover.odometerM).toBe(300);
    expect(readSave('delta')).toBeNull();
    clearSave('landing');
    expect(readSave('landing')).toBeNull();
  });
});

describe('the Ingenuity deployment mission', () => {
  const all = allTargets([], INGENUITY_MISSION);
  const at = (t: { lat: number; lon: number }): RoverState => initialRover(t.lat, t.lon, 0);
  /** Holds the action key at a place until the sequence there ends. */
  const doStep = (s0: ExpeditionState, where: { lat: number; lon: number }, seconds: number) => {
    let s = s0;
    let action: Action | null = null;
    const events: ExpeditionEvent[] = [];
    for (let k = 0; k <= seconds / 0.1 + 1; k++) {
      const r = stepExpedition(s, action, at(where), all, k === 0, 0.1);
      s = r.state;
      action = r.action;
      events.push(...r.events);
    }
    return { s, events };
  };

  it('one press at the field runs the whole deployment; stopping at the overlook films the flight', () => {
    const s = newExpedition('ingenuity');
    const deploy = INGENUITY_MISSION.chapters[0]!;
    expect(listedObjectives(deploy).map((o) => o.id)).toEqual(['deploy-heli']);
    // Away from the field, the key does nothing.
    expect(doStep(s, INGENUITY_MISSION.start, 1).s.steps).toEqual([]);
    // At the field: the shield comes off…
    let r = doStep(s, WRIGHT_FIELD, STEP_S.shield);
    expect(r.s.steps).toEqual(['shield']);
    expect(objectiveDone(r.s, deploy.objectives[0]!, deploy)).toBe(false); // its chain is under way
    // …then the helicopter turns upright and is set down by itself, without the key.
    const off = WRIGHT_FIELD;
    let state = r.s;
    let action: Action | null = null;
    for (let k = 0; k < (STEP_S.rotate + STEP_S.drop) / 0.1 + 3; k++) {
      const x = stepExpedition(state, action, at(off), all, false, 0.1);
      state = x.state;
      action = x.action;
    }
    expect(state.steps).toEqual(['shield', 'rotate', 'drop']);
    expect(state.dropAt).toEqual({ lat: WRIGHT_FIELD.lat, lon: WRIGHT_FIELD.lon });
    expect(state.chapter).toBe(0);
    // The slides: one every DEPLOY_SLIDE_S over the three steps.
    expect(STEP_S.shield + STEP_S.rotate + STEP_S.drop).toBe(DEPLOY_SLIDE_S * DEPLOY_SLIDES.length);
    // Not facing the overlook: the turn in place is still under way.
    expect(stepExpedition(state, null, at(off), all, false, 0.1).state.steps).not.toContain('aim');
    // Facing it (within 2°): done.
    const facing = { ...at(off), headingRad: bearingRad(off, VAN_ZYL) + 0.01 };
    const aimed = stepExpedition(state, null, facing, all, false, 0.1);
    expect(aimed.state.steps).toContain('aim');
    // 12 m on towards the overlook from where it was set down: clear, the chapter is done.
    const k = (DRIVE_STEP_M.away + 0.3) / groundDistanceM(at(off), VAN_ZYL);
    const on = { lat: off.lat + (VAN_ZYL.lat - off.lat) * k, lon: off.lon + (VAN_ZYL.lon - off.lon) * k };
    const half = { lat: off.lat + (VAN_ZYL.lat - off.lat) * k * 0.5, lon: off.lon + (VAN_ZYL.lon - off.lon) * k * 0.5 };
    expect(stepExpedition(aimed.state, null, at(half), all, false, 0.1).state.steps).not.toContain('away');
    const away = stepExpedition(aimed.state, null, { ...at(on), headingRad: facing.headingRad }, all, false, 0.1);
    expect(away.state.steps).toContain('away');
    expect(away.state.chapter).toBe(1);
    expect(objectiveDone(away.state, deploy.objectives[0]!, deploy)).toBe(true);
    // At Van Zyl Overlook, stopped: the film step is done (no key), and NASA's video follows.
    r = doStep(away.state, VAN_ZYL, STEP_S.film + 0.2);
    const film = r.events.find((e) => e.kind === 'step');
    expect(film && film.kind === 'step' && film.step).toBe('film');
    expect(r.events.map((e) => e.kind)).toContain('complete');
    expect(expeditionDone(r.s)).toBe(true);
  });

  it('the film waits for the rover to stop in the overlook zone', () => {
    const s = { ...newExpedition('ingenuity'), chapter: 1, steps: ['shield', 'rotate', 'drop', 'aim', 'away'] } as ExpeditionState;
    const moving = { ...at(VAN_ZYL), speed: 2 };
    expect(stepExpedition(s, null, moving, all, false, 0.1).action).toBeNull();
    expect(stepExpedition(s, null, at(VAN_ZYL), all, false, 0.1).action?.kind).toBe('film');
    // Outside the zone, stopped: nothing.
    expect(stepExpedition(s, null, at(WRIGHT_FIELD), all, false, 0.1).action).toBeNull();
  });

  it('puts Van Zyl Overlook 64 m from Wright Brothers Field, as NASA gives it (64.3 m)', () => {
    const d = groundDistanceM(at(WRIGHT_FIELD), VAN_ZYL);
    expect(d).toBeGreaterThan(62);
    expect(d).toBeLessThan(66);
  });
});

describe('free exploration', () => {
  it('never ends: every place of the map is an optional discovery', () => {
    for (const m of [FREE_LANDING, FREE_DELTA]) {
      const c = m.chapters[0]!;
      expect(m.chapters).toHaveLength(1);
      expect(c.objectives.length).toBeGreaterThan(0);
      expect(c.objectives.every((o) => o.optional)).toBe(true);
      expect(new Set(c.objectives.map((o) => o.id)).size).toBe(c.objectives.length);
      const s = newExpedition(m.id);
      expect(expeditionDone(s)).toBe(false);
      expect(chapterDone(s)).toBe(false);
    }
    // The delta's sample sites can be cored there; the landing site keeps its hardware, no video.
    expect(FREE_DELTA.chapters[0]!.objectives.some((o) => o.kind === 'sample')).toBe(true);
    expect(FREE_LANDING.chapters[0]!.objectives.every((o) => o.kind === 'reach')).toBe(true);
    expect(FREE_LANDING.intro).toBeUndefined();
  });

  it('reads a place opened from the planner (play.html#explore=lat,lon)', () => {
    expect(exploreFromHash('#explore=18.453800,77.414100')).toEqual({ lat: 18.4538, lon: 77.4141 });
    expect(exploreLink(18.4538, 77.4141)).toBe('./play.html#explore=18.453800,77.414100');
    expect(exploreFromHash('#explore=abc')).toBeNull();
    expect(exploreFromHash('#m=xyz')).toBeNull();
  });
});
