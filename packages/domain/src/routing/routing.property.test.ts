import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { elevationFrom, syntheticSpec } from '../testing/synthetic';
import { DEFAULT_EVA_PARAMS } from '../traversal/params';
import { findPath } from './astar';
import { reachableFrom } from './reachability';
import { BLOCK, prepareTerrain } from './terrain';

const SIZE = 16;
const spec = syntheticSpec(SIZE, SIZE);
const elevation = elevationFrom(spec, () => -2570);

describe('path search invariants (property-based)', () => {
  it('paths use only traversable, adjacent cells without corner-cutting, and agree with flood fill', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: SIZE * SIZE, maxLength: SIZE * SIZE }),
        fc.integer({ min: 0, max: SIZE * SIZE - 1 }),
        fc.integer({ min: 0, max: SIZE * SIZE - 1 }),
        (noise, start, goal) => {
          const excluded = Uint8Array.from(noise, (v) => (v < 70 ? 1 : 0));
          const t = prepareTerrain({ spec, elevation, excluded }, DEFAULT_EVA_PARAMS);
          fc.pre(t.block[start] === BLOCK.none && t.block[goal] === BLOCK.none);
          const { path } = findPath(t, 'lower-risk', start, goal);
          const reachable = reachableFrom(t, start)[goal] === 1;
          expect(path !== null).toBe(reachable);
          if (!path) return;
          expect(path[0]).toBe(start);
          expect(path[path.length - 1]).toBe(goal);
          for (let i = 1; i < path.length; i++) {
            const a = path[i - 1]!;
            const b = path[i]!;
            const [ac, ar, bc, br] = [a % SIZE, (a / SIZE) | 0, b % SIZE, (b / SIZE) | 0];
            expect(t.block[b]).toBe(BLOCK.none);
            expect(Math.max(Math.abs(ac - bc), Math.abs(ar - br))).toBe(1);
            if (ac !== bc && ar !== br) {
              expect(t.block[ar * SIZE + bc]).toBe(BLOCK.none);
              expect(t.block[br * SIZE + ac]).toBe(BLOCK.none);
            }
          }
        },
      ),
      { numRuns: 300, seed: 20261114 },
    );
  });
});
