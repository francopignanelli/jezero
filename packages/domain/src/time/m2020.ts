import { SOL_SECONDS } from '../constants';

/**
 * Mars 2020 mission sol numbering from the NAIF LMST SCLK kernel (m2020_lmst_ops210303_v1.tsc):
 * sol 0 began at local mean midnight on 2021-02-18T04:24:15.8058 UTC, at the landing-target
 * longitude 77.4298°E. This is the mission clock, not a measurement.
 */
export const M2020_SOL0_START_UTC_MS = Date.UTC(2021, 1, 18, 4, 24, 15) + 805.8;
export const M2020_LMST_LON_EAST_DEG = 77.4298;

/** Continuous mission sol (e.g. 1990.42) for a UTC instant. */
export function m2020SolContinuous(utcMs: number): number {
  return (utcMs - M2020_SOL0_START_UTC_MS) / (SOL_SECONDS * 1000);
}

export function m2020Sol(utcMs: number): number {
  return Math.floor(m2020SolContinuous(utcMs));
}

/** UTC instant (ms) at which mission sol `sol` begins (local mean midnight). */
export function m2020SolStartUtcMs(sol: number): number {
  return M2020_SOL0_START_UTC_MS + sol * SOL_SECONDS * 1000;
}
