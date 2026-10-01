import { describe, expect, it } from 'vitest';
import { apply, icrfToMarsFixed, raDecToVector, solarSystemFromMars } from './sky';
import { sunDirectionBodyFixed } from './sun';

const angleDeg = (a: number[], b: number[]) =>
  (Math.acos(Math.min(1, a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!)) * 180) / Math.PI;

describe('sky: ICRF → Mars-fixed rotation and solar-system bodies', () => {
  it.each([Date.UTC(2021, 1, 18, 20, 55), Date.UTC(2026, 8, 26, 14)])(
    'the Sun direction agrees with the independent Mars24 subsolar point to < 0.1° (%i)',
    (ms) => {
      const sun = solarSystemFromMars(ms).find((b) => b.id === 'Sun')!;
      const bodyFixed = apply(icrfToMarsFixed(ms), sun.directionIcrf);
      expect(angleDeg(bodyFixed, sunDirectionBodyFixed(ms))).toBeLessThan(0.1);
    },
  );

  it('is a proper rotation (orthonormal, determinant +1)', () => {
    const m = icrfToMarsFixed(Date.UTC(2026, 8, 26));
    const x = apply(m, [1, 0, 0]);
    const y = apply(m, [0, 1, 0]);
    const z = apply(m, [0, 0, 1]);
    const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
    expect(dot(x, y)).toBeCloseTo(0, 12);
    expect(dot(x, x)).toBeCloseTo(1, 12);
    const cross = [
      x[1]! * y[2]! - x[2]! * y[1]!,
      x[2]! * y[0]! - x[0]! * y[2]!,
      x[0]! * y[1]! - x[1]! * y[0]!,
    ];
    expect(angleDeg(cross, z)).toBeLessThan(1e-6);
  });

  it('maps the IAU 2015 Mars north pole (RA ≈ 317.7°, Dec ≈ 52.9°) to the body z axis', () => {
    const ms = Date.UTC(2026, 8, 26);
    const pole = raDecToVector((317.68 * Math.PI) / 180, (52.89 * Math.PI) / 180);
    expect(angleDeg(apply(icrfToMarsFixed(ms), pole), [0, 0, 1])).toBeLessThan(0.1);
  });

  it('gives physically sensible sizes and magnitudes as seen from Mars', () => {
    const bodies = solarSystemFromMars(Date.UTC(2026, 8, 26));
    const sun = bodies.find((b) => b.id === 'Sun')!;
    expect(sun.angularDiameterDeg).toBeGreaterThan(0.31); // aphelion 1.666 AU
    expect(sun.angularDiameterDeg).toBeLessThan(0.39); // perihelion 1.381 AU
    const earth = bodies.find((b) => b.id === 'Earth')!;
    expect(earth.distanceAu).toBeGreaterThan(0.37);
    expect(earth.distanceAu).toBeLessThan(2.7);
    expect(earth.angularDiameterDeg * 3600).toBeLessThan(50); // arcseconds: a point to the eye
    expect(bodies.find((b) => b.id === 'Jupiter')!.magnitude).toBeLessThan(-1);
  });
});
