import { DEG_TO_RAD, mod, RAD_TO_DEG } from '../geo/angles';
import { ttMinusUtcSeconds } from './leapSeconds';

/**
 * Mars24 algorithm (Allison & McEwen 2000, as revised on the NASA GISS Mars24 "Algorithm and
 * Worked Examples" page, updated 2025-01-07). Step numbers refer to that page. Ls is accurate to
 * ~0.01°. Longitudes here are planetographic, WEST-positive, as the algorithm defines them.
 */
export interface Mars24State {
  jdUT: number;
  ttMinusUtcS: number;
  jdTT: number;
  dtJ2000: number;
  /** Mars mean anomaly M (deg, unwrapped). */
  meanAnomalyDeg: number;
  alphaFmsDeg: number;
  perturbersDeg: number;
  /** ν − M (deg). */
  equationOfCenterDeg: number;
  /** Areocentric solar longitude, [0, 360). */
  lsDeg: number;
  /** Equation of time (deg). */
  eotDeg: number;
  /** Mars Sol Date. */
  msd: number;
  /** Mean solar time at the prime meridian (h), [0, 24). */
  mstHours: number;
  /** Subsolar longitude (deg west), [0, 360). */
  subsolarLonWestDeg: number;
  /** Solar declination (planetographic, deg). */
  solarDeclinationDeg: number;
  heliocentricDistanceAU: number;
  heliocentricLongitudeDeg: number;
  heliocentricLatitudeDeg: number;
}

const PERTURBERS: ReadonlyArray<readonly [number, number, number]> = [
  [0.0071, 2.2353, 49.409],
  [0.0057, 2.7543, 168.173],
  [0.0039, 1.1177, 191.837],
  [0.0037, 15.7866, 21.736],
  [0.0021, 2.1354, 15.704],
  [0.002, 2.4694, 95.528],
  [0.0018, 32.8493, 49.095],
];

const sinD = (deg: number): number => Math.sin(deg * DEG_TO_RAD);
const cosD = (deg: number): number => Math.cos(deg * DEG_TO_RAD);

/** Evaluates steps A-1 to D-4 for a UTC instant (ms since the Unix epoch, POSIX, no leap seconds). */
export function mars24(utcMs: number): Mars24State {
  const jdUT = 2440587.5 + utcMs / 8.64e7; // A-2
  const ttMinusUtcS = ttMinusUtcSeconds(utcMs); // A-4
  const jdTT = jdUT + ttMinusUtcS / 86400; // A-5
  const dt = jdTT - 2451545.0; // A-6

  const meanAnomalyDeg = 19.3871 + 0.52402073 * dt; // B-1
  const alphaFmsDeg = 270.3871 + 0.524038496 * dt; // B-2
  let perturbersDeg = 0; // B-3
  for (const [a, tau, phi] of PERTURBERS) perturbersDeg += a * cosD((0.985626 * dt) / tau + phi);
  const m = meanAnomalyDeg;
  const equationOfCenterDeg = // B-4
    (10.691 + 3.0e-7 * dt) * sinD(m) +
    0.623 * sinD(2 * m) +
    0.05 * sinD(3 * m) +
    0.005 * sinD(4 * m) +
    0.0005 * sinD(5 * m) +
    perturbersDeg;
  const lsDeg = mod(alphaFmsDeg + equationOfCenterDeg, 360); // B-5

  const eotDeg = // C-1
    2.861 * sinD(2 * lsDeg) -
    0.071 * sinD(4 * lsDeg) +
    0.002 * sinD(6 * lsDeg) -
    equationOfCenterDeg;
  const msd = (jdTT - 2451549.5) / 1.0274912517 + 44796.0 - 0.0009626; // C-2
  const mstHours = mod(24 * msd, 24);
  const subsolarLonWestDeg = mod(mstHours * 15 + eotDeg + 180, 360); // C-5

  const solarDeclinationDeg = // D-1
    Math.asin(0.42565 * sinD(lsDeg)) * RAD_TO_DEG + 0.25 * sinD(lsDeg);
  const heliocentricDistanceAU = // D-2
    1.52367934 *
    (1.00436 -
      0.09309 * cosD(m) -
      0.004336 * cosD(2 * m) -
      0.00031 * cosD(3 * m) -
      0.00003 * cosD(4 * m));
  const heliocentricLongitudeDeg = mod(
    // D-3
    lsDeg + 85.061 - 0.015 * sinD(71 + 2 * lsDeg) - 5.5e-6 * dt,
    360,
  );
  const heliocentricLatitudeDeg = // D-4
    -(1.8497 - 2.23e-5 * dt) * sinD(lsDeg - 144.5 + 2.57e-6 * dt);

  return {
    jdUT,
    ttMinusUtcS,
    jdTT,
    dtJ2000: dt,
    meanAnomalyDeg,
    alphaFmsDeg,
    perturbersDeg,
    equationOfCenterDeg,
    lsDeg,
    eotDeg,
    msd,
    mstHours,
    subsolarLonWestDeg,
    solarDeclinationDeg,
    heliocentricDistanceAU,
    heliocentricLongitudeDeg,
    heliocentricLatitudeDeg,
  };
}

/** C-3: Local Mean Solar Time (h) at a west longitude. */
export function localMeanSolarTime(s: Mars24State, lonWestDeg: number): number {
  return mod(s.mstHours - lonWestDeg / 15, 24);
}

/** C-4: Local True Solar Time (h) at a west longitude. */
export function localTrueSolarTime(s: Mars24State, lonWestDeg: number): number {
  return mod(localMeanSolarTime(s, lonWestDeg) + s.eotDeg / 15, 24);
}

/**
 * D-5/D-6: solar zenith, elevation and azimuth (clockwise from north) for a planetographic latitude
 * and west longitude. No refraction or terrain horizon is modelled.
 */
export function solarZenithAzimuth(
  s: Mars24State,
  latPlanetographicDeg: number,
  lonWestDeg: number,
): { zenithDeg: number; elevationDeg: number; azimuthDeg: number } {
  const h = lonWestDeg - s.subsolarLonWestDeg;
  const δ = s.solarDeclinationDeg;
  const φ = latPlanetographicDeg;
  const cosZ = sinD(δ) * sinD(φ) + cosD(δ) * cosD(φ) * cosD(h);
  const zenithDeg = Math.acos(Math.max(-1, Math.min(1, cosZ))) * RAD_TO_DEG;
  const azimuthDeg = mod(
    Math.atan2(sinD(h), cosD(φ) * Math.tan(δ * DEG_TO_RAD) - sinD(φ) * cosD(h)) * RAD_TO_DEG,
    360,
  );
  return { zenithDeg, elevationDeg: 90 - zenithDeg, azimuthDeg };
}

/**
 * Mars Year (Clancy et al. 2000 convention: MY 1 began at Ls = 0 on 1955-04-11). Uses the elapsed
 * fraction of tropical Mars years corrected by the current Ls, which is robust near year boundaries.
 */
export function marsYear(s: Mars24State): number {
  const MY1_START_JD = 2435208.5;
  const TROPICAL_YEAR_DAYS = 686.9726;
  return Math.round((s.jdTT - MY1_START_JD) / TROPICAL_YEAR_DAYS - s.lsDeg / 360) + 1;
}
