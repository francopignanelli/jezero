import { describe, expect, it } from 'vitest';
import { robustRange } from './overlays';

describe('robustRange (overlay colour stretch)', () => {
  it('ignores a few extreme values and non-finite cells', () => {
    const values = Array.from({ length: 1000 }, (_, i) => i / 10); // 0 … 99.9
    values[0] = -5000; // outlier
    values[1] = Number.NaN; // nodata
    values.push(9000); // outlier
    const [lo, hi] = robustRange(values);
    expect(lo).toBeGreaterThan(0);
    expect(lo).toBeLessThan(3);
    expect(hi).toBeGreaterThan(96);
    expect(hi).toBeLessThan(100);
  });
  it('handles constant and empty inputs', () => {
    const [lo, hi] = robustRange([5, 5, 5]);
    expect(hi).toBeGreaterThan(lo);
    expect(robustRange([Number.NaN])).toEqual([0, 1]);
  });
});
