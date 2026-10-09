"""Loading-screen background: the real Milky Way (the scene's own sky map) around the galactic
centre, rotated into a diagonal band and baked at screen size.

Doing the crop, rotation and smoothing here keeps the loading screen to one ordinary full-screen
image. As CSS (a 280vmax rotated, blurred element of the 4K map) it cost a huge layer to paint while
the app was busy loading, which made the loader stutter.

Mapping (same framing as the previous CSS): the 8K equirectangular map spans 280 × 140 screen
widths; the point u = 0.77, v = 0.56 sits at the screen centre; the map is turned −86°.
"""
from __future__ import annotations

import math

import numpy as np
from osgeo import gdal

from .paths import BUILD

gdal.UseExceptions()

W, H = 1920, 1080
U0, V0 = 0.77, 0.56
SPAN_W = 2.8  # map width in screen widths
ROT_DEG = -86.0
BLUR_PX = 0.7


def _blur(a: np.ndarray, sigma: float) -> np.ndarray:
    r = int(3 * sigma)
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    for axis in (0, 1):
        a = np.apply_along_axis(lambda m: np.convolve(m, k, mode="same"), axis, a)
    return a


def build() -> str:
    src = gdal.Open(str(BUILD / "sky" / "milkyway_8k.webp"))
    sw, sh = src.RasterXSize, src.RasterYSize
    # Screen coordinates in screen widths, centred; the inverse rotation gives map offsets.
    x = (np.arange(W) + 0.5 - W / 2) / W
    y = (np.arange(H) + 0.5 - H / 2) / W
    sx, sy = np.meshgrid(x, y)
    t = math.radians(-ROT_DEG)
    lx = sx * math.cos(t) - sy * math.sin(t)
    ly = sx * math.sin(t) + sy * math.cos(t)
    px = ((U0 + lx / SPAN_W) % 1.0) * sw - 0.5
    py = (V0 + ly / (SPAN_W / 2)) * sh - 0.5
    x0, x1 = int(np.floor(px.min())) - 1, int(np.ceil(px.max())) + 2
    y0, y1 = max(0, int(np.floor(py.min())) - 1), min(sh, int(np.ceil(py.max())) + 2)
    window = src.ReadAsArray(x0, y0, x1 - x0, y1 - y0).astype(np.float32)  # (3, h, w)
    fx, fy = px - x0, py - y0
    ix, iy = np.clip(np.floor(fx).astype(int), 0, window.shape[2] - 2), np.clip(np.floor(fy).astype(int), 0, window.shape[1] - 2)
    tx, ty = fx - ix, fy - iy
    out = np.empty((3, H, W), dtype=np.float32)
    for b in range(3):
        a = window[b]
        v = (a[iy, ix] * (1 - tx) * (1 - ty) + a[iy, ix + 1] * tx * (1 - ty)
             + a[iy + 1, ix] * (1 - tx) * ty + a[iy + 1, ix + 1] * tx * ty)
        out[b] = _blur(v, BLUR_PX)
    # Slightly richer colour (as the previous CSS saturate(1.15)).
    lum = out.mean(axis=0, keepdims=True)
    out = np.clip(lum + (out - lum) * 1.15, 0, 255).astype(np.uint8)
    mem = gdal.GetDriverByName("MEM").Create("", W, H, 3, gdal.GDT_Byte)
    for b in range(3):
        mem.GetRasterBand(b + 1).WriteArray(out[b])
    dst = BUILD / "sky" / "loading_bg.webp"
    gdal.Translate(str(dst), mem, format="WEBP", creationOptions=["QUALITY=72"])
    dst.with_suffix(".webp.aux.xml").unlink(missing_ok=True)
    print(f"[loading-bg] {dst.name}: {dst.stat().st_size} bytes")
    return str(dst)
