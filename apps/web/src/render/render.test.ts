import { greatCircleDistance } from '@copernico/domain';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { altitudeFloor, JEZERO_ZONE, maxTiltDeg, MAX_TILT_DEG } from './cameraConstraints';
import { densify, removeSpikes, roundTrack, simplify } from './pathGeometry';
import { speedTable } from './walkSim';
import { flightPeak, flightSeconds } from './flight';
import { Cartesian3, Ellipsoid } from 'cesium';

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
  it('spike removal in one pass equals removing the first spike and rescanning', () => {
    // Reference: the original quadratic algorithm.
    const reference = (pts: Array<{ lat: number; lon: number }>, maxM: number) => {
      const out = [...pts];
      const local = (p: (typeof pts)[0], r: (typeof pts)[0]) => [
        (p.lon - r.lon) * M * Math.cos((r.lat * Math.PI) / 180),
        (p.lat - r.lat) * M,
      ];
      for (let i = 1; i < out.length - 1;) {
        const [ax, ay] = local(out[i - 1]!, out[i]!) as [number, number];
        const [bx, by] = local(out[i + 1]!, out[i]!) as [number, number];
        const la = Math.hypot(ax, ay);
        const lb = Math.hypot(bx, by);
        const spike =
          la === 0 ||
          lb === 0 ||
          ((ax * bx + ay * by) / (la * lb) >= Math.cos(Math.PI / 6) && Math.max(la, lb) <= maxM);
        if (spike) {
          out.splice(i, 1);
          i = 1;
        } else i++;
      }
      return out;
    };
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 0, max: 60 }), fc.integer({ min: 0, max: 60 })), {
          minLength: 0,
          maxLength: 40,
        }),
        (xy) => {
          const pts = xy.map(([x, y]) => at(x, y));
          expect(removeSpikes(pts, 30)).toEqual(reference(pts, 30));
        },
      ),
      { numRuns: 400 },
    );
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

describe('tilt allowed by altitude', () => {
  it('is free up close, straight down from orbit, and never grows with height', () => {
    expect(maxTiltDeg(2_000)).toBe(MAX_TILT_DEG);
    expect(maxTiltDeg(15_000)).toBe(MAX_TILT_DEG);
    expect(maxTiltDeg(1_200_000)).toBe(0);
    expect(maxTiltDeg(9_500_000)).toBe(0);
    let previous = Infinity;
    for (let h = 1_000; h < 2e6; h *= 1.2) {
      const t = maxTiltDeg(h);
      expect(t).toBeLessThanOrEqual(previous + 1e-9);
      previous = t;
    }
    expect(maxTiltDeg(150_000)).toBeGreaterThan(20);
    expect(maxTiltDeg(150_000)).toBeLessThan(60);
  });
});

describe('walk simulation speed profile', () => {
  const total = 5640;
  const stops = [2640, 3215, total];
  const at = speedTable(total, stops, 40);

  it('starts at 0, ends at the route end at the given duration and never goes backwards', () => {
    expect(at(0)).toBe(0);
    expect(at(40)).toBeCloseTo(total, 6);
    let prev = 0;
    for (let t = 0; t <= 40; t += 0.05) {
      const d = at(t);
      expect(d).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = d;
    }
  });

  it('eases in, slows into each stop and holds there', () => {
    const v = (t: number) => (at(t + 0.05) - at(t)) / 0.05;
    let reach = 0;
    while (at(reach) < stops[0]! - 1e-6) reach += 0.01;
    // Held at the stop for most of the 0.8 s, then walks on.
    expect(at(reach + 0.7)).toBeCloseTo(stops[0]!, 3);
    expect(at(reach + 2)).toBeGreaterThan(stops[0]! + 5);
    const cruise = v(10);
    expect(v(0)).toBeLessThan(0.2 * cruise);
    expect(v(reach - 0.1)).toBeLessThan(0.2 * cruise);
  });
});

describe('camera flight peak', () => {
  const mars = new Ellipsoid(3_396_190, 3_396_190, 3_396_190);
  // Jezero floor is ~2.5 km below the reference sphere: heights here are negative, as in the app.
  const at = (lat: number, lon: number, h: number) => Cartesian3.fromDegrees(lon, lat, h, mars);
  it('a nearby place is a short glide, never a climb toward orbit', () => {
    // ~320 m away: at most a few tens of metres above the higher end (it climbed to 6,000 km).
    const peak = flightPeak(at(18.44, 77.45, -1300), at(18.445, 77.452, -1250), mars);
    expect(peak - -1250).toBeGreaterThanOrEqual(0);
    expect(peak - -1250).toBeLessThan(40);
    // Same place, nothing to cross: no climb at all.
    expect(flightPeak(at(18.44, 77.45, -1300), at(18.44, 77.45, -1250), mars)).toBeCloseTo(
      -1250,
      3,
    );
  });

  it('a distant place at the same height gets a hop proportional to the distance', () => {
    const peak = flightPeak(at(18.4, 77.4, -1300), at(18.4, 77.5, -1300), mars); // ~5.6 km
    expect(peak - -1300).toBeGreaterThan(800);
    expect(peak - -1300).toBeLessThan(1200);
  });

  it('orbit to surface is a plain descent (never above the start)', () => {
    const start = 9_500_000;
    expect(flightPeak(at(18.44, 77.45, start), at(18.45, 77.4, -1300), mars)).toBeCloseTo(start, 0);
  });

  it('short trips are quick, long ones take the requested time', () => {
    expect(flightSeconds(at(18.44, 77.45, -1300), at(18.441, 77.45, -1300), 3)).toBeLessThan(1.4);
    expect(flightSeconds(at(18.44, 77.45, 9_500_000), at(18.44, 77.45, -1300), 3)).toBe(3);
  });
});
