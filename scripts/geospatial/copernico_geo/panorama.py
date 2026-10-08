"""Real Mastcam-Z 360° panoramas: viewer images plus measured viewing geometry.

The published mosaics are cylindrical (360° of azimuth across the width, elevation linear in rows)
but carry no compass direction and no horizon row. Both are measured here by matching the skyline
in the photo to the horizon that our terrain models predict from the rover's position:

1. Skyline: on a 0.05°/px working copy, per column the first row from the top where smooth sky
   gives way to textured ground.
2. Terrain horizon: the highest elevation angle along rays every 0.05° from the Mastcam-Z position
   (rover ground + 2 m), out to 100 km on the Mars sphere, with the most detailed height source at
   each point (1 m HiRISE / MSR DTMs, 20 m CTX DEM, MOLA).
3. Fit: for every azimuth offset and both column directions, a least-squares fit of the horizon
   row and a mast tilt (cos/sin terms); the best median residual wins, refined with Huber weights.

Outputs: the viewer WebP (8192 px wide), a diagnostic PNG (photo skyline vs terrain horizon) and
the measured geometry, written back into data/catalog/panoramas.json under "geometry".
"""
from __future__ import annotations

import json
import math

import numpy as np
from osgeo import gdal

from .frames import MARS_R, BBox
from .paths import BUILD, RAW, ROOT, WORK, ensure

gdal.UseExceptions()

CATALOG = ROOT / "data" / "catalog" / "panoramas.json"
RAW_PANOS = ROOT / "data" / "raw" / "panoramas"
OUT = BUILD / "panoramas"
DEG_PX = 0.05  # working resolution (7200 columns for 360°)
COLS = round(360 / DEG_PX)
MAST_M = 2.0  # Mastcam-Z above the ground (Remote Sensing Mast head), approximate
VIEWER_PX = 8192

HEIGHTS = ["height_hirise", "height_msr", "height_msr_wide", "height_ctx", "height_mola"]  # fine → coarse
# The crater-rim stops (Lookout Hill, Witch Hazel Hill) are outside both 1 m boxes used for the 3D
# terrain, and their skylines are hillsides 50–300 m away that the 20 m CTX DEM cannot resolve. The
# whole MSR 1 m DTM (77.06–77.38°E) is therefore also sampled, at 2.5 m, for the horizon.
MSR_WIDE = BBox(west=77.10, south=18.30, east=77.38, north=18.58)
MSR_SRC = "msr-hirise/MSR_hirise_soc_003_DTM_MOLATopography_DeltaGeoid_1m_Eqc_latTs0_lon0_Blend40.tif"


class Grid:
    """A geographic height raster (NaN = no data), sampled bilinearly."""

    def __init__(self, name: str, around: tuple[float, float] | None = None, radius_deg: float = 2.0):
        ds = gdal.Open(str(WORK / "mosaics" / f"{name}.tif"))
        x0, dx, _, y0, _, dy = ds.GetGeoTransform()
        xoff, yoff, w, h = 0, 0, ds.RasterXSize, ds.RasterYSize
        if around is not None:  # read only a window (MOLA is global)
            lat, lon = around
            xoff = max(0, int((lon - radius_deg - x0) / dx))
            yoff = max(0, int((lat + radius_deg - y0) / dy))
            w = min(ds.RasterXSize - xoff, int(2 * radius_deg / dx) + 2)
            h = min(ds.RasterYSize - yoff, int(2 * radius_deg / -dy) + 2)
        band = ds.GetRasterBand(1)
        self.a = band.ReadAsArray(xoff, yoff, w, h).astype(np.float32)
        nodata = band.GetNoDataValue()
        if nodata is not None and not math.isnan(nodata):
            self.a[self.a == nodata] = np.nan
        self.x0, self.dx, self.y0, self.dy = x0 + xoff * dx, dx, y0 + yoff * dy, dy

    def sample(self, lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
        fx = (lon - self.x0) / self.dx - 0.5
        fy = (lat - self.y0) / self.dy - 0.5
        ix, iy = np.floor(fx).astype(np.int64), np.floor(fy).astype(np.int64)
        tx, ty = fx - ix, fy - iy
        h, w = self.a.shape
        inside = (ix >= 0) & (iy >= 0) & (ix < w - 1) & (iy < h - 1)
        ix, iy = np.clip(ix, 0, w - 2), np.clip(iy, 0, h - 2)
        a = self.a
        v = (a[iy, ix] * (1 - tx) * (1 - ty) + a[iy, ix + 1] * tx * (1 - ty)
             + a[iy + 1, ix] * (1 - tx) * ty + a[iy + 1, ix + 1] * tx * ty)
        return np.where(inside, v, np.nan)


def heights(grids: list[Grid], lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    out = np.full(lat.shape, np.nan, dtype=np.float64)
    for g in grids:
        missing = np.isnan(out)
        if not missing.any():
            break
        out[missing] = g.sample(lat[missing], lon[missing])
    return out


def terrain_horizon(lat0: float, lon0: float, grids: list[Grid]) -> tuple[np.ndarray, np.ndarray, float]:
    """Horizon elevation (deg) and its distance (m) per azimuth step from north, plus the camera height."""
    ground = float(heights(grids, np.array([lat0]), np.array([lon0]))[0])
    r0 = MARS_R + ground + MAST_M
    d = 10.0 * 1.004 ** np.arange(int(math.log(1e5 / 10) / math.log(1.004)) + 1)  # 10 m … 100 km
    delta = d / MARS_R
    phi1, lam1 = math.radians(lat0), math.radians(lon0)
    elev = np.empty(COLS)
    dist = np.empty(COLS)
    for start in range(0, COLS, 400):
        az = np.radians(np.arange(start, min(start + 400, COLS)) * DEG_PX)[:, None]
        phi2 = np.arcsin(math.sin(phi1) * np.cos(delta) + math.cos(phi1) * np.sin(delta) * np.cos(az))
        lam2 = lam1 + np.arctan2(np.sin(az) * np.sin(delta) * math.cos(phi1),
                                 np.cos(delta) - math.sin(phi1) * np.sin(phi2))
        h = heights(grids, np.degrees(phi2), np.degrees(lam2))
        r = MARS_R + h
        e = np.degrees(np.arctan2(r * np.cos(delta) - r0, r * np.sin(delta)))
        e = np.where(np.isnan(e), -90.0, e)
        k = np.argmax(e, axis=1)
        elev[start:start + len(az)] = e[np.arange(len(az)), k]
        dist[start:start + len(az)] = d[k]
    return elev, dist, ground


def read_working(src: str) -> np.ndarray:
    """RGB working copy with COLS columns across the full mosaic width (which spans about 360°)."""
    ds = gdal.Open(src)
    h = round(ds.RasterYSize * COLS / ds.RasterXSize)
    mem = gdal.Translate("", ds, format="MEM", width=COLS, height=h, resampleAlg="average")
    return mem.ReadAsArray().astype(np.float32)  # (3, h, COLS)


def skyline(rgb: np.ndarray) -> np.ndarray:
    """Row of the sky/ground boundary per column (NaN where no sky is visible)."""
    lum = 0.3 * rgb[0] + 0.59 * rgb[1] + 0.11 * rgb[2]
    valid = rgb.sum(axis=0) > 15
    g = np.zeros_like(lum)
    g[1:-1] = np.abs(lum[2:] - lum[:-2]) / 2
    g = (np.roll(g, 1, axis=1) + g + np.roll(g, -1, axis=1)) / 3  # mosaic wraps in azimuth
    top = g[: max(3, lum.shape[0] // 30)]
    noise = float(np.median(top[valid[: top.shape[0]]])) if valid[: top.shape[0]].any() else 1.0
    thr = max(5.0, 6.0 * noise)
    rows = np.full(lum.shape[1], np.nan)
    limit = int(lum.shape[0] * 0.6)
    for c in range(lum.shape[1]):
        col_valid = np.flatnonzero(valid[:limit, c])
        if len(col_valid) < 10:
            continue
        first = col_valid[0]
        hits = np.flatnonzero(g[first + 2 : limit, c] > thr)
        for hit in hits:
            r = first + 2 + hit
            if g[r : r + 6, c].mean() > thr / 2:  # textured ground, not a speck in the sky
                if r - first > 4:
                    rows[c] = r
                break
    return rows


def _solve(x_photo: np.ndarray, idx: np.ndarray, horizon: np.ndarray):
    az = np.radians(idx * DEG_PX)
    y = horizon[idx]
    a = np.column_stack([x_photo, np.ones_like(y), np.cos(az), np.sin(az)])
    coef, *_ = np.linalg.lstsq(a, y, rcond=None)
    return a, y, coef


def _index(c: np.ndarray, shift: float, direction: int, span: float) -> np.ndarray:
    """Horizon index (azimuth / DEG_PX) of working columns c when the width spans `span` degrees."""
    return np.round(shift + direction * c * span / 360.0).astype(np.int64) % COLS


def fit(rows: np.ndarray, horizon: np.ndarray) -> dict:
    """Azimuth of column 0 and column direction, then by least squares the
    photo's vertical scale, horizon row and mast tilt:
        horizon(az) = s·(−row·k) + c0 + p·cos(az) + q·sin(az).
    The width is taken as exactly 360°: letting the span vary (358–363°) never lowered the final
    residuals on the published mosaics, so the extra parameter is not used."""
    c = np.flatnonzero(~np.isnan(rows))
    x_photo = -rows[c] * DEG_PX

    def score(shift: float, direction: int, span: float):
        a, y, coef = _solve(x_photo, _index(c, shift, direction, span), horizon)
        if not 0.8 <= coef[0] <= 1.25:  # vertical scale must stay near the horizontal one
            return None
        return float(np.median(np.abs(y - a @ coef))), coef

    best = None
    for direction in (1, -1):
        for shift in range(COLS):
            r = score(shift, direction, 360.0)
            if r and (best is None or r[0] < best[0]):
                best = (r[0], direction, float(shift), 360.0)
    if best is None:
        raise RuntimeError("no plausible alignment")
    _, direction, shift, span = best
    # Huber refinement of the linear terms at the best alignment.
    idx = _index(c, shift, direction, span)
    a, y, coef = _solve(x_photo, idx, horizon)
    for _ in range(10):
        res = y - a @ coef
        sigma = 1.4826 * np.median(np.abs(res)) + 1e-6
        w = np.minimum(1.0, 1.5 * sigma / np.maximum(np.abs(res), 1e-9))
        coef, *_ = np.linalg.lstsq(a * w[:, None], y * w, rcond=None)
    res = y - a @ coef
    scale, c0, p, q = (float(v) for v in coef)
    # Photo elevation = true elevation + tilt(az), with tilt(az) = −(p·cos az + q·sin az).
    return {
        "azimuthAtLeftDeg": round((shift * DEG_PX) % 360, 2),
        "direction": direction,  # +1: azimuth grows to the right (clockwise seen from above)
        "spanDeg": round(span, 2),
        "verticalScale": round(scale, 4),
        "horizonRow": c0 / (scale * DEG_PX),
        "tiltDeg": round(math.hypot(p, q), 3),
        "tiltTowardAzimuthDeg": round(math.degrees(math.atan2(-q, -p)) % 360, 1),
        "medianResidualDeg": round(float(np.median(np.abs(res))), 3),
        "inlierFraction": round(float(np.mean(np.abs(res) < 0.3)), 3),
        "columnsUsed": int(len(c)),
        "_index": idx,
    }


def diagnostic(rgb: np.ndarray, rows: np.ndarray, horizon: np.ndarray, f: dict, path: str) -> None:
    """Top part of the working image with the photo skyline (magenta) and terrain horizon (cyan)."""
    h_row = f["horizonRow"]
    c = np.arange(COLS)
    idx = _index(c, f["azimuthAtLeftDeg"] / DEG_PX, f["direction"], f["spanDeg"])
    az = np.radians(idx * DEG_PX)
    tilt = f["tiltDeg"] * np.cos(az - math.radians(f["tiltTowardAzimuthDeg"]))
    model = h_row - (horizon[idx] + tilt) / (f["verticalScale"] * DEG_PX)
    lo = int(max(0, np.nanmin(rows) - 60)) if np.isfinite(rows).any() else 0
    hi = int(min(rgb.shape[1], (np.nanmax(rows) if np.isfinite(rows).any() else h_row) + 60))
    img = rgb[:, lo:hi].copy()
    for line, colour in ((rows, (255, 0, 255)), (model, (0, 255, 255))):
        for x in range(COLS):
            if np.isfinite(line[x]):
                y = int(round(line[x])) - lo
                if 0 <= y < img.shape[1]:
                    img[:, y, x] = colour
    drv = gdal.GetDriverByName("MEM").Create("", COLS, img.shape[1], 3, gdal.GDT_Byte)
    for i in range(3):
        drv.GetRasterBand(i + 1).WriteArray(np.clip(img[i], 0, 255).astype(np.uint8))
    gdal.Translate(path, drv, format="PNG")


def build(only: str | None = None) -> list[dict]:
    from .terrain import height_source

    height_source(RAW / MSR_SRC, "msr_wide", MSR_WIDE, 2.5 / 59274.7, -32767)  # cached after the first run
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    ensure(OUT)
    diag_dir = ensure(WORK / "panoramas")
    results = []
    for p in catalog["panoramas"]:
        if only and p["id"] != only:
            continue
        src = RAW_PANOS / p["sourceFile"]
        if not src.exists():
            print(f"[panorama] {p['id']}: missing {src.name} (run scripts/data/fetch-panoramas.ts)")
            continue
        lat, lon = p["position"]["lat"], p["position"]["lon"]
        grids = [Grid(n) if n != "height_mola" else Grid(n, around=(lat, lon)) for n in HEIGHTS]
        horizon, dist, ground = terrain_horizon(lat, lon, grids)
        rgb = read_working(str(src))
        rows = skyline(rgb)
        try:
            f = fit(rows, horizon)
        except RuntimeError as err:
            p["geometry"] = None
            p["excluded"] = f"geometry not measurable: {err} (skyline does not match the terrain horizon)"
            print(f"[panorama] {p['id']}: EXCLUDED, {err}")
            continue
        p.pop("excluded", None)
        height = rgb.shape[1]
        k = f["verticalScale"] * DEG_PX  # degrees of elevation per working row
        top = f["horizonRow"] * k
        geometry = {
            "method": "skyline matched to the terrain horizon (scripts/geospatial/copernico_geo/panorama.py)",
            "azimuthAtLeftDeg": f["azimuthAtLeftDeg"],
            "direction": f["direction"],
            "horizonFraction": round(f["horizonRow"] / height, 4),
            "elevationDeg": {"top": round(top, 2), "bottom": round(top - height * k, 2)},
            "spanDeg": f["spanDeg"],
            "verticalScale": f["verticalScale"],
            "tiltDeg": f["tiltDeg"],
            "tiltTowardAzimuthDeg": f["tiltTowardAzimuthDeg"],
            "medianResidualDeg": f["medianResidualDeg"],
            "inlierFraction": f["inlierFraction"],
            "columnsUsed": f["columnsUsed"],
            "groundM": round(ground, 1),
            "medianHorizonDistanceKm": round(float(np.median(dist[f["_index"]])) / 1000, 1),
        }
        p["geometry"] = geometry
        diagnostic(rgb, rows, horizon, f, str(diag_dir / f"{p['id']}_skyline.png"))
        webp = OUT / p["file"].split("/")[-1]
        gdal.Translate(str(webp), str(src), format="WEBP", width=VIEWER_PX, height=0,
                       resampleAlg="average", creationOptions=["QUALITY=86"])
        webp.with_suffix(".webp.aux.xml").unlink(missing_ok=True)
        print(f"[panorama] {p['id']}: az0 {geometry['azimuthAtLeftDeg']}° dir {geometry['direction']:+d}, "
              f"span {f['spanDeg']:.2f}°, vscale {f['verticalScale']}, "
              f"horizon {geometry['horizonFraction']:.3f}, tilt {geometry['tiltDeg']}°, "
              f"residual {geometry['medianResidualDeg']}° ({geometry['inlierFraction']:.0%} inliers)")
        results.append(p)
    CATALOG.write_text(json.dumps(catalog, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return results
