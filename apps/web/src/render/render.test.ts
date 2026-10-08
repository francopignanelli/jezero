import { greatCircleDistance } from '@copernico/domain';
import { describe, expect, it } from 'vitest';
import { altitudeFloor, JEZERO_ZONE } from './cameraConstraints';
import { densify, removeSpikes, roundTrack, simplify } from './pathGeometry';

describe('route display geometry', () => {
  const route = [
    { lat: 18.4446, lon: 77.4509 },
    { lat: 18.453, lon: 77.4082 },
    { lat: 18.4586, lon: 77.4059 },
  ];

  it('densify keeps every original vertex and bounds the step length', () => {
    const d = densify(route, 15);
    for (const v of route) expect(d.some((p) => p.lat === v.lat && p.lon === v.lon)).toBe(true);
    for (let i = 1; i < d.length; i++)
      expect(greatCircleDistance(d[i - 1]!, d[i]!)).toBeLessThanOrEqual(15.01);
  });

  it('densified points stay on the original straight segments (no corner rounding)', () => {
    const d = densify([route[0]!, route[1]!], 20);
    const [a, b] = [route[0]!, route[1]!];
    for (const p of d) {
      const t = (p.lon - a.lon) / (b.lon - a.lon);
      expect(p.lat).toBeCloseTo(a.lat + (b.lat - a.lat) * t, 9);
    }
  });

  it('simplify removes collinear noise but keeps corners', () => {
    const line = densify(route, 10);
    const s = simplify(line, 1);
    expect(s.length).toBe(3);
    expect(s[1]).toEqual(line.find((p) => p.lat === route[1]!.lat && p.lon === route[1]!.lon));
  });
});

describe('camera exploration funnel', () => {
  it('allows low flight over Jezero and blocks it far away, with a smooth transition', () => {
    const terrain = -2600;
    expect(altitudeFloor(JEZERO_ZONE, 0, terrain)).toBe(terrain + JEZERO_ZONE.minAboveTerrainM);
    expect(altitudeFloor(JEZERO_ZONE, 2_000_000, terrain)).toBe(JEZERO_ZONE.minAltitudeOutsideM);
    let prev = -Infinity;
    for (let d = 0; d <= 600_000; d += 10_000) {
      const f = altitudeFloor(JEZERO_ZONE, d, terrain);
      expect(f).toBeGreaterThanOrEqual(prev); // monotone: never a hole to slip through
      prev = f;
    }
  });
});

describe('close-up spots', async () => {
  const { clearanceAt, JEZERO_ZONE: zone } = await import('./cameraConstraints');
  const spot = { lat: 18.4369, lon: 77.232, radiusM: 150, minAboveTerrainM: 4 };
  it('lowers the clearance near the spot and blends back to the zone value', () => {
    expect(clearanceAt(zone, [{ ...spot, distanceM: 50 }])).toBe(4);
    const mid = clearanceAt(zone, [{ ...spot, distanceM: 225 }]);
    expect(mid).toBeGreaterThan(4);
    expect(mid).toBeLessThan(zone.minAboveTerrainM);
    expect(clearanceAt(zone, [{ ...spot, distanceM: 400 }])).toBe(zone.minAboveTerrainM);
    expect(clearanceAt(zone, [])).toBe(zone.minAboveTerrainM);
  });
});

describe('label occlusion by the planet', async () => {
  const { Cartesian3 } = await import('cesium');
  const { isBehindPlanet } = await import('./annotations');
  const R = 3_396_190;
  it('hides points on the far side and keeps points on the near side', () => {
    const camera = new Cartesian3(R + 5_000_000, 0, 0);
    expect(isBehindPlanet(camera, new Cartesian3(R - 2_500, 0, 0))).toBe(false); // sub-camera point
    expect(isBehindPlanet(camera, new Cartesian3(-(R - 2_500), 0, 0))).toBe(true); // antipode
    expect(isBehindPlanet(camera, new Cartesian3(0, R, 0))).toBe(true); // just past the limb (occluder is inside R)
  });
});

describe('rover track display', () => {
  const M = 3_396_190 * (Math.PI / 180); // metres per degree
  const at = (eastM: number, northM: number) => ({
    lat: 18.45 + northM / M,
    lon: 77.4 + eastM / (M * Math.cos((18.45 * Math.PI) / 180)),
  });
  /** Distance (m) from p to the polyline. */
  const toLine = (p: { lat: number; lon: number }, line: Array<{ lat: number; lon: number }>) => {
    let best = Infinity;
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1]!;
      const b = line[i]!;
      const ax = 0,
        ay = 0;
      const bx = (b.lon - a.lon) * M * Math.cos((18.45 * Math.PI) / 180),
        by = (b.lat - a.lat) * M;
      const px = (p.lon - a.lon) * M * Math.cos((18.45 * Math.PI) / 180),
        py = (p.lat - a.lat) * M;
      const t = Math.max(
        0,
        Math.min(1, ((px - ax) * bx + (py - ay) * by) / (bx * bx + by * by || 1)),
      );
      best = Math.min(best, Math.hypot(px - t * bx, py - t * by));
    }
    return best;
  };
  it('removes short out-and-back spikes but keeps real turns', () => {
    const track = [at(0, 0), at(100, 0), at(110, 4), at(101, 0.5), at(200, 0), at(200, 100)];
    const cleaned = removeSpikes(track, 20);
    expect(cleaned).toHaveLength(5); // the 10 m spike is gone, the 90° corner at (200, 0) stays
    expect(cleaned.at(-2)).toEqual(at(200, 0));
  });
  it('rounds corners within the stated distance of the true track', () => {
    const track = [at(0, 0), at(300, 0), at(300, 300), at(0, 300)];
    const round = roundTrack(track, 8);
    expect(round.length).toBeGreaterThan(track.length);
    expect(round[0]).toEqual(track[0]);
    expect(round.at(-1)).toEqual(track.at(-1));
    expect(Math.max(...round.map((p) => toLine(p, track)))).toBeLessThan(8);
  });
});
