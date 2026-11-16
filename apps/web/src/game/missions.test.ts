import { describe, expect, it } from 'vitest';
import en from '../i18n/en.json';
import es from '../i18n/es.json';
import { M_PER_DEG } from '../lib/math';
import {
  CHUTE,
  FIRST_SAMPLE,
  FLIGHT_26,
  FREE_FLOOR,
  FREE_NERETVA,
  FREE_OF_AREA,
  FREE_RIM,
  LEOPARD,
  LOOKOUT,
  MISSIONS,
  RIM,
  ROCHETTE,
  STEP_S,
  airObjectives,
  allTargets,
  chapterDone,
  expeditionDone,
  laserSpotAt,
  newExpedition,
  newlyDone,
  objectiveDone,
  sampleLockedBy,
  stepExpedition,
  type Action,
  type ExpeditionState,
  type Find,
  type MissionDef,
} from './expedition';
import { HELI, newHeli, stepHeli, stepPhoto, timeLeftS, type HeliState } from './heli';
import { groundDistanceM, initialRover, type RoverState } from './roverSim';

/**
 * The game's maps (scripts/geospatial/copernico_geo/game.py AREAS): centre and detail extent (m).
 * Every place a mission sends the rover (or Ingenuity) must be on its map, inside the 40 m margin
 * the rover keeps from the edge.
 */
const AREAS: Record<string, [number, number, number, number]> = {
  delta: [18.4537, 77.4063, 1500, 1300],
  landing: [18.4495, 77.4531, 3000, 1300],
  floor: [18.4362, 77.4469, 1700, 1700],
  neretva: [18.4945, 77.313, 2000, 1200],
  rim: [18.4662, 77.2788, 3000, 1400],
};
const onMap = (m: MissionDef, p: { lat: number; lon: number }, margin = 60) => {
  const [lat, lon, w, h] = AREAS[m.areaId]!;
  const north = (p.lat - lat) * M_PER_DEG;
  const east = (p.lon - lon) * M_PER_DEG * Math.cos((lat * Math.PI) / 180);
  return Math.abs(east) <= w / 2 - margin && Math.abs(north) <= h / 2 - margin;
};
const at = (p: { lat: number; lon: number }): RoverState => initialRover(p.lat, p.lon, 0);

const SAMPLES = ['1', '2 & 3', '25', '26', '27', '28'].map((n, i) => ({
  sampleNumber: n,
  name: `S${n}`,
  ...(
    {
      '1': { lat: 18.42767, lon: 77.45167 },
      '2 & 3': ROCHETTE,
      '25': { lat: 18.49747, lon: 77.30515 },
      '26': { lat: 18.46059, lon: 77.26474 },
      '27': { lat: 18.46059, lon: 77.26466 },
      '28': { lat: 18.46172, lon: 77.25846 },
    } as Record<string, { lat: number; lon: number }>
  )[n]!,
  sol: i,
})) as never;

type Strings = { game: Record<string, Record<string, unknown>> };
const STRINGS: Array<[string, Strings]> = [
  ['en', en as unknown as Strings],
  ['es', es as unknown as Strings],
];

describe('missions 3, 4, 6 and 7', () => {
  const NEW = [FIRST_SAMPLE, CHUTE, LEOPARD, RIM];

  it('are all on the mission slate with their maps, places and strings', () => {
    for (const m of NEW) {
      expect(MISSIONS[m.id]).toBe(m);
      expect(onMap(m, m.start)).toBe(true);
      const places = [...m.reach, ...m.panoramas, ...(m.spots ?? []), ...(m.stations ?? [])];
      for (const p of places) expect(onMap(m, p), `${m.id}: ${p.id}`).toBe(true);
      for (const c of m.chapters) {
        for (const [lang, j] of STRINGS) {
          expect(j.game.chapters![c.id], `${lang} chapter ${c.id}`).toBeTruthy();
          for (const o of c.objectives) {
            expect(j.game.objectives![o.id], `${lang} objective ${o.id}`).toBeTruthy();
            if (o.story) expect(j.game.story![o.story], `${lang} story ${o.story}`).toBeTruthy();
          }
        }
        for (const o of c.objectives) {
          if (o.kind === 'reach')
            expect(
              m.reach.some((r) => r.id === o.target),
              o.id,
            ).toBe(true);
          if (o.kind === 'panorama')
            expect(
              m.panoramas.some((p) => p.id === o.panorama),
              o.id,
            ).toBe(true);
          if (o.kind === 'laser' && o.at)
            expect(
              m.spots?.some((p) => p.id === o.at),
              o.id,
            ).toBe(true);
          if (o.kind === 'step' && o.at)
            expect(
              m.stations?.some((p) => p.id === o.at),
              o.id,
            ).toBe(true);
          if (o.kind === 'sample' && o.after)
            expect(
              c.objectives.some((x) => x.id === o.after),
              o.id,
            ).toBe(true);
        }
      }
      if (m.epilogue) for (const [, j] of STRINGS) expect(j.game.story![m.epilogue]).toBeTruthy();
    }
  });

  it('put Lookout Hill at the top of the climb and Ingenuity’s flight 26 within its real length', () => {
    // The climb from the sol-1280 position to Lookout Hill (sol 1354) is about 2 km.
    const climb = groundDistanceM(RIM.start, LOOKOUT);
    expect(climb).toBeGreaterThan(1800);
    expect(climb).toBeLessThan(2200);
    // Flight 26: takeoff → backshell → parachute → airfield, about 320 m (NASA: 360 m flown).
    const [back, chute, field] = ['backshell', 'chute', 'airfield-26'].map((id) =>
      CHUTE.reach.find((r) => r.id === id)!,
    );
    const legs =
      groundDistanceM(FLIGHT_26.from, back!) +
      groundDistanceM(back!, chute!) +
      groundDistanceM(chute!, field!);
    expect(legs).toBeGreaterThan(280);
    expect(legs).toBeLessThan(380);
    // At the game's cruise speed it fits in the 159 s, with time to hover for the photos.
    expect(
      legs / HELI.maxMps + 2 * HELI.photoHoldS + HELI.spinUpS + HELI.cruiseM / HELI.climbMps,
    ).toBeLessThan(FLIGHT_26.seconds * 0.75);
  });

  it('the empty tube: MOXIE at the start, then Roubion; Rochette must be analysed before it is cored', () => {
    const all = allTargets(SAMPLES, FIRST_SAMPLE);
    let s = newExpedition('firstSample');
    // MOXIE: one press at the start runs it to the end.
    let action: Action | null = null;
    for (let k = 0; k <= STEP_S.moxie / 0.1 + 1; k++) {
      const r = stepExpedition(s, action, at(FIRST_SAMPLE.start), all, k === 0, 0.1);
      s = r.state;
      action = r.action;
    }
    expect(s.steps).toContain('moxie');
    expect(newlyDone(newExpedition('firstSample'), s).map((o) => o.story)).toEqual(['moxie']);
    s = { ...s, samples: ['1'] };
    const before = { ...s };
    const next = stepExpedition(s, null, at(FIRST_SAMPLE.start), all, false, 0.1).state;
    expect(next.chapter).toBe(1);
    expect(newlyDone(before, next).map((o) => o.id)).toEqual([]);
    // At Rochette: the core waits for SuperCam.
    expect(sampleLockedBy(next, '2 & 3')).toBe('rochette-laser');
    const press = stepExpedition(next, null, at(ROCHETTE), all, true, 0.1);
    expect(press.action).toBeNull();
    // An analysis there counts (made away from it, it does not).
    expect(laserSpotAt(next, at(ROCHETTE))).toBe('rochette');
    expect(laserSpotAt(next, at(FIRST_SAMPLE.start))).toBeNull();
    const find: Find = { type: 'basalt', key: 'k', points: 10, first: true, at: 'rochette' };
    const analysed: ExpeditionState = { ...next, finds: [find] };
    const c = FIRST_SAMPLE.chapters[1]!;
    expect(objectiveDone(analysed, c.objectives[0]!, c)).toBe(true);
    const { at: _at, ...elsewhere } = find;
    expect(objectiveDone({ ...next, finds: [elsewhere] }, c.objectives[0]!, c)).toBe(false);
    expect(sampleLockedBy(analysed, '2 & 3')).toBeNull();
    expect(stepExpedition(analysed, null, at(ROCHETTE), all, true, 0.1).action?.kind).toBe('core');
  });

  it('flight 26: the places are reached by Ingenuity, not by driving', () => {
    const all = allTargets([], CHUTE);
    const s = newExpedition('chute');
    expect(airObjectives(s, all).map((a) => a.o.target)).toEqual([
      'backshell',
      'chute',
      'airfield-26',
    ]);
    const back = CHUTE.reach.find((r) => r.id === 'backshell')!;
    // The rover's state passing there marks nothing.
    expect(stepExpedition(s, null, at(back), all, false, 0.1).state.reached).toEqual([]);
    const done = { ...s, reached: ['backshell', 'chute', 'airfield-26'] };
    expect(chapterDone(done)).toBe(true);
    expect(expeditionDone(done)).toBe(true);
  });

  it('leopard spots: three analyses at Cheyava Falls, then Sapphire Canyon', () => {
    const s: ExpeditionState = { ...newExpedition('leopard'), chapter: 1 };
    const c = LEOPARD.chapters[1]!;
    expect(sampleLockedBy(s, '25')).toBe('leopard-laser');
    const f = (k: string): Find => ({
      type: 'sulfate',
      key: k,
      points: 20,
      first: false,
      at: 'cheyava',
    });
    const two = { ...s, finds: [f('a'), f('b')] };
    expect(objectiveDone(two, c.objectives[0]!, c)).toBe(false);
    const three = { ...s, finds: [f('a'), f('b'), f('c')] };
    expect(objectiveDone(three, c.objectives[0]!, c)).toBe(true);
    expect(newlyDone(two, three).map((o) => o.story)).toEqual(['leopard']);
    expect(LEOPARD.parkedHelicopter).toBeTruthy();
  });

  it('the rim: a dust devil recorded counts once', () => {
    const s: ExpeditionState = { ...newExpedition('rim'), chapter: 1, samples: ['26', '28'] };
    expect(chapterDone(s)).toBe(false);
    const rec = { ...s, recordings: 1 };
    expect(chapterDone(rec)).toBe(true);
    expect(newlyDone(s, rec).map((o) => o.story)).toEqual(['devil']);
  });

  it('free exploration covers every map, never ends and needs no order', () => {
    for (const m of [FREE_FLOOR, FREE_NERETVA, FREE_RIM]) {
      expect(FREE_OF_AREA[m.areaId]).toBe(m.id);
      const c = m.chapters[0]!;
      expect(c.objectives.every((o) => o.optional)).toBe(true);
      expect(c.objectives.some((o) => o.kind === 'sample' && 'after' in o && o.after)).toBe(false);
      expect(expeditionDone(newExpedition(m.id))).toBe(false);
    }
    for (const area of Object.keys(AREAS)) expect(MISSIONS[FREE_OF_AREA[area]!].areaId).toBe(area);
  });
});

describe('Ingenuity flown by the player', () => {
  const B = { west: 77.4, south: 18.4, east: 77.5, north: 18.5 };
  const run = (
    h0: HeliState,
    input: Partial<Parameters<typeof stepHeli>[1]>,
    s: number,
    canLand = false,
  ) => {
    let h = h0;
    const events: string[] = [];
    for (let k = 0; k < s / 0.05; k++) {
      const r = stepHeli(
        h,
        { throttle: 0, steer: 0, boost: false, action: false, ...input },
        0.05,
        canLand,
        B,
      );
      h = r.h;
      if (r.event) events.push(r.event);
    }
    return { h, events };
  };
  const start = newHeli({ lat: 18.45, lon: 77.43 }, 0, 159);

  it('takes off with the key, spins up and climbs to 8 m; flight time runs only in the air', () => {
    expect(run(start, {}, 3).h.phase).toBe('ground');
    expect(run(start, {}, 3).h.airS).toBe(0);
    const first = stepHeli(
      start,
      { throttle: 0, steer: 0, boost: false, action: true },
      0.05,
      false,
      B,
    );
    expect(first.event).toBe('takeoff');
    const up = run(first.h, {}, HELI.spinUpS + HELI.cruiseM / HELI.climbMps + 0.5);
    expect(up.h.phase).toBe('fly');
    expect(up.h.altM).toBe(HELI.cruiseM);
    expect(up.h.airS).toBeGreaterThan(HELI.spinUpS);
  });

  it('flies forward at up to its cruise speed, hovers when nothing is pressed, lands only where allowed', () => {
    const flying: HeliState = { ...start, phase: 'fly', altM: HELI.cruiseM };
    const fwd = run(flying, { throttle: 1 }, 6);
    expect(fwd.h.speed).toBeCloseTo(HELI.maxMps, 5);
    expect(fwd.h.lat).toBeGreaterThan(start.lat); // heading 0: north
    expect(run(fwd.h, {}, 4).h.speed).toBe(0);
    // The key does not land it where landing is not allowed…
    expect(run(flying, { action: true }, 1).h.phase).toBe('fly');
    // …and does where it is.
    const down = run(flying, { action: true }, HELI.cruiseM / HELI.descendMps + 1, true);
    expect(down.events).toEqual(['down']);
    expect(down.h.forced).toBe(false);
  });

  it('comes down by itself when its battery is spent', () => {
    const late: HeliState = { ...start, phase: 'fly', altM: HELI.cruiseM, airS: 158.9 };
    const r = run(late, { throttle: 1 }, HELI.cruiseM / HELI.descendMps + 1);
    expect(r.events).toEqual(['down']);
    expect(r.h.forced).toBe(true);
    expect(timeLeftS(r.h)).toBe(0);
    // No take-off again on an empty battery.
    expect(
      stepHeli(r.h, { throttle: 0, steer: 0, boost: false, action: true }, 0.05, false, B).event,
    ).toBeNull();
  });

  it('takes an aerial photo after hovering slowly over a place', () => {
    let h: HeliState = { ...start, phase: 'fly', altM: HELI.cruiseM };
    let taken: string | null = null;
    for (let k = 0; k < HELI.photoHoldS / 0.1 + 2 && !taken; k++)
      ({ h, taken } = stepPhoto(h, 'backshell', 0.1));
    expect(taken).toBe('backshell');
    // Too fast: the hold restarts.
    const fast = stepPhoto(
      { ...h, speed: HELI.photoMaxMps + 1, photo: { id: 'backshell', s: 1 } },
      'backshell',
      0.1,
    );
    expect(fast.taken).toBeNull();
    expect(fast.h.photo).toBeNull();
  });
});
