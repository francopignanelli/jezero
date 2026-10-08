import { describe, expect, it } from 'vitest';
import { eastToWestLon, lonDelta, normalizeLon180, normalizeLon360 } from './angles';
import {
  eqcEastWestScale,
  eqcForward,
  eqcInverse,
  IAU2015_49910_EQC,
  M2020_EQC,
} from './equirectangular';
import { planetocentricToPlanetographic, planetographicToPlanetocentric } from './latitude';
import { elevationAngleDeg, greatCircleDistance, initialBearingDeg } from './sphere';

/** PDS PLACES best_tactical.csv (Release 16) localizations: [lat °N, lon °E, northing m, easting m]. */
const PLACES_FIXTURES = [
  {
    label: 'landing site (SITE 1)',
    lat: 18.444571297,
    lon: 77.450910771,
    northing: 1093296.385,
    easting: 4354495.494,
  },
  {
    label: 'ROVER site 40 drive 992',
    lat: 18.482509077,
    lon: 77.366696969,
    northing: 1095545.135,
    easting: 4349760.771,
  },
  {
    label: 'ROVER site 80 drive 2790',
    lat: 18.442042907,
    lon: 77.260053679,
    northing: 1093146.515,
    easting: 4343765.002,
  },
];

describe('longitude conventions', () => {
  it('normalizes east longitudes to [0, 360) and (-180, 180]', () => {
    expect(normalizeLon360(-77.45)).toBeCloseTo(282.55, 10);
    expect(normalizeLon360(360)).toBe(0);
    expect(normalizeLon180(282.55)).toBeCloseTo(-77.45, 10);
    expect(normalizeLon180(180)).toBe(180);
    expect(normalizeLon180(-180)).toBe(180);
  });

  it('converts east-positive to the west-positive longitude used by Mars24', () => {
    expect(eastToWestLon(77.4298)).toBeCloseTo(282.5702, 10);
    expect(eastToWestLon(0)).toBe(0);
  });

  it('takes the short way around the antimeridian', () => {
    expect(lonDelta(359.9, 0.1)).toBeCloseTo(-0.2, 10);
    expect(lonDelta(0.1, 359.9)).toBeCloseTo(0.2, 10);
  });
});

describe('planetographic latitude', () => {
  it('matches the Mars24 value for the Jezero landing site (18.4446°c → 18.649°g)', () => {
    expect(planetocentricToPlanetographic(18.4446)).toBeCloseTo(18.649, 3);
  });

  it('round-trips and preserves the equator and poles', () => {
    for (const lat of [-89, -45, -14.64, 0, 18.4446, 60, 89.9]) {
      expect(planetographicToPlanetocentric(planetocentricToPlanetographic(lat))).toBeCloseTo(
        lat,
        10,
      );
    }
    expect(planetocentricToPlanetographic(0)).toBe(0);
    expect(planetocentricToPlanetographic(90)).toBe(90);
  });
});

describe('Mars 2020 local frame (eqc, lat_ts 18.4663°, R 3 396 190 m)', () => {
  it.each(PLACES_FIXTURES)('reproduces PLACES easting/northing for $label to < 1 cm', (f) => {
    const p = eqcForward(M2020_EQC, f.lat, f.lon);
    expect(Math.abs(p.x - f.easting)).toBeLessThan(0.01);
    expect(Math.abs(p.y - f.northing)).toBeLessThan(0.01);
  });

  it('inverts to < 1 mm', () => {
    for (const f of PLACES_FIXTURES) {
      const ll = eqcInverse(M2020_EQC, f.easting, f.northing);
      const back = eqcForward(M2020_EQC, ll.lat, ll.lon);
      expect(Math.abs(back.x - f.easting)).toBeLessThan(1e-3);
      expect(Math.abs(back.y - f.northing)).toBeLessThan(1e-3);
    }
  });

  it('agrees with great-circle distances to < 0.01 % once the row scale is applied', () => {
    const [a, b, c] = PLACES_FIXTURES as [
      (typeof PLACES_FIXTURES)[0],
      (typeof PLACES_FIXTURES)[0],
      (typeof PLACES_FIXTURES)[0],
    ];
    for (const [p, q] of [
      [a, b],
      [a, c],
      [b, c],
    ] as const) {
      const midLat = (p.lat + q.lat) / 2;
      const dx = (q.easting - p.easting) * eqcEastWestScale(M2020_EQC, midLat);
      const dy = q.northing - p.northing;
      const local = Math.hypot(dx, dy);
      const gc = greatCircleDistance(p, q);
      expect(Math.abs(local - gc) / gc).toBeLessThan(1e-4);
    }
  });
});

describe('regression: USGS TRN lat_ts = 0 projection', () => {
  it('overstates east-west ground distance at Jezero by ~5.4 % if its metres are used naively', () => {
    const lat = 18.4446;
    const p0 = eqcForward(IAU2015_49910_EQC, lat, 77.4);
    const p1 = eqcForward(IAU2015_49910_EQC, lat, 77.45);
    const naive = p1.x - p0.x;
    const truth = greatCircleDistance({ lat, lon: 77.4 }, { lat, lon: 77.45 });
    expect(naive / truth).toBeCloseTo(1 / Math.cos((lat * Math.PI) / 180), 4);
    expect(naive / truth - 1).toBeGreaterThan(0.05);
    // The correction used throughout the domain package removes the error.
    expect((naive * eqcEastWestScale(IAU2015_49910_EQC, lat)) / truth).toBeCloseTo(1, 6);
  });
});

describe('bearing and elevation on the Mars sphere', () => {
  it('gives the cardinal bearings', () => {
    const o = { lat: 18.45, lon: 77.4 };
    expect(initialBearingDeg(o, { lat: 18.46, lon: 77.4 })).toBeCloseTo(0, 6);
    expect(initialBearingDeg(o, { lat: 18.44, lon: 77.4 })).toBeCloseTo(180, 6);
    expect(initialBearingDeg(o, { lat: 18.45, lon: 77.41 })).toBeCloseTo(90, 2);
    expect(initialBearingDeg(o, { lat: 18.45, lon: 77.39 })).toBeCloseTo(270, 2);
  });
  it('matches the flat-ground slope up close and includes the curvature drop far away', () => {
    // 100 m up at 1 km: atan((100 − d²/2R) / d), the curvature drop being 0.147 m.
    const approx = (Math.atan((100 - 1000 ** 2 / (2 * 3_396_190)) / 1000) * 180) / Math.PI;
    expect(elevationAngleDeg(1000, 0, 100)).toBeCloseTo(approx, 2);
    // Same height at 20 km: the drop d²/2R ≈ 58.9 m gives ≈ −0.1687° (half the arc angle).
    expect(elevationAngleDeg(20_000, 0, 0)).toBeCloseTo(
      -((20_000 / 3_396_190) * 180) / Math.PI / 2,
      6,
    );
  });
});
