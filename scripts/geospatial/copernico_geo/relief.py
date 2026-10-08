"""Shaded relief from MOLA topography, baked into the Viking colour mosaics.

At globe scale the 3D terrain is far too coarse to shade craters, canyons and volcanoes, so Mars
looked flat from orbit. This is standard planetary cartography (as in the USGS Viking/MOLA maps):
the colour stays the Viking mosaic, and each pixel is multiplied by a hillshade of the real MOLA
heights, normalised so flat ground keeps its brightness.

The Viking colour is synthesised from red and violet filters, which turns dark basaltic regions
blue; true-colour views (Hubble, EMM/EXI) show them dark grey-brown. So the blue excess over red is
moved back toward warm grey here (cool pixels only; luminance roughly kept).

Display choices (stated in the layer provenance): light from the north-west at 35° (the cartographic
convention, not the scene's computed Sun), vertical exaggeration ×4 at the 925 m globe (relief of a
few km is otherwise invisible at that scale) and ×2 for the 232 m window, blend strength 0.65.
"""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from osgeo import gdal

from .frames import MARS_R
from .paths import WORK, ensure

gdal.UseExceptions()

M_PER_DEG = MARS_R * math.pi / 180
AZIMUTH_DEG = 315.0
ALTITUDE_DEG = 35.0
STRENGTH = 0.65
STRIP = 512


def _heights_on(mosaic: gdal.Dataset, name: str) -> gdal.Dataset:
    """MOLA heights resampled onto the colour mosaic's grid (cubic spline), cached."""
    dst = ensure(WORK / "mosaics") / f"relief_heights_{name}.tif"
    if not dst.exists():
        x0, dx, _, y0, _, dy = mosaic.GetGeoTransform()
        w, h = mosaic.RasterXSize, mosaic.RasterYSize
        print(f"[relief] MOLA heights on the {name} grid ({w}×{h})")
        gdal.Warp(
            str(dst),
            str(WORK / "mosaics" / "height_mola.tif"),
            outputBounds=(x0, y0 + dy * h, x0 + dx * w, y0),
            width=w,
            height=h,
            resampleAlg="cubicspline",
            outputType=gdal.GDT_Float32,
            multithread=True,
            creationOptions=["TILED=YES", "COMPRESS=DEFLATE", "PREDICTOR=3", "BIGTIFF=YES"],
        )
    return gdal.Open(str(dst))


def hillshade(z: np.ndarray, lat: np.ndarray, pixel_deg: float, exaggeration: float, wrap: bool) -> np.ndarray:
    """Shade factor (1 = flat ground) for a block of heights with one latitude per row."""
    if wrap:
        zx = (np.roll(z, -1, axis=1) - np.roll(z, 1, axis=1))
    else:
        zx = np.zeros_like(z)
        zx[:, 1:-1] = z[:, 2:] - z[:, :-2]
    zy = np.zeros_like(z)
    zy[1:-1] = z[:-2] - z[2:]  # row 0 is north: north minus south
    dx = 2 * pixel_deg * M_PER_DEG * np.maximum(np.cos(np.radians(lat)), 0.05)[:, None]
    dy = 2 * pixel_deg * M_PER_DEG
    gx = exaggeration * zx / dx  # dz/d(east)
    gy = exaggeration * zy / dy  # dz/d(north)
    az = math.radians(AZIMUTH_DEG)
    alt = math.radians(ALTITUDE_DEG)
    # Unit normal (−gx, −gy, 1)/n against the light vector (east, north, up).
    lx, ly, lz = math.cos(alt) * math.sin(az), math.cos(alt) * math.cos(az), math.sin(alt)
    n = np.sqrt(gx * gx + gy * gy + 1)
    shade = (-gx * lx - gy * ly + lz) / n
    return np.clip(shade / lz, 0.0, 1.8)


def warm_balance(rgb: np.ndarray) -> np.ndarray:
    """Moves the blue excess over red (cool pixels only) toward warm grey."""
    r, g, b = rgb
    cool = np.clip(b - r, 0, None)
    return np.stack([r + 0.55 * cool, g + 0.05 * cool, b - 0.7 * cool])


def shade_mosaic(src: Path, name: str, exaggeration: float, wrap: bool) -> Path:
    """Copy of an RGBA colour mosaic multiplied by the MOLA hillshade (with overviews)."""
    dst = ensure(WORK / "mosaics") / f"{src.stem}_relief.tif"
    if dst.exists():
        return dst
    ds = gdal.Open(str(src))
    heights_ds = _heights_on(ds, name)  # keep the dataset alive while its band is read
    heights = heights_ds.GetRasterBand(1)
    w, h = ds.RasterXSize, ds.RasterYSize
    x0, dx, _, y0, _, dy = ds.GetGeoTransform()
    out = gdal.GetDriverByName("GTiff").Create(
        str(dst), w, h, ds.RasterCount, gdal.GDT_Byte,
        options=["TILED=YES", "COMPRESS=DEFLATE", "BIGTIFF=IF_SAFER"],
    )
    out.SetGeoTransform(ds.GetGeoTransform())
    out.SetProjection(ds.GetProjection())
    print(f"[relief] shading {name} ({w}×{h})")
    for top in range(0, h, STRIP):
        r0, r1 = max(0, top - 1), min(h, top + STRIP + 1)  # one row of overlap for the gradient
        z = heights.ReadAsArray(0, r0, w, r1 - r0).astype(np.float64)
        lat = y0 + dy * (np.arange(r0, r1) + 0.5)
        f = hillshade(z, lat, abs(dx), exaggeration, wrap)
        f = 1 + STRENGTH * (f - 1)
        f = f[top - r0 : top - r0 + min(STRIP, h - top)]
        rgba = ds.ReadAsArray(0, top, w, f.shape[0]).astype(np.float32)
        rgb = warm_balance(rgba[:3]) * f
        for b in range(3):
            out.GetRasterBand(b + 1).WriteArray(np.clip(rgb[b], 0, 255).astype(np.uint8), 0, top)
        out.GetRasterBand(ds.RasterCount).WriteArray(rgba[-1].astype(np.uint8), 0, top)  # alpha unchanged
    out.FlushCache()
    out = None
    shaded = gdal.Open(str(dst), gdal.GA_Update)
    shaded.BuildOverviews("AVERAGE", [2, 4, 8, 16, 32, 64, 128])
    shaded = None
    return dst
