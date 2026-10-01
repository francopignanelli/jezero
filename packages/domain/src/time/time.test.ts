import * as Astronomy from 'astronomy-engine';
import { describe, expect, it } from 'vitest';
import { eastToWestLon } from '../geo/angles';
import { ttMinusUtcSeconds } from './leapSeconds';
import {
  localMeanSolarTime,
  localTrueSolarTime,
  mars24,
  marsYear,
  solarZenithAzimuth,
} from './mars24';
import { M2020_LMST_LON_EAST_DEG, m2020Sol, m2020SolStartUtcMs } from './m2020';
import {
  daylightWindow,
  nextLocalTrueSolarTime,
  solarPosition,
  sunDirectionBodyFixed,
} from './sun';

/**
 * Worked examples from the NASA GISS Mars24 "Algorithm and Worked Examples" page (2025-01-07).
 * Steps A–C match the published values to 1e-5. The published example-2 declination (D-1) and both
 * zenith angles (D-5) differ from a direct evaluation of the published formulas by ≤ 0.00065°
 * (e.g. arcsin(0.42565 sin 327.32416°) + 0.25° sin 327.32416° = −13.4204°, printed −13.42065°), so
 * those steps use a 0.001° tolerance, far below the 1° precision shown in the app.
 */
const PUBLISHED_D_STEP_TOLERANCE_DEG = 0.001;
describe('Mars24 worked example 1: 2000-01-06 00:00:00 UTC, 0°W 0°N', () => {
  const s = mars24(947116800000);
  it.each([
    ['jdUT', s.jdUT, 2451549.5],
    ['ttMinusUtcS', s.ttMinusUtcS, 64.184],
    ['jdTT', s.jdTT, 2451549.50074],
    ['dtJ2000', s.dtJ2000, 4.50074],
    ['M', s.meanAnomalyDeg, 21.74558],
    ['alphaFMS', s.alphaFmsDeg, 272.74566],
    ['PBS', s.perturbersDeg, 0.00142],
    ['nu-M', s.equationOfCenterDeg, 4.44193],
    ['Ls', s.lsDeg, 277.18758],
    ['EOT', s.eotDeg, -5.18774],
    ['MST', s.mstHours, 23.99425],
    ['subsolar lon', s.subsolarLonWestDeg, 174.726],
    ['declination', s.solarDeclinationDeg, -25.22825],
    ['RM', s.heliocentricDistanceAU, 1.39358],
    ['lM', s.heliocentricLongitudeDeg, 2.26352],
    ['bM', s.heliocentricLatitudeDeg, -1.35957],
  ])('%s', (_name, actual, expected) => {
    expect(actual).toBeCloseTo(expected, 4);
  });

  it('LMST, LTST, zenith and azimuth', () => {
    expect(localMeanSolarTime(s, 0)).toBeCloseTo(23.99425, 4);
    expect(localTrueSolarTime(s, 0)).toBeCloseTo(23.6484, 4);
    const sun = solarZenithAzimuth(s, 0, 0);
    expect(Math.abs(sun.zenithDeg - 154.26182)).toBeLessThan(PUBLISHED_D_STEP_TOLERANCE_DEG);
    expect(sun.azimuthDeg).toBeCloseTo(191.03905, 4);
  });
});

describe('Mars24 worked example 2: MER-A Spirit, 184.702°W −14.640°N', () => {
  const s = mars24(1073137591000);
  it.each([
    ['jdUT', s.jdUT, 2453008.07397],
    ['dtJ2000', s.dtJ2000, 1463.07471],
    ['M (unwrapped)', s.meanAnomalyDeg, 786.06858],
    ['alphaFMS (unwrapped)', s.alphaFmsDeg, 1037.09457],
    ['PBS', s.perturbersDeg, 0.01614],
    ['nu-M', s.equationOfCenterDeg, 10.22959],
    ['Ls', s.lsDeg, 327.32416],
    ['EOT', s.eotDeg, -12.77553],
    ['MST', s.mstHours, 13.16537],
    ['subsolar lon', s.subsolarLonWestDeg, 4.705],
    ['RM', s.heliocentricDistanceAU, 1.47767],
    ['lM', s.heliocentricLongitudeDeg, 52.37564],
    ['bM', s.heliocentricLatitudeDeg, 0.08965],
  ])('%s', (_name, actual, expected) => {
    expect(actual).toBeCloseTo(expected, 4);
  });

  it('declination (D-1)', () => {
    expect(Math.abs(s.solarDeclinationDeg - -13.42065)).toBeLessThan(
      PUBLISHED_D_STEP_TOLERANCE_DEG,
    );
  });

  it('local midnight: LTST ≈ 0 and azimuth ≈ 180°', () => {
    expect(localMeanSolarTime(s, 184.702)).toBeCloseTo(0.8519, 4);
    expect(localTrueSolarTime(s, 184.702)).toBeCloseTo(0.00025, 4);
    const sun = solarZenithAzimuth(s, -14.64, 184.702);
    expect(Math.abs(sun.zenithDeg - 151.93895)).toBeLessThan(PUBLISHED_D_STEP_TOLERANCE_DEG);
    expect(sun.azimuthDeg).toBeCloseTo(179.99383, 4);
  });
});

describe('leap seconds', () => {
  it('uses TAI−UTC + 32.184 s', () => {
    expect(ttMinusUtcSeconds(Date.UTC(2000, 0, 6))).toBeCloseTo(64.184, 10);
    expect(ttMinusUtcSeconds(Date.UTC(2016, 11, 31, 23, 59, 59))).toBeCloseTo(68.184, 10);
    expect(ttMinusUtcSeconds(Date.UTC(2026, 8, 25))).toBeCloseTo(69.184, 10);
  });
});

describe('seasons and Mars years', () => {
  it('places the Perseverance landing early in northern spring of MY 36', () => {
    const s = mars24(Date.UTC(2021, 1, 18, 20, 55));
    expect(s.lsDeg).toBeGreaterThan(4.5);
    expect(s.lsDeg).toBeLessThan(6);
    expect(marsYear(s)).toBe(36);
  });

  it.each([
    [Date.UTC(2021, 1, 1), 35],
    [Date.UTC(2021, 1, 12), 36],
    [Date.UTC(2022, 5, 1), 36],
    [Date.UTC(2023, 5, 1), 37],
    [Date.UTC(2025, 5, 1), 38],
  ])('Mars year at %i is %i', (ms, my) => {
    expect(marsYear(mars24(ms))).toBe(my);
  });
});

describe('Mars 2020 mission sols', () => {
  it('landing (2021-02-18 20:55 UTC) is sol 0', () => {
    expect(m2020Sol(Date.UTC(2021, 1, 18, 20, 55))).toBe(0);
  });

  it('each mission sol starts near local mean midnight per Mars24 (independent cross-check)', () => {
    const west = eastToWestLon(M2020_LMST_LON_EAST_DEG);
    for (const sol of [0, 500, 1000, 1990]) {
      const lmst = localMeanSolarTime(mars24(m2020SolStartUtcMs(sol)), west);
      const fromMidnightH = Math.min(lmst, 24 - lmst);
      expect(fromMidnightH * 3600).toBeLessThan(60);
    }
  });
});

describe('Sun direction and daylight', () => {
  /** Mars→Sun unit vector in the IAU 2015 Mars body-fixed frame, from astronomy-engine. */
  function astronomyEngineSun(ms: number): [number, number, number] {
    const time = Astronomy.MakeTime(new Date(ms));
    const helio = Astronomy.HelioVector(Astronomy.Body.Mars, time);
    const axis = Astronomy.RotationAxis(Astronomy.Body.Mars, time);
    const v = [-helio.x, -helio.y, -helio.z];
    const α = axis.ra * 15 * (Math.PI / 180);
    const δ = axis.dec * (Math.PI / 180);
    const W = axis.spin * (Math.PI / 180);
    const rz = (θ: number, [x, y, z]: number[]) => [
      Math.cos(θ) * x! + Math.sin(θ) * y!,
      -Math.sin(θ) * x! + Math.cos(θ) * y!,
      z!,
    ];
    const rx = (θ: number, [x, y, z]: number[]) => [
      x!,
      Math.cos(θ) * y! + Math.sin(θ) * z!,
      -Math.sin(θ) * y! + Math.cos(θ) * z!,
    ];
    const b = rz(W, rx(Math.PI / 2 - δ, rz(Math.PI / 2 + α, v)));
    const n = Math.hypot(b[0]!, b[1]!, b[2]!);
    return [b[0]! / n, b[1]! / n, b[2]! / n];
  }

  it.each([Date.UTC(2021, 1, 18, 20, 55), Date.UTC(2024, 11, 12, 12), Date.UTC(2026, 8, 25)])(
    'Mars24 and astronomy-engine agree on the sun direction to < 0.1° (%i)',
    (ms) => {
      const a = sunDirectionBodyFixed(ms);
      const b = astronomyEngineSun(ms);
      const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const angleDeg = (Math.acos(Math.min(1, dot)) * 180) / Math.PI;
      expect(angleDeg).toBeLessThan(0.1);
    },
  );

  it('finds the next 10:00 LTST at Jezero within one sol', () => {
    const site = { lat: 18.4446, lon: 77.4509 };
    const from = Date.UTC(2026, 8, 25, 17, 40);
    const t = nextLocalTrueSolarTime(from, site, 10);
    expect(t).toBeGreaterThanOrEqual(from);
    expect(t - from).toBeLessThan(88775244 + 60_000);
    expect(solarPosition(t, site).ltstHours).toBeCloseTo(10, 2);
  });

  it('finds a daylight window around local noon at Jezero', () => {
    const site = { lat: 18.4446, lon: 77.4509 };
    const sol = 1990;
    const start = m2020SolStartUtcMs(sol);
    const w = daylightWindow(start, 88775244, site, 10);
    expect(w).not.toBeNull();
    const rise = solarPosition(w!.startUtcMs, site);
    const set = solarPosition(w!.endUtcMs, site);
    expect(rise.elevationDeg).toBeCloseTo(10, 1);
    expect(set.elevationDeg).toBeCloseTo(10, 1);
    expect(rise.ltstHours).toBeLessThan(12);
    expect(set.ltstHours).toBeGreaterThan(12);
    expect(rise.azimuthDeg).toBeLessThan(180);
    expect(set.azimuthDeg).toBeGreaterThan(180);
  });
});
