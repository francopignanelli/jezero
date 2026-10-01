import { describe, expect, it } from 'vitest';
import { gainLoss } from './metrics';
import { DEFAULT_EVA_PARAMS, EVA_PARAMS_BASIS, fingerprint } from '../traversal/params';
import { walkingSpeedMps } from '../traversal/speed';

describe('elevation gain and loss', () => {
  it('suppresses sub-threshold noise but keeps net change exact', () => {
    const noisy = [0, 0.2, -0.1, 0.3, 0.1, 5, 4.8, 5.2, 2, 2.1, 1.9];
    const { gain, loss } = gainLoss(noisy, 0.5);
    expect(gain - loss).toBeCloseTo(1.9 - 0, 10);
    expect(gain).toBeLessThan(5.6);
  });

  it('counts a clean ramp exactly', () => {
    expect(gainLoss([0, 10, 20, 15, 5], 0.5)).toEqual({ gain: 20, loss: 15 });
  });

  it('ignores nodata samples', () => {
    expect(gainLoss([0, Number.NaN, 10], 0.5)).toEqual({ gain: 10, loss: 0 });
  });
});

describe('EVA parameter set', () => {
  it('labels the basis of every parameter', () => {
    for (const key of Object.keys(DEFAULT_EVA_PARAMS)) {
      expect(EVA_PARAMS_BASIS[key as keyof typeof EVA_PARAMS_BASIS]).toBeDefined();
    }
  });

  it('has a stable fingerprint that changes with any value', () => {
    const base = fingerprint(DEFAULT_EVA_PARAMS);
    expect(fingerprint({ ...DEFAULT_EVA_PARAMS })).toBe(base);
    expect(fingerprint({ ...DEFAULT_EVA_PARAMS, maxSlopeDeg: 19 })).not.toBe(base);
  });

  it('speed models are positive and slow down on slopes', () => {
    for (const g of [-20, -10, 0, 6, 15, 20]) {
      expect(walkingSpeedMps('copernico-default', g, DEFAULT_EVA_PARAMS)).toBeGreaterThan(0);
      expect(walkingSpeedMps('sextant-apollo14', g, DEFAULT_EVA_PARAMS)).toBeGreaterThan(0);
    }
    expect(walkingSpeedMps('copernico-default', 0, DEFAULT_EVA_PARAMS)).toBeCloseTo(2 / 3.6, 10);
    expect(walkingSpeedMps('copernico-default', 15, DEFAULT_EVA_PARAMS)).toBeLessThan(
      walkingSpeedMps('copernico-default', 5, DEFAULT_EVA_PARAMS),
    );
    expect(walkingSpeedMps('sextant-apollo14', 3, DEFAULT_EVA_PARAMS)).toBeCloseTo(1.0, 10);
  });
});
