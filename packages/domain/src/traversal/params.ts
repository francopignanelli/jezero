/**
 * Human EVA traversal parameters (versioned set `eva-params@1`). Every value is labelled with its
 * basis, because there is no measured data on suited walking on slopes at Mars gravity: sourced lunar
 * values are explicitly marked as assumptions when applied to Mars. Evidence:
 * docs/research/human-traversal.md.
 */

export type ParameterBasis = 'sourced' | 'sourced-lunar' | 'assumption';

export interface ParameterNote {
  basis: ParameterBasis;
  /** i18n key suffix; the UI resolves `params.<key>.note`. */
  note: string;
  refs: readonly string[];
}

export type SlopeBandKey = 'mild' | 'moderate' | 'steep';

export interface SlopeBand {
  key: SlopeBandKey;
  /** Inclusive upper bound (deg). */
  upToDeg: number;
  /** Dimensionless penalty added to the risk multiplier. */
  penalty: number;
}

export interface EvaParams {
  maxSlopeDeg: number;
  slopeBands: readonly SlopeBand[];
  crossSlopeWeight: number;
  roughP90Deg: number;
  roughPenalty: number;
  lowThermalInertia: number;
  lowThermalInertiaPenalty: number;
  levelSpeedKmh: number;
  slopeSpeedFactorPerDeg: number;
  minSpeedFactor: number;
  timelineFactor: number;
  evaCapHours: number;
  evaNominalHours: number;
  ingressHours: number;
  walkRadiusWarningM: number;
  minSunElevationDeg: number;
  gainHysteresisM: number;
}

export const EVA_PARAMS_ID = 'eva-params@1';

export const DEFAULT_EVA_PARAMS: Readonly<EvaParams> = Object.freeze({
  maxSlopeDeg: 20,
  slopeBands: Object.freeze([
    { key: 'mild', upToDeg: 10, penalty: 0 },
    { key: 'moderate', upToDeg: 15, penalty: 0.5 },
    { key: 'steep', upToDeg: 20, penalty: 2 },
  ] as const),
  crossSlopeWeight: 1,
  roughP90Deg: 25,
  roughPenalty: 0.5,
  lowThermalInertia: 100,
  lowThermalInertiaPenalty: 0.5,
  levelSpeedKmh: 2,
  slopeSpeedFactorPerDeg: 0.0133,
  minSpeedFactor: 0.1,
  timelineFactor: 1.3,
  evaCapHours: 8,
  evaNominalHours: 6,
  ingressHours: 0.5,
  walkRadiusWarningM: 2000,
  minSunElevationDeg: 10,
  gainHysteresisM: 0.5,
});

const XEVA = 'NASA EVA-EXP-0042 Rev B (xEVA ConOps)';
const CSRM = 'Kim et al. ICES-2025-129';
const APOLLO = 'Olthoff ICES-2018-259; NASA SP-368';
const TP2017 = 'NASA/TP-2017-219457';
const MSL = 'MSL Engineering User Guide v2 (thermal inertia trafficability)';

export const EVA_PARAMS_BASIS: Readonly<Record<keyof EvaParams, ParameterNote>> = {
  maxSlopeDeg: { basis: 'sourced-lunar', note: 'maxSlope', refs: [XEVA, CSRM] },
  slopeBands: { basis: 'assumption', note: 'slopeBands', refs: ['Iqbal et al. EPSC 2024'] },
  crossSlopeWeight: { basis: 'assumption', note: 'crossSlope', refs: [CSRM] },
  roughP90Deg: { basis: 'assumption', note: 'rough', refs: [] },
  roughPenalty: { basis: 'assumption', note: 'rough', refs: [] },
  lowThermalInertia: { basis: 'assumption', note: 'thermalInertia', refs: [MSL] },
  lowThermalInertiaPenalty: { basis: 'assumption', note: 'thermalInertia', refs: [MSL] },
  levelSpeedKmh: { basis: 'sourced-lunar', note: 'levelSpeed', refs: [XEVA] },
  slopeSpeedFactorPerDeg: { basis: 'sourced-lunar', note: 'slopeSpeed', refs: [CSRM, APOLLO] },
  minSpeedFactor: { basis: 'assumption', note: 'slopeSpeed', refs: [] },
  timelineFactor: { basis: 'sourced-lunar', note: 'timeline', refs: [TP2017] },
  evaCapHours: { basis: 'sourced-lunar', note: 'evaDuration', refs: [XEVA] },
  evaNominalHours: { basis: 'sourced-lunar', note: 'evaDuration', refs: [XEVA] },
  ingressHours: { basis: 'sourced-lunar', note: 'walkback', refs: [APOLLO] },
  walkRadiusWarningM: { basis: 'sourced-lunar', note: 'walkRadius', refs: [XEVA] },
  minSunElevationDeg: { basis: 'assumption', note: 'daylight', refs: [] },
  gainHysteresisM: { basis: 'assumption', note: 'gainHysteresis', refs: [] },
};

/**
 * The maximum slope a suited walker may take is the least certain of these values (lunar-derived,
 * applied to Mars's 0.38 g). The route is recomputed under other limits to show how much it depends
 * on it: these are the scenarios shown.
 */
export const SLOPE_SCENARIOS_DEG = [15, 25] as const;

/**
 * The same parameters with another maximum slope; the steepest band reaches up to it, so slopes
 * above the default limit keep that band's penalty rather than becoming impassable.
 */
export function withMaxSlope(base: EvaParams, maxSlopeDeg: number): EvaParams {
  const bands = base.slopeBands.map((b, i, all) =>
    i === all.length - 1 ? { ...b, upToDeg: Math.max(b.upToDeg, maxSlopeDeg) } : b,
  );
  return { ...base, maxSlopeDeg, slopeBands: bands };
}

/** Stable FNV-1a (32-bit) fingerprint of a JSON-serializable value, used to version parameter sets. */
export function fingerprint(value: unknown): string {
  const text = canonicalJson(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
