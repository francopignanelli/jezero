import { describe, expect, it } from 'vitest';
import { elevationFrom, syntheticSpec } from '../testing/synthetic';
import { hornGradient, hornGradientNoise, slopeDegrees } from './slope';

const d = Math.PI / 180;

describe('Horn slope', () => {
  const spec = syntheticSpec(21, 21, 5);

  it('is 0° on flat terrain', () => {
    const slope = slopeDegrees(hornGradient(spec, elevationFrom(spec, () => -2570)));
    const center = slope[10 * 21 + 10]!;
    expect(center).toBe(0);
  });

  it.each([
    [5, 0],
    [15, 45],
    [20, 90],
    [30, 225],
    [12.5, 300],
  ])('recovers an analytic plane of %f° (gradient azimuth %f°) to < 0.01°', (slopeDeg, azDeg) => {
    const g = Math.tan(slopeDeg * d);
    const gE = g * Math.sin(azDeg * d);
    const gN = g * Math.cos(azDeg * d);
    const elevation = elevationFrom(spec, (e, n) => -2500 + gE * e + gN * n);
    const grad = hornGradient(spec, elevation);
    const slope = slopeDegrees(grad);
    for (const [c, r] of [
      [10, 10],
      [1, 1],
      [19, 19],
      [3, 17],
    ] as const) {
      expect(Math.abs(slope[r * 21 + c]! - slopeDeg)).toBeLessThan(0.01);
      // Elevations are stored as Float32 (~2e-4 m resolution at 2.5 km), hence 1e-4 m/m tolerance.
      expect(Math.abs(grad.dzdEast[r * 21 + c]! - gE)).toBeLessThan(1e-4);
      expect(Math.abs(grad.dzdNorth[r * 21 + c]! - gN)).toBeLessThan(1e-4);
    }
  });

  it('is undefined (NaN) on the grid edge and next to nodata, never extrapolated', () => {
    const elevation = elevationFrom(spec, (e) => 0.1 * e);
    elevation[10 * 21 + 10] = Number.NaN;
    const slope = slopeDegrees(hornGradient(spec, elevation));
    expect(slope[0]).toBeNaN();
    expect(slope[20 * 21 + 20]).toBeNaN();
    for (let r = 9; r <= 11; r++) for (let c = 9; c <= 11; c++) expect(slope[r * 21 + c]).toBeNaN();
    expect(slope[10 * 21 + 12]).not.toBeNaN();
  });

  it('uses ground metres: the same plane gives the same slope far north and south in the grid', () => {
    const tall = syntheticSpec(5, 2001, 5); // ~10 km north-south
    const elevation = elevationFrom(tall, (e) => Math.tan(10 * d) * e);
    const slope = slopeDegrees(hornGradient(tall, elevation));
    expect(slope[1 * 5 + 2]!).toBeCloseTo(10, 4);
    expect(slope[1999 * 5 + 2]!).toBeCloseTo(10, 4);
  });

  it('documents the per-axis gradient noise bound for independent vertical errors', () => {
    // HiRISE DTM σz ≈ 0.2 m: ≈5° at a 1 m grid (2 m baseline), ≈1° at a 5 m grid (10 m baseline).
    expect(Math.atan(hornGradientNoise(0.2, 1)) / d).toBeCloseTo(4.95, 1);
    expect(Math.atan(hornGradientNoise(0.2, 5)) / d).toBeLessThan(1.0);
  });
});
