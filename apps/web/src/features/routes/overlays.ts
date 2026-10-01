import { BLOCK, type PreparedTerrain } from '@copernico/domain';

export type OverlayKind = 'slope' | 'elevation' | 'thermalInertia';

/** Slope class colours (colour-blind-distinguishable by luminance); blocked cells are also striped. */
export const SLOPE_COLOURS = {
  mild: [31, 158, 137, 90],
  moderate: [253, 231, 37, 150],
  steep: [248, 149, 64, 175],
  blocked: [204, 42, 54, 200],
} as const;

// Perceptually ordered ramp (viridis-like), 5 stops.
const RAMP: ReadonlyArray<readonly [number, number, number]> = [
  [68, 1, 84],
  [59, 82, 139],
  [33, 145, 140],
  [94, 201, 98],
  [253, 231, 37],
];

function ramp(t: number): readonly [number, number, number] {
  const x = Math.min(1, Math.max(0, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  const f = x - i;
  const a = RAMP[i]!;
  const b = RAMP[i + 1]!;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export interface Overlay {
  kind: OverlayKind;
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  /** Value range used for the legend (elevation, thermal inertia). */
  range: [number, number] | null;
}

/**
 * Renders a scientific overlay at one pixel per routing cell. Because the grid is equirectangular,
 * pixel rows and columns align exactly with lines of latitude and longitude, so the image can be
 * draped over its lon/lat rectangle without resampling error.
 */
export function renderOverlay(t: PreparedTerrain, kind: OverlayKind): Overlay {
  const { cols, rows } = t.layers.spec;
  const rgba = new Uint8ClampedArray(cols * rows * 4);
  let range: [number, number] | null = null;
  const source =
    kind === 'elevation' ? t.layers.elevation : kind === 'thermalInertia' ? t.layers.thermalInertia : undefined;
  if (source) {
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const v of source) {
      if (Number.isFinite(v)) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
    range = [lo, hi];
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = r * cols + c;
      const o = k * 4;
      if (kind === 'slope') {
        if (t.block[k] === BLOCK.nodata) continue;
        const s = t.constraintSlopeDeg[k]!;
        const colour =
          t.block[k] !== BLOCK.none
            ? SLOPE_COLOURS.blocked
            : s <= 10
              ? SLOPE_COLOURS.mild
              : s <= 15
                ? SLOPE_COLOURS.moderate
                : SLOPE_COLOURS.steep;
        const stripe = t.block[k] !== BLOCK.none && (c + r) % 4 < 2;
        rgba[o] = stripe ? 255 : colour[0];
        rgba[o + 1] = stripe ? 255 : colour[1];
        rgba[o + 2] = stripe ? 255 : colour[2];
        rgba[o + 3] = colour[3];
      } else if (source && range) {
        const v = source[k]!;
        if (!Number.isFinite(v)) continue;
        const [cr, cg, cb] = ramp((v - range[0]) / Math.max(1e-9, range[1] - range[0]));
        rgba[o] = cr;
        rgba[o + 1] = cg;
        rgba[o + 2] = cb;
        rgba[o + 3] = 170;
      }
    }
  }
  return { kind, width: cols, height: rows, rgba, range };
}
