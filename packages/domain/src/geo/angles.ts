export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;

/** Floored modulo: result has the sign of `n` (e.g. mod(-30, 360) = 330). */
export function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** East-positive longitude normalized to [0, 360) — the IAU/Mars 2020 storage convention. */
export function normalizeLon360(lonDeg: number): number {
  return mod(lonDeg, 360);
}

/** East-positive longitude normalized to (-180, 180] — the renderer convention. */
export function normalizeLon180(lonDeg: number): number {
  const l = mod(lonDeg, 360);
  return l > 180 ? l - 360 : l;
}

/** Converts an east-positive longitude to the west-positive planetographic longitude Mars24 expects. */
export function eastToWestLon(lonEastDeg: number): number {
  return mod(-lonEastDeg, 360);
}

/** Signed smallest difference a − b in degrees, in (-180, 180]. */
export function lonDelta(aDeg: number, bDeg: number): number {
  return normalizeLon180(aDeg - bDeg);
}
