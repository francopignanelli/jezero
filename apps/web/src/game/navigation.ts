import { wrapAngle } from '../lib/math';

/**
 * AutoNav for the rover game, after Perseverance's own (ENav): the ground ahead is judged for
 * slope, soft sand and boulders, a path is planned around them, and the rover drives it by itself.
 * The real rover plans from its stereo cameras a few metres at a time; the game plans over the
 * whole map at once on a cost grid (2 m cells) built from the same terrain the wheels feel.
 *
 * Pure (no three.js): the grid takes the ground through callbacks; tested in game.test.ts.
 */

export const NAV = {
  cellM: 2,
  /** Slopes above this (°) are not driven (the rover's limit is 30°; AutoNav keeps a margin). */
  maxSlopeDeg: 25,
  /** Extra cost per unit of (slope / max)², and for sand (deep sand is nearly forbidden). */
  slopeCost: 4,
  sandCost: 5,
  deepSand: 0.5,
  deepSandCost: 40,
  /** Clearance kept from boulders that block the wheels (rover half-width + margin, m). */
  rockClearM: 1.7,
  /** Path following: look-ahead (m), turn in place beyond this heading error (rad). */
  lookAheadM: 5,
  turnInPlaceRad: 0.65,
  /** Arrival: this far inside the target's ring (m). */
  arriveM: 4,
} as const;

export interface NavGround {
  /** Extent of the grid around the local origin (m): x east ±width/2, north ±height/2. */
  widthM: number;
  heightM: number;
  /** Keep this far inside the extent (m). */
  marginM: number;
  height(x: number, north: number): number;
  sand(x: number, north: number): number;
  /** Boulders that stop the wheels: centre and radius (m). */
  obstacles: Array<{ x: number; north: number; radiusM: number }>;
}

export type Point = [number, number];

class Heap {
  private items: number[] = [];
  private keys: number[] = [];
  get size(): number {
    return this.items.length;
  }
  push(item: number, key: number): void {
    const a = this.items;
    const k = this.keys;
    a.push(item);
    k.push(key);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p]! <= k[i]!) break;
      [a[p], a[i]] = [a[i]!, a[p]!];
      [k[p], k[i]] = [k[i]!, k[p]!];
      i = p;
    }
  }
  pop(): number {
    const a = this.items;
    const k = this.keys;
    const top = a[0]!;
    const lastA = a.pop()!;
    const lastK = k.pop()!;
    if (a.length) {
      a[0] = lastA;
      k[0] = lastK;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && k[l]! < k[m]!) m = l;
        if (r < a.length && k[r]! < k[m]!) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        [k[m], k[i]] = [k[i]!, k[m]!];
        i = m;
      }
    }
    return top;
  }
}

/** Traversal cost per cell (1 = flat firm ground, Infinity = not driven). */
export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  readonly cost: Float32Array;
  private readonly x0: number;
  private readonly n0: number;

  constructor(g: NavGround) {
    const c = NAV.cellM;
    this.cols = Math.floor(g.widthM / c);
    this.rows = Math.floor(g.heightM / c);
    this.x0 = -this.cols * c * 0.5;
    this.n0 = this.rows * c * 0.5;
    this.cost = new Float32Array(this.cols * this.rows);
    const tanMax = Math.tan((NAV.maxSlopeDeg * Math.PI) / 180);
    const inner = (x: number, n: number) =>
      Math.abs(x) < g.widthM / 2 - g.marginM && Math.abs(n) < g.heightM / 2 - g.marginM;
    for (let r = 0; r < this.rows; r++)
      for (let k = 0; k < this.cols; k++) {
        const [x, n] = this.centre(k, r);
        const i = r * this.cols + k;
        if (!inner(x, n)) {
          this.cost[i] = Infinity;
          continue;
        }
        // Slope over the rover's length (2.5 m baseline, like its look-ahead).
        const dx = (g.height(x + 1.25, n) - g.height(x - 1.25, n)) / 2.5;
        const dn = (g.height(x, n + 1.25) - g.height(x, n - 1.25)) / 2.5;
        const t = Math.hypot(dx, dn) / tanMax;
        if (t > 1) {
          this.cost[i] = Infinity;
          continue;
        }
        const sand = g.sand(x, n);
        this.cost[i] =
          1 +
          NAV.slopeCost * t * t +
          (sand > NAV.deepSand ? NAV.deepSandCost : NAV.sandCost * sand);
      }
    for (const o of g.obstacles) this.block(o.x, o.north, o.radiusM);
  }

  centre(k: number, r: number): Point {
    return [this.x0 + (k + 0.5) * NAV.cellM, this.n0 - (r + 0.5) * NAV.cellM];
  }
  cellOf(x: number, n: number): [number, number] {
    return [Math.floor((x - this.x0) / NAV.cellM), Math.floor((this.n0 - n) / NAV.cellM)];
  }
  private index(x: number, n: number): number {
    const [k, r] = this.cellOf(x, n);
    return k < 0 || r < 0 || k >= this.cols || r >= this.rows ? -1 : r * this.cols + k;
  }
  costAt(x: number, n: number): number {
    const i = this.index(x, n);
    return i < 0 ? Infinity : this.cost[i]!;
  }

  /** Marks a boulder (or a place found blocked while driving) as not drivable, with clearance. */
  block(x: number, n: number, radiusM: number): void {
    const R = radiusM + NAV.rockClearM;
    const [k0, r0] = this.cellOf(x - R, n + R);
    const [k1, r1] = this.cellOf(x + R, n - R);
    for (let r = Math.max(0, r0); r <= Math.min(this.rows - 1, r1); r++)
      for (let k = Math.max(0, k0); k <= Math.min(this.cols - 1, k1); k++) {
        const [cx, cn] = this.centre(k, r);
        if (Math.hypot(cx - x, cn - n) <= R) this.cost[r * this.cols + k] = Infinity;
      }
  }

  /** Nearest drivable cell to a point (within `searchM`), as a cell index, or −1. */
  private nearestFree(x: number, n: number, searchM = 12): number {
    const [k0, r0] = this.cellOf(x, n);
    const R = Math.ceil(searchM / NAV.cellM);
    let best = -1;
    let bestD = Infinity;
    for (let r = r0 - R; r <= r0 + R; r++)
      for (let k = k0 - R; k <= k0 + R; k++) {
        if (k < 0 || r < 0 || k >= this.cols || r >= this.rows) continue;
        const i = r * this.cols + k;
        if (!Number.isFinite(this.cost[i]!)) continue;
        const d = (k - k0) ** 2 + (r - r0) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    return best;
  }

  /**
   * A* from a point to anywhere within `goalRadiusM` of the goal (8-connected cells), then
   * shortened where a straight line stays on easy ground. Null when there is no way.
   */
  plan(from: Point, to: Point, goalRadiusM: number): Point[] | null {
    const start = this.nearestFree(from[0], from[1]);
    if (start < 0) return null;
    const cols = this.cols;
    const n = this.cost.length;
    const gScore = new Float32Array(n).fill(Infinity);
    const parent = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const heap = new Heap();
    const [gk, gr] = this.cellOf(to[0], to[1]);
    const goalCells = Math.max(1, goalRadiusM / NAV.cellM);
    const h = (i: number) => {
      const dk = Math.abs((i % cols) - gk);
      const dr = Math.abs(Math.floor(i / cols) - gr);
      const d = Math.max(0, Math.hypot(dk, dr) - goalCells);
      return d;
    };
    gScore[start] = 0;
    heap.push(start, h(start));
    let end = -1;
    const NB: Array<[number, number, number]> = [
      [1, 0, 1],
      [-1, 0, 1],
      [0, 1, 1],
      [0, -1, 1],
      [1, 1, Math.SQRT2],
      [1, -1, Math.SQRT2],
      [-1, 1, Math.SQRT2],
      [-1, -1, Math.SQRT2],
    ];
    while (heap.size) {
      const i = heap.pop();
      if (closed[i]) continue;
      closed[i] = 1;
      const k = i % cols;
      const r = Math.floor(i / cols);
      if (Math.hypot(k - gk, r - gr) <= goalCells) {
        end = i;
        break;
      }
      for (const [dk, dr, len] of NB) {
        const kk = k + dk;
        const rr = r + dr;
        if (kk < 0 || rr < 0 || kk >= cols || rr >= this.rows) continue;
        const j = rr * cols + kk;
        const c = this.cost[j]!;
        if (closed[j] || !Number.isFinite(c)) continue;
        // No corner cutting past a blocked cell.
        if (
          dk &&
          dr &&
          (!Number.isFinite(this.cost[r * cols + kk]!) ||
            !Number.isFinite(this.cost[rr * cols + k]!))
        )
          continue;
        const g = gScore[i]! + len * (c + this.cost[i]!) * 0.5;
        if (g < gScore[j]!) {
          gScore[j] = g;
          parent[j] = i;
          heap.push(j, g + h(j));
        }
      }
    }
    if (end < 0) return null;
    const cells: number[] = [];
    for (let i = end; i >= 0; i = parent[i]!) cells.push(i);
    cells.reverse();
    const pts = cells.map((i) => this.centre(i % cols, Math.floor(i / cols)));
    pts[0] = [from[0], from[1]];
    return this.shorten(pts);
  }

  /** Whether a straight drive between two points stays on drivable ground no harder than `limit`. */
  clear(a: Point, b: Point, limit: number): boolean {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.ceil(d / (NAV.cellM * 0.5)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      if (this.costAt(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t) > limit) return false;
    }
    return true;
  }

  /** String-pulling: keeps a point only where the line past it would leave easy ground. */
  private shorten(pts: Point[]): Point[] {
    if (pts.length < 3) return pts;
    const out: Point[] = [pts[0]!];
    let i = 0;
    while (i < pts.length - 1) {
      // The hardest cell the grid path itself crosses between i and j bounds the shortcut.
      let j = Math.min(pts.length - 1, i + 1);
      let worst = this.costAt(...pts[j]!);
      for (let k = i + 2; k < pts.length; k++) {
        worst = Math.max(worst, this.costAt(...pts[k]!));
        if (!this.clear(pts[i]!, pts[k]!, Math.max(1.6, worst * 1.15))) break;
        j = k;
        // Keep a point at least every 40 m (the follower re-aims along long lines).
        if (Math.hypot(pts[k]![0] - pts[i]![0], pts[k]![1] - pts[i]![1]) > 40) break;
      }
      out.push(pts[j]!);
      i = j;
    }
    return out;
  }
}

/** Path length (m). */
export const pathLength = (p: Point[]): number =>
  p.reduce((m, q, i) => (i ? m + Math.hypot(q[0] - p[i - 1]![0], q[1] - p[i - 1]![1]) : 0), 0);

export interface FollowState {
  /** Index of the path point being driven towards. */
  index: number;
}

/**
 * Pure pursuit along the path: aims at a point `lookAheadM` ahead on it, turns in place when the
 * error is large, slows into sharp turns and at the end. Heading: compass (clockwise from north).
 */
export function follow(
  pose: { x: number; north: number; headingRad: number },
  path: Point[],
  st: FollowState,
  goal: { x: number; north: number; radiusM: number },
): { throttle: number; steer: number; done: boolean } {
  const d = (p: Point) => Math.hypot(p[0] - pose.x, p[1] - pose.north);
  const toGoal = Math.hypot(goal.x - pose.x, goal.north - pose.north);
  if (toGoal <= Math.max(1.5, goal.radiusM - NAV.arriveM))
    return { throttle: 0, steer: 0, done: true };
  while (st.index < path.length - 1 && d(path[st.index]!) < NAV.lookAheadM) st.index++;
  const aim = path[st.index]!;
  const bearing = Math.atan2(aim[0] - pose.x, aim[1] - pose.north);
  const err = wrapAngle(bearing - pose.headingRad);
  const steer = Math.max(-1, Math.min(1, err * 2.2));
  if (Math.abs(err) > NAV.turnInPlaceRad) return { throttle: 0, steer, done: false };
  const slowTurn = 1 - Math.abs(err) / (NAV.turnInPlaceRad * 1.6);
  const slowEnd = Math.min(1, 0.35 + toGoal / 25);
  return { throttle: Math.max(0.3, Math.min(slowTurn, slowEnd)), steer, done: false };
}
