import type { RouteResult } from '@copernico/domain';
import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decodeShare,
  encodeShare,
  fromMissionInput,
  MAX_SHARE_BYTES,
  toMissionInput,
  type MissionState,
} from './codec';
import { toCsv, toGeoJson } from './export';
import { deleteMission, listMissions, renameMission, saveMission, ulid } from './storage';

const state: MissionState = {
  waypoints: [
    {
      id: 'a',
      lat: 18.44457,
      lon: 77.45091,
      label: 'Octavia E. Butler Landing',
      poiId: 'landing-site',
    },
    {
      id: 'b',
      lat: 18.45296,
      lon: 77.40821,
      label: 'Three Forks',
      poiId: 'three-forks',
      dwellMin: 30,
    },
  ],
  profile: 'lower-risk',
  returnToStart: true,
  evaStartUtcMs: Date.UTC(2026, 9, 2, 9, 34, 0),
};
const versions = {
  datasetVersion: 'jezero-v1',
  algorithmVersion: 'route@0.1.0',
  parameterSet: 'eva-params@1#abc',
};

const route = {
  status: 'ok',
  profile: 'lower-risk',
  points: [
    { lat: 18.44457, lon: 77.45091, elevationM: -2550 },
    { lat: 18.45296, lon: 77.40821, elevationM: -2530 },
    { lat: 18.44457, lon: 77.45091, elevationM: -2550 },
  ],
  legStarts: [0, 1],
  legs: [
    {
      fromWaypoint: 0,
      toWaypoint: 1,
      horizontalDistanceM: 2480,
      elevationGainM: 45,
      elevationLossM: 20,
      maxTerrainSlopeDeg: 15,
      estimatedDurationS: 6000,
    },
    {
      fromWaypoint: 1,
      toWaypoint: 2,
      horizontalDistanceM: 2500,
      elevationGainM: 20,
      elevationLossM: 45,
      maxTerrainSlopeDeg: 12,
      estimatedDurationS: 6100,
    },
  ],
  metrics: {
    horizontalDistanceM: 4980,
    distance3dM: 4985,
    elevationGainM: 65,
    elevationLossM: 65,
    maxTerrainSlopeDeg: 15,
    estimatedDurationS: 12100,
    walkback: { ok: true, worstMarginS: 13000, firstViolationAtM: null },
  },
} as unknown as RouteResult;

describe('mission codec', () => {
  it('round-trips the app state through a validated MissionInput', () => {
    const m = toMissionInput('Delta loop', state, versions, route);
    expect(m.route?.geometry).toHaveLength(3);
    const back = fromMissionInput(m);
    expect(
      back.waypoints.map(({ lat, lon, label, poiId, dwellMin }) => ({
        lat,
        lon,
        label,
        poiId,
        dwellMin,
      })),
    ).toEqual(
      state.waypoints.map(({ lat, lon, label, poiId, dwellMin }) => ({
        lat,
        lon,
        label,
        poiId,
        dwellMin,
      })),
    );
    expect(back.evaStartUtcMs).toBe(state.evaStartUtcMs);
    expect(back.profile).toBe('lower-risk');
  });

  it('share links round-trip inputs only (the receiver recomputes the route)', () => {
    const m = toMissionInput('Delta loop', state, versions, route);
    const hash = encodeShare(m);
    expect(hash.length).toBeLessThan(1200);
    const d = decodeShare(hash);
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.mission.route).toBeNull();
      expect(d.mission.waypoints).toEqual(m.waypoints);
    }
  });

  it('rejects malformed, oversized or schema-invalid share links', () => {
    const enc = (o: unknown) =>
      '#m=' + btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const valid = toMissionInput('x', state, versions, null);
    expect(decodeShare('')).toEqual({ ok: false, reason: 'absent' });
    expect(decodeShare('#m=%%%')).toEqual({ ok: false, reason: 'invalid' });
    expect(decodeShare('#m=' + 'A'.repeat(MAX_SHARE_BYTES * 2))).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(
      decodeShare(
        enc({
          ...valid,
          waypoints: [
            { lat: 999, lon: 0 },
            { lat: 0, lon: 0 },
          ],
        }),
      ).ok,
    ).toBe(false);
    expect(decodeShare(enc({ ...valid, region: 'gale' })).ok).toBe(false);
    // Unknown keys are dropped, control characters stripped from text.
    const d = decodeShare(
      enc({ ...valid, name: 'a\u0000b\u001fc', __proto__: { polluted: true }, extra: 1 }),
    );
    expect(d.ok && d.mission.name).toBe('abc');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('never throws on arbitrary fragments', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 400 }), (s) => {
        const r = decodeShare('#m=' + s);
        expect(typeof r.ok).toBe('boolean');
      }),
    );
  });
});

describe('saved missions (browser storage)', () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('creates ULIDs in the contract format', () => {
    expect(ulid()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('saves, lists, renames (new version) and deletes', () => {
    const m = saveMission(toMissionInput('First', state, versions, route))!;
    expect(listMissions().map((x) => x.name)).toEqual(['First']);
    expect(renameMission(m.id, 'Renamed')).toBe(true);
    const [r] = listMissions();
    expect(r!.name).toBe('Renamed');
    expect(r!.version).toBe(2);
    expect(deleteMission(m.id)).toBe(true);
    expect(listMissions()).toEqual([]);
  });

  it('degrades to "nothing saved" when storage is unavailable or corrupt', () => {
    window.localStorage.setItem('copernico.missions.v1', '{not json');
    expect(listMissions()).toEqual([]);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    expect(saveMission(toMissionInput('x', state, versions, null))).toBeNull();
  });
});

describe('exports', () => {
  const names = (w: { label?: string }, i: number) => w.label ?? `Stop ${i}`;
  const input = {
    name: 'Delta loop',
    waypoints: state.waypoints,
    route,
    timeline: null,
    versions,
    names,
  };

  it('writes GeoJSON with [lon, lat, elevation] and a Mars CRS note', () => {
    const g = JSON.parse(toGeoJson(input));
    expect(g.type).toBe('FeatureCollection');
    expect(g.crs_note).toMatch(/Mars 2015 sphere/);
    expect(g.features[0].geometry.coordinates[0]).toEqual([77.45091, 18.44457, -2550]);
    expect(g.features).toHaveLength(3);
    expect(g.features[2].properties).toMatchObject({
      order: 2,
      dwell_min: 30,
      poi_id: 'three-forks',
    });
  });

  it('writes one CSV row per leg and neutralises spreadsheet formulas', () => {
    const csv = toCsv({
      ...input,
      waypoints: [{ ...state.waypoints[0]!, label: '=HYPERLINK("x")' }, state.waypoints[1]!],
    });
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(`"'=HYPERLINK(""x"")"`);
    // The return leg ends at the start (waypoint 1 → back to the first waypoint).
    expect(lines[2]!.split(',')[2]).toBe(`"'=HYPERLINK(""x"")"`);
  });
});
