import { greatCircleDistance } from '@copernico/domain';
import { describe, expect, it } from 'vitest';
import { altitudeFloor, JEZERO_ZONE } from './cameraConstraints';
import { densify, simplify } from './pathGeometry';

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
