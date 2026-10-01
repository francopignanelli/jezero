/**
 * TAI − UTC (s) from the IERS leap-second table, keyed by the UTC instant each value takes effect.
 * No leap second has been added since 2017-01-01; re-check IERS Bulletin C before each release.
 */
const TABLE: ReadonlyArray<readonly [number, number]> = [
  [Date.UTC(1972, 0, 1), 10],
  [Date.UTC(1972, 6, 1), 11],
  [Date.UTC(1973, 0, 1), 12],
  [Date.UTC(1974, 0, 1), 13],
  [Date.UTC(1975, 0, 1), 14],
  [Date.UTC(1976, 0, 1), 15],
  [Date.UTC(1977, 0, 1), 16],
  [Date.UTC(1978, 0, 1), 17],
  [Date.UTC(1979, 0, 1), 18],
  [Date.UTC(1980, 0, 1), 19],
  [Date.UTC(1981, 6, 1), 20],
  [Date.UTC(1982, 6, 1), 21],
  [Date.UTC(1983, 6, 1), 22],
  [Date.UTC(1985, 6, 1), 23],
  [Date.UTC(1988, 0, 1), 24],
  [Date.UTC(1990, 0, 1), 25],
  [Date.UTC(1991, 0, 1), 26],
  [Date.UTC(1992, 6, 1), 27],
  [Date.UTC(1993, 6, 1), 28],
  [Date.UTC(1994, 6, 1), 29],
  [Date.UTC(1996, 0, 1), 30],
  [Date.UTC(1997, 6, 1), 31],
  [Date.UTC(1999, 0, 1), 32],
  [Date.UTC(2006, 0, 1), 33],
  [Date.UTC(2009, 0, 1), 34],
  [Date.UTC(2012, 6, 1), 35],
  [Date.UTC(2015, 6, 1), 36],
  [Date.UTC(2017, 0, 1), 37],
];

/** TT − UTC (s): TAI − UTC + 32.184 s. Before 1972, the Mars24 polynomial (step A-4). */
export function ttMinusUtcSeconds(utcMs: number): number {
  if (utcMs < TABLE[0]![0]) {
    const t = (2440587.5 + utcMs / 86_400_000 - 2451545.0) / 36525;
    return 64.184 + 59 * t - 51.2 * t ** 2 - 67.1 * t ** 3 - 16.4 * t ** 4;
  }
  let taiMinusUtc = TABLE[0]![1];
  for (const [since, value] of TABLE) {
    if (utcMs >= since) taiMinusUtc = value;
    else break;
  }
  return taiMinusUtc + 32.184;
}
