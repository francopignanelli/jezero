import { describe, expect, it } from 'vitest';
import {
  arrowsAlong,
  buildTrack,
  distanceAtElapsed,
  nearestOnPolyline,
  pointAt,
  profileAt,
} from './routeTrack';

// 1° of latitude on the Mars sphere = 59,274.7 m.
const M_PER_DEG = 59_274.7;
const track = buildTrack([
  { lat: 18, lon: 77, heightM: 0 },
  { lat: 18 + 1000 / M_PER_DEG, lon: 77, heightM: 100 },
]);

describe('route track lookups', () => {
  it('measures ground distance on the Mars sphere', () => {
    expect(track.totalM).toBeCloseTo(1000, 0);
  });
  it('interpolates position and height by distance, clamped to the ends', () => {
    const mid = pointAt(track, 500);
    expect((mid.lat - 18) * M_PER_DEG).toBeCloseTo(500, 0);
    expect(mid.heightM).toBeCloseTo(50, 1);
    expect(pointAt(track, -10)).toEqual(track.points[0]);
    expect(pointAt(track, 5000)).toEqual(track.points[1]);
  });
  it('places arrows evenly, each pointing further along the path', () => {
    const arrows = arrowsAlong(track, 250);
    expect(arrows).toHaveLength(4);
    for (const a of arrows) expect(a.next.lat).toBeGreaterThan(a.lat);
  });
  it('reads profile samples at a distance', () => {
    const profile = {
      distanceM: Float32Array.from([0, 5, 10]),
      elevationM: Float32Array.from([-2500, -2499, -2497]),
      terrainSlopeDeg: Float32Array.from([2, 4, 8]),
      elapsedS: Float32Array.from([0, 4, 9]),
    };
    expect(profileAt(profile, 7)).toEqual({
      distanceM: 7,
      elevationM: -2499,
      slopeDeg: 4,
      elapsedS: 4,
    });
    expect(profileAt(profile, 99)).toEqual({
      distanceM: 10,
      elevationM: -2497,
      slopeDeg: 8,
      elapsedS: 9,
    });
    expect(distanceAtElapsed(profile, 2)).toBeCloseTo(2.5, 6);
    expect(distanceAtElapsed(profile, 6.5)).toBeCloseTo(7.5, 6);
    expect(distanceAtElapsed(profile, 100)).toBe(10);
  });
});

describe('nearest point on a polyline', () => {
  it('measures the perpendicular ground distance to the nearest segment', () => {
    const line = [
      { lat: 18, lon: 77 },
      { lat: 18 + 1000 / M_PER_DEG, lon: 77 },
      { lat: 18 + 1000 / M_PER_DEG, lon: 77.02 },
    ];
    // 300 m east of the first segment's midpoint.
    const k = Math.cos((18 * Math.PI) / 180) * M_PER_DEG;
    const r = nearestOnPolyline(line, { lat: 18 + 500 / M_PER_DEG, lon: 77 + 300 / k });
    expect(r.segmentIndex).toBe(0);
    expect(r.distanceM).toBeCloseTo(300, 0);
  });
});
