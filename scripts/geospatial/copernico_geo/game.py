"""Assets for the rover game (apps/web/src/game): per-mission terrain, orbital albedo and real
ground textures. Output: data/build/game/ (areas.json plus the files it lists).

Per mission area, on a local metric grid (x east, y north, metres from the area centre):
  detail  the USGS TRN 1 m DTM and the TRN HiRISE orthomosaic (≤ 0.75 m), where the rover drives
  mid     12 km around it at 8 m (TRN DTM over the CTX DEM; CTX orthomosaic): the nearby plains
  far     64 km at 100 m (CTX DEM over MOLA; CTX orthomosaic): the crater rim on the horizon

Ground textures: Mastcam-Z panoramas re-projected onto the ground plane around the rover (real
Jezero regolith, gravel, sand ripples and bedrock at ~3 mm per pixel), made tileable.

Heights are uint16 steps above the layer's lowest point, each row delta-coded (first value, then
differences modulo 2^16) and gzip-compressed: smooth terrain compresses about twice as well.
"""
from __future__ import annotations

import gzip
import json
import math
from dataclasses import dataclass

import numpy as np
from osgeo import gdal

from .paths import BUILD, RAW, ROOT

gdal.UseExceptions()

OUT = BUILD / "game"
R_MARS = 3396190.0
NODATA = -32768.0


@dataclass(frozen=True)
class Area:
    id: str
    lat: float
    lon: float
    width_m: int
    height_m: int


# Mission areas (centre, size): every target, the start and a margin of drivable ground.
AREAS = [
    Area("floor", 18.4362, 77.4469, 1700, 1700),
    Area("delta", 18.4537, 77.4063, 1500, 1300),
    Area("margin", 18.4795, 77.3680, 2900, 1700),
]
MID_M, MID_RES = 12_000, 8.0
FAR_M, FAR_RES = 64_000, 100.0
MAX_TEXTURE = 4096


def local_srs(a: Area) -> str:
    """Equirectangular with true scale at the area centre: x east, y north, metres from the centre."""
    return (
        f"+proj=eqc +lat_ts={a.lat} +lat_0={a.lat} +lon_0={a.lon} +x_0=0 +y_0=0 "
        f"+R={R_MARS} +units=m +no_defs"
    )


def _warp(src: str, a: Area, w_m: float, h_m: float, res: float, alg: str, float_out=True) -> np.ndarray:
    ds = gdal.Warp(
        "",
        src,
        format="MEM",
        dstSRS=local_srs(a),
        outputBounds=(-w_m / 2, -h_m / 2, w_m / 2, h_m / 2),
        xRes=res,
        yRes=res,
        resampleAlg=alg,
        outputType=gdal.GDT_Float32 if float_out else gdal.GDT_Byte,
        dstNodata=NODATA if float_out else 0,
    )
    return ds.GetRasterBand(1).ReadAsArray().astype(np.float64)


def _src(folder: str, pattern: str = "*.tif") -> str:
    return str(next((RAW / folder).glob(pattern)))


def _blur(m: np.ndarray, r: int) -> np.ndarray:
    """Box blur (separable, edge-clamped), for feathering masks."""
    k = 2 * r + 1
    out = m
    for axis in (0, 1):
        p = np.pad(out, [(r, r) if i == axis else (0, 0) for i in range(2)], mode="edge")
        c = np.cumsum(p, axis=axis)
        c = np.insert(c, 0, 0, axis=axis)
        out = (np.take(c, range(k, c.shape[axis]), axis=axis) - np.take(c, range(0, c.shape[axis] - k), axis=axis)) / k
    return out


def _fill(z: np.ndarray) -> np.ndarray:
    """Fills nodata by repeated neighbour averaging (small edge gaps only)."""
    bad = ~(z > -30000)
    if not bad.any():
        return z
    z = np.where(bad, np.nan, z)
    for _ in range(64):
        if not np.isnan(z).any():
            break
        p = np.pad(z, 1, mode="edge")
        nb = np.stack([p[:-2, 1:-1], p[2:, 1:-1], p[1:-1, :-2], p[1:-1, 2:]])
        mean = np.nanmean(np.where(np.isnan(nb), np.nan, nb), axis=0)
        z = np.where(np.isnan(z), mean, z)
    return np.nan_to_num(z, nan=float(np.nanmedian(z)))


def _over(base: np.ndarray, top: np.ndarray, feather_px: int) -> np.ndarray:
    """`top` where it has data, feathered into `base` over `feather_px` from its edge."""
    valid = (top > -30000).astype(np.float64)
    w = np.clip(_blur(valid, feather_px) * 2 - 1, 0, 1) * valid
    return np.where(valid > 0, top, base) * w + base * (1 - w)


def _write_heights(name: str, z: np.ndarray, step: float, cell: float, extent: tuple[float, float]) -> dict:
    base = float(np.floor(z.min()))
    q = np.round((z - base) / step).astype(np.int64)
    if q.max() > 65535:
        raise ValueError(f"{name}: height range {z.max() - base:.0f} m exceeds {65535 * step:.0f} m")
    q = q.astype(np.uint16)
    coded = q.copy()
    coded[:, 1:] = q[:, 1:] - q[:, :-1]  # uint16 arithmetic wraps: decoded by a running sum mod 2^16
    (OUT / f"{name}.bin.gz").write_bytes(gzip.compress(coded.astype("<u2").tobytes(), 9))
    return {
        "file": f"game/{name}.bin.gz",
        "cols": int(q.shape[1]),
        "rows": int(q.shape[0]),
        "cellM": cell,
        "widthM": extent[0],
        "heightM": extent[1],
        "baseM": base,
        "stepM": step,
        "rangeM": round(float(z.max() - base), 2),
    }


def _write_grey(name: str, img: np.ndarray, quality: int = 88) -> dict:
    good = img > 0
    lo, hi = np.percentile(img[good], [0.5, 99.5]) if good.any() else (0, 255)
    g = np.clip((img - lo) / max(hi - lo, 1e-6), 0, 1)
    g[~good] = 0.5
    out = np.round(g * 255).astype(np.uint8)
    mem = gdal.GetDriverByName("MEM").Create("", out.shape[1], out.shape[0], 3, gdal.GDT_Byte)
    for b in range(3):
        mem.GetRasterBand(b + 1).WriteArray(out)
    path = OUT / f"{name}.webp"
    gdal.GetDriverByName("WEBP").CreateCopy(str(path), mem, options=[f"QUALITY={quality}"])
    path.with_suffix(".webp.aux.xml").unlink(missing_ok=True)
    return {"file": f"game/{name}.webp", "cols": int(out.shape[1]), "rows": int(out.shape[0])}


def build_area(a: Area) -> dict:
    trn_dtm = _src("hirise-dtm-trn")
    ctx_dem = _src("ctx-dem-jpl")
    ctx_ortho = _src("ctx-ortho-jpl")
    trn_ortho = _src("hirise-ortho-trn")
    mola = str(next((RAW / "mola-megdr-32").glob("*.lbl")))

    # Detail: 1 m DTM, HiRISE at ≤ 0.75 m (within the GPU texture limit).
    z = _fill(_warp(trn_dtm, a, a.width_m, a.height_m, 1.0, "cubic"))
    detail = _write_heights(f"{a.id}_detail", z, 0.01, 1.0, (a.width_m, a.height_m))
    res = max(0.5, math.ceil(max(a.width_m, a.height_m) / MAX_TEXTURE * 4) / 4)
    albedo = _write_grey(f"{a.id}_detail_albedo", _warp(trn_ortho, a, a.width_m, a.height_m, res, "average"))
    albedo["cellM"] = res

    # Mid: TRN DTM (block-averaged) over the CTX DEM, feathered over 400 m.
    ctx = _fill(_warp(ctx_dem, a, MID_M, MID_M, MID_RES, "average"))
    trn = _warp(trn_dtm, a, MID_M, MID_M, MID_RES, "average")
    zm = _over(ctx, trn, int(400 / MID_RES))
    mid = _write_heights(f"{a.id}_mid", zm, 0.05, MID_RES, (MID_M, MID_M))
    mid_albedo = _write_grey(f"{a.id}_mid_albedo", _warp(ctx_ortho, a, MID_M, MID_M, MID_RES, "average"))

    # Far: CTX DEM over MOLA (the crater rim and beyond), feathered over 3 km.
    base = _fill(_warp(mola, a, FAR_M, FAR_M, FAR_RES, "cubic"))
    zf = _over(base, _warp(ctx_dem, a, FAR_M, FAR_M, FAR_RES, "average"), int(3000 / FAR_RES))
    far = _write_heights(f"{a.id}_far", zf, 0.25, FAR_RES, (FAR_M, FAR_M))
    far_albedo = _write_grey(f"{a.id}_far_albedo", _warp(ctx_ortho, a, FAR_M, FAR_M, FAR_RES, "average"), 80)

    print(
        f"[game] {a.id}: detail {detail['cols']}×{detail['rows']} (range {detail['rangeM']} m), "
        f"albedo {albedo['cols']}×{albedo['rows']} @ {res} m, mid range {mid['rangeM']} m, far range {far['rangeM']} m"
    )
    return {
        "id": a.id,
        "lat": a.lat,
        "lon": a.lon,
        "srs": local_srs(a),
        "detail": {"heights": detail, "albedo": albedo},
        "mid": {"heights": mid, "albedo": mid_albedo},
        "far": {"heights": far, "albedo": far_albedo},
    }


# ---------- real ground textures from the panoramas ----------


def _pano(pid: str) -> tuple[np.ndarray, dict]:
    cat = json.loads((ROOT / "data/catalog/panoramas.json").read_text(encoding="utf-8"))
    p = next(x for x in cat["panoramas"] if x["id"] == pid)
    ds = gdal.Open(str(BUILD / "panoramas" / f"{pid}_8k.webp"))
    rgb = np.stack([ds.GetRasterBand(b + 1).ReadAsArray() for b in range(3)], axis=-1).astype(np.float32)
    return rgb, p["geometry"]


def ground_patch(pid: str, centre_m: tuple[float, float], size_m: float, px: int, camera_m: float = 2.0) -> np.ndarray:
    """Orthographic view (north up) of the ground around a panorama's camera, assumed flat: a
    `size_m` square centred `centre_m` (east, north) from the rover, `px` pixels across. Uses the
    panorama's measured geometry (azimuth, horizon, vertical scale, mast tilt)."""
    rgb, g = _pano(pid)
    h, w, _ = rgb.shape
    half = size_m / 2
    xs = np.linspace(centre_m[0] - half, centre_m[0] + half, px)
    ys = np.linspace(centre_m[1] + half, centre_m[1] - half, px)
    east, north = np.meshgrid(xs, ys)
    dist = np.hypot(east, north)
    az = np.degrees(np.arctan2(east, north)) % 360
    el = -np.degrees(np.arctan2(camera_m, dist))
    el = el + g["tiltDeg"] * np.cos(np.radians(az - g["tiltTowardAzimuthDeg"]))
    u = (((az - g["azimuthAtLeftDeg"]) * g["direction"]) % 360) / g["spanDeg"] * w
    top, bottom = g["elevationDeg"]["top"], g["elevationDeg"]["bottom"]
    v = (top - el) / (top - bottom) * h
    u0 = np.floor(u).astype(int)
    v0 = np.clip(np.floor(v).astype(int), 0, h - 2)
    fu = (u - np.floor(u))[..., None]
    fv = np.clip(v - v0, 0, 1)[..., None]
    u0 %= w
    u1 = (u0 + 1) % w
    return (
        rgb[v0, u0] * (1 - fu) * (1 - fv)
        + rgb[v0, u1] * fu * (1 - fv)
        + rgb[v0 + 1, u0] * (1 - fu) * fv
        + rgb[v0 + 1, u1] * fu * fv
    )


def flatten_light(rgb: np.ndarray, radius_px: int) -> np.ndarray:
    """Removes large-scale brightness changes (photo vignetting, distant shading) and keeps the
    detail: each pixel is scaled by mean / local mean (luminance)."""
    lum = rgb.mean(axis=-1)
    local = _blur(lum, radius_px)
    return np.clip(rgb * (lum.mean() / np.maximum(local, 1))[..., None], 0, 255)


def make_tileable(rgb: np.ndarray) -> np.ndarray:
    """Seamless tile: blends the image with a half-period shifted copy under a window that is 1 in
    the centre and 0 at the edges, keeping contrast (variance-preserving blend around the mean)."""
    n = rgb.shape[0]
    shifted = np.roll(rgb, (n // 2, n // 2), axis=(0, 1))
    t = (np.arange(n) + 0.5) / n
    win = np.sin(np.pi * t) ** 2
    w = np.sqrt(np.outer(win, win))[..., None]
    mu = rgb.reshape(-1, 3).mean(axis=0)
    a, b = rgb - mu, shifted - mu
    mixed = (a * w + b * (1 - w)) / np.sqrt(w**2 + (1 - w) ** 2)
    return np.clip(mixed + mu, 0, 255)


# (texture id, panorama, centre east/north from the rover (m), size (m)). Chosen by eye on the
# re-projected panoramas: away from the rover, its shadow and the unimaged (filled) deck.
GROUND = [
    ("regolith", "butler-landing", (0.8, -3.6), 3.0),
    ("gravel", "wildcat-ridge", (2.6, -4.0), 2.8),
    ("sand", "wildcat-ridge", (-3.8, -2.6), 2.4),
    ("bedrock", "wildcat-ridge", (-3.6, 3.4), 3.0),
]
TEXTURE_PX = 1024


def build_ground() -> list[dict]:
    out = []
    for tid, pid, centre, size in GROUND:
        img = ground_patch(pid, centre, size, TEXTURE_PX)
        # Flatten brightness over ~10 cm: keeps pebbles and grains, drops the larger light and
        # dark patches that would repeat visibly at the tile period.
        img = make_tileable(flatten_light(img, TEXTURE_PX // 30))
        a = np.round(img).astype(np.uint8)
        mem = gdal.GetDriverByName("MEM").Create("", TEXTURE_PX, TEXTURE_PX, 3, gdal.GDT_Byte)
        for b in range(3):
            mem.GetRasterBand(b + 1).WriteArray(a[..., b])
        path = OUT / f"ground_{tid}.webp"
        gdal.GetDriverByName("WEBP").CreateCopy(str(path), mem, options=["QUALITY=90"])
        path.with_suffix(".webp.aux.xml").unlink(missing_ok=True)
        mean = [round(float(c) / 255, 4) for c in img.reshape(-1, 3).mean(axis=0)]
        out.append({"id": tid, "file": f"game/ground_{tid}.webp", "sizeM": size, "panorama": pid, "meanRgb": mean})
        print(f"[game] ground {tid}: {pid} {centre} {size} m → {path.stat().st_size // 1024} KB")
    return out


def build(only: str | None = None) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    manifest_path = OUT / "areas.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {"areas": []}
    manifest.update(
        {
            "description": "Rover game world: local grids (x east, y north, metres from each area centre)",
            "sources": {
                "detail": "USGS Mars 2020 TRN HiRISE 1 m DTM and orthomosaic",
                "mid": "TRN DTM over the JPL CTX 20 m DEM; CTX 5 m orthomosaic",
                "far": "CTX DEM over MOLA MEGDR; CTX orthomosaic",
                "ground": "NASA/JPL-Caltech/ASU/MSSS Mastcam-Z panoramas re-projected onto the ground",
            },
        }
    )
    if only in (None, "ground"):
        manifest["ground"] = build_ground()
    areas = {x["id"]: x for x in manifest.get("areas", [])}
    for a in AREAS:
        if only in (None, a.id):
            areas[a.id] = build_area(a)
    manifest["areas"] = [areas[a.id] for a in AREAS if a.id in areas]
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
