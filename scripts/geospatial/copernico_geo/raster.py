"""Raster math shared by the pipeline. Horn slope mirrors packages/domain/src/terrain/slope.ts."""
from __future__ import annotations

import numpy as np

from .frames import M2020_LAT_TS, MARS_R


def row_latitudes_deg(origin_y: float, cell: float, rows: int) -> np.ndarray:
    """Latitude of each row centre for a north-up grid in an eqc frame (y = R φ)."""
    y = origin_y - (np.arange(rows) + 0.5) * cell
    return np.degrees(y / MARS_R)


def row_widths_m(origin_y: float, cell: float, rows: int, lat_ts: float = M2020_LAT_TS) -> np.ndarray:
    """Ground east-west cell width per row: cell · cos φ / cos φts."""
    lat = np.radians(row_latitudes_deg(origin_y, cell, rows))
    return cell * np.cos(lat) / np.cos(np.radians(lat_ts))


def horn_gradient(z: np.ndarray, origin_y: float, cell: float) -> tuple[np.ndarray, np.ndarray]:
    """dz/dEast, dz/dNorth (m/m) with Horn's 3×3 operator; NaN on edges and next to nodata."""
    rows, cols = z.shape
    dx = row_widths_m(origin_y, cell, rows)[1:-1, None]
    a, b, c = z[:-2, :-2], z[:-2, 1:-1], z[:-2, 2:]
    d, e, f = z[1:-1, :-2], z[1:-1, 1:-1], z[1:-1, 2:]
    g, h, i = z[2:, :-2], z[2:, 1:-1], z[2:, 2:]
    gx = np.full(z.shape, np.nan, dtype=np.float32)
    gy = np.full(z.shape, np.nan, dtype=np.float32)
    with np.errstate(invalid="ignore"):
        inner_x = ((c + 2 * f + i) - (a + 2 * d + g)) / (8 * dx)
        inner_y = ((a + 2 * b + c) - (g + 2 * h + i)) / (8 * cell)
        centre_nan = np.isnan(e)
        inner_x[centre_nan] = np.nan
        inner_y[centre_nan] = np.nan
    gx[1:-1, 1:-1] = inner_x
    gy[1:-1, 1:-1] = inner_y
    return gx, gy


def slope_deg(gx: np.ndarray, gy: np.ndarray) -> np.ndarray:
    return np.degrees(np.arctan(np.hypot(gx, gy))).astype(np.float32)


def erode(mask: np.ndarray, iterations: int = 1) -> np.ndarray:
    """Binary erosion with a 3×3 structuring element; the grid border is treated as invalid."""
    m = mask.astype(bool).copy()
    for _ in range(iterations):
        e = m.copy()
        e[0, :] = e[-1, :] = False
        e[:, 0] = e[:, -1] = False
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                if dr == 0 and dc == 0:
                    continue
                shifted = np.zeros_like(m)
                src = m[max(dr, 0) : m.shape[0] + min(dr, 0), max(dc, 0) : m.shape[1] + min(dc, 0)]
                shifted[max(-dr, 0) : m.shape[0] + min(-dr, 0), max(-dc, 0) : m.shape[1] + min(-dc, 0)] = src
                e &= shifted
        m = e
    return m


def blocks(a: np.ndarray, k: int) -> np.ndarray:
    """(R·k, C·k) → (R, C, k·k) view-copy of non-overlapping k×k blocks."""
    r, c = a.shape[0] // k, a.shape[1] // k
    return a[: r * k, : c * k].reshape(r, k, c, k).transpose(0, 2, 1, 3).reshape(r, c, k * k)
