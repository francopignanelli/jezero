"""Imagery tile pyramids (WebP, 256 px, Cesium GeographicTilingScheme on IAU_2015:49900).

Pyramids (data/build/tiles/imagery/<id>/{z}/{x}/{y}.webp):
  viking    global       z0–5   Viking colorized mosaic (925 m)
  viking-hd regional     z6–8   Viking MDIM 2.1 colorized (232 m) window around Jezero
  hirise-rover rim       z13–18 HiRISE ESP_085859_1985 (25 cm, 2024-11-19) around Perseverance
  hirise-west  rim       z12–16 the same RDR west of the TRN window (0.5 m), tone-matched to it
  ctx      crater       z6–13  JPL CTX orthomosaic (5 m)
  hirise   operational  z12–16 USGS TRN HiRISE orthomosaic (read at 0.5 m)
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from osgeo import gdal

from . import fetch
from .frames import JEZERO_AOI, BBox, geographic_srs
from .paths import BUILD, WORK, dataset, ensure
from .provenance import read_record
from .tiling import TILE_PX, WORLD, Tile, pixel_deg, tiles_covering

gdal.UseExceptions()
OUT = BUILD / "tiles" / "imagery"
CRATER = BBox(west=77.0, south=17.6, east=78.58, north=19.28)
# Regional window for the sharp colour descent from orbit (Isidis rim, Nili Fossae, Syrtis edge).
VIKING_HD = BBox(west=70.0, south=12.0, east=85.0, north=25.0)


def geographic_mosaic(src: Path, name: str, box: BBox, zmax: int, resample: str, src_nodata=None) -> Path:
    """Warps a source to IAU_2015:49900 at the zmax pixel size, with an alpha band, plus overviews."""
    dst = ensure(WORK / "mosaics") / f"{name}_z{zmax}.tif"
    if dst.exists():
        return dst
    res = pixel_deg(zmax)
    print(f"[imagery] mosaic {name}: {src.name} → {res:.3e}°/px")
    gdal.Warp(
        str(dst),
        str(src),
        dstSRS=geographic_srs().ExportToWkt(),
        outputBounds=(box.west, box.south, box.east, box.north),
        xRes=res,
        yRes=res,
        resampleAlg=resample,
        srcNodata=src_nodata,
        dstAlpha=True,
        multithread=True,
        warpOptions=["NUM_THREADS=ALL_CPUS"],
        creationOptions=["TILED=YES", "COMPRESS=DEFLATE", "BIGTIFF=IF_SAFER"],
        callback=gdal.TermProgress_nocb,
    )
    ds = gdal.Open(str(dst), gdal.GA_Update)
    ds.BuildOverviews("AVERAGE", [2, 4, 8, 16, 32, 64, 128])
    ds = None
    return dst


def edge_feather(tile: Tile, box: BBox, feather_deg: float) -> np.ndarray:
    """0–1 weight per tile pixel: ramps linearly to 0 over `feather_deg` at the box edges, so a
    greyscale tier fades into the colour globe instead of ending in a hard rectangle."""
    b = tile.bounds
    step = (b.east - b.west) / TILE_PX
    lon = b.west + (np.arange(TILE_PX) + 0.5) * step
    lat = b.north - (np.arange(TILE_PX) + 0.5) * step
    wx = np.clip(np.minimum(lon - box.west, box.east - lon) / feather_deg, 0, 1)
    wy = np.clip(np.minimum(lat - box.south, box.north - lat) / feather_deg, 0, 1)
    w = np.outer(wy, wx)
    return w * w * (3 - 2 * w)  # smoothstep


def write_tile(mosaic: gdal.Dataset, tile: Tile, out_dir: Path, box: BBox | None = None, feather_deg: float = 0.0) -> bool:
    b = tile.bounds
    mem = gdal.Translate(
        "",
        mosaic,
        format="MEM",
        projWin=[b.west, b.north, b.east, b.south],
        width=TILE_PX,
        height=TILE_PX,
        resampleAlg="average",
    )
    arr = mem.ReadAsArray()
    alpha = arr[-1]
    if not alpha.any():
        return False
    if box is not None and feather_deg > 0:
        alpha = (alpha * edge_feather(tile, box, feather_deg)).astype(np.uint8)
        if not alpha.any():
            return False
    colour = arr[:-1]
    rgb = np.repeat(colour, 3, axis=0) if colour.shape[0] == 1 else colour[:3]
    rgba = np.concatenate([rgb, alpha[None]], axis=0).astype(np.uint8)
    drv = gdal.GetDriverByName("MEM").Create("", TILE_PX, TILE_PX, 4, gdal.GDT_Byte)
    for i in range(4):
        drv.GetRasterBand(i + 1).WriteArray(rgba[i])
    path = out_dir / str(tile.z) / str(tile.x) / f"{tile.y}.webp"
    path.parent.mkdir(parents=True, exist_ok=True)
    gdal.GetDriverByName("WEBP").CreateCopy(str(path), drv, options=["QUALITY=82"])
    path.with_suffix(".webp.aux.xml").unlink(missing_ok=True)
    return True


def pyramid(layer_id: str, mosaic_path: Path, box: BBox, zmin: int, zmax: int, meta: dict, feather_deg: float = 0.0) -> dict:
    out_dir = ensure(OUT / layer_id)
    mosaic = gdal.Open(str(mosaic_path))
    written = 0
    for z in range(zmin, zmax + 1):
        tiles = tiles_covering(z, box)
        for tile in tiles:
            written += write_tile(mosaic, tile, out_dir, box, feather_deg)
        print(f"[imagery] {layer_id} z{z}: {len(tiles)} candidate tiles")
    layer = {
        "id": layer_id,
        "format": "webp",
        "tileSize": TILE_PX,
        "tilingScheme": "geographic-2x1 (Cesium GeographicTilingScheme), y from north",
        "crs": "IAU_2015:49900",
        "rectangle": box.__dict__,
        "minLevel": zmin,
        "maxLevel": zmax,
        "tiles": written,
        "featherDeg": feather_deg,
        **meta,
    }
    (out_dir / "layer.json").write_text(json.dumps(layer, indent=2), encoding="utf-8")
    return layer


def build_viking_hd() -> dict:
    """232 m colour over the Jezero region. The 12.7 GB source is stripped and uncompressed; its
    window is fetched with plain HTTP row ranges by scripts/data/fetch-tiff-window.ts (GDAL /vsicurl/
    reads dropped connections from inside Docker) and tiled here from the resulting VRT."""
    from .paths import RAW

    src = RAW / "viking-mdim21-232" / "viking_hd_window.vrt"
    if not src.exists():
        raise FileNotFoundError("run: npx tsx scripts/data/fetch-tiff-window.ts")
    from .relief import shade_mosaic

    mosaic = shade_mosaic(geographic_mosaic(src, "viking-hd", VIKING_HD, 8, "average", 0), "viking-hd", 2.0, False)
    return pyramid("viking-hd", mosaic, VIKING_HD, 6, 8,
                   {"datasetId": "viking-mdim21-232", "source": read_record(src), "relief": RELIEF_NOTE})


RELIEF_NOTE = ("MOLA shaded relief multiplied in (copernico_geo/relief.py): light from the NW at 35°, "
               "vertical exaggeration ×4 (925 m globe) / ×2 (232 m), strength 0.65. Display only.")


def build_viking_globe() -> dict:
    """925 m Viking colour globe with MOLA shaded relief."""
    from .relief import shade_mosaic

    viking = fetch.download("viking-color-925")
    mosaic = shade_mosaic(geographic_mosaic(viking, "viking", WORLD, 5, "average"), "viking", 4.0, True)
    # Whole-planet map for the loading screen's rotating Mars (equirectangular, 2048×1024).
    globe = ensure(BUILD / "sky") / "mars_globe_2k.webp"
    gdal.Translate(str(globe), str(mosaic), format="WEBP", bandList=[1, 2, 3], width=2048, height=1024,
                   resampleAlg="average", creationOptions=["QUALITY=82"])
    globe.with_suffix(".webp.aux.xml").unlink(missing_ok=True)
    return pyramid("viking", mosaic, WORLD, 0, 5,
                   {"datasetId": "viking-color-925", "source": read_record(viking), "relief": RELIEF_NOTE})


# Perseverance's latest published position (MMGIS, sol 1980) and the HiRISE observation covering it.
ROVER = (18.436874, 77.232054)
# Covers the latest position (sol 1980) and the sol 1710–1756 stop of the "Crocodile Bridge" panorama.
ROVER_BOX = BBox(west=77.2257, south=18.4225, east=77.2420, north=18.4427)
# HiRISE RDR JP2 headers are misread by GDAL (CENTER_LATITUDE becomes the natural origin). The PDS
# label defines Equirectangular with true scale at 15°, centre longitude 180°, local radius below.
HIRISE_RDR_SRS = "+proj=eqc +lat_ts=15 +lat_0=0 +lon_0=180 +x_0=0 +y_0=0 +R=3394839.8133 +units=m +no_defs"


RDR_JP2 = "ESP_085859_1985_RED.JP2"
# The part of ESP_085859_1985 west of the TRN mosaic window (the crater rim: Witch Hazel Hill, the
# "Crocodile Bridge" stop, Perseverance), overlapping the TRN window by ~0.017° for the blend.
WEST_BOX = BBox(west=77.2048, south=18.40, east=77.29, north=18.4967)
# Where the RDR and the local TRN window both have data: the tone match is measured here.
TONE_BOX = BBox(west=77.2740, south=18.40, east=77.3130, north=18.4960)


def _rdr_path():
    from .paths import RAW

    jp2 = RAW / "hirise-rover" / RDR_JP2
    if not jp2.exists():
        raise FileNotFoundError(f"download {RDR_JP2} into data/raw/hirise-rover (see README)")
    return jp2


def _rdr_window(box: BBox, margin_m: float) -> list[float]:
    """projWin (ulx, uly, lrx, lry) in the RDR's own projection (see HIRISE_RDR_SRS)."""
    import math

    r = 3394839.8133
    k = math.cos(math.radians(15))
    x = lambda lon: r * k * math.radians(lon - 180)  # noqa: E731
    y = lambda lat: r * math.radians(lat)  # noqa: E731
    return [x(box.west) - margin_m, y(box.north) + margin_m, x(box.east) + margin_m, y(box.south) - margin_m]


def rdr_tone_lut() -> np.ndarray:
    """Maps the RDR's raw values to the TRN mosaic's 8-bit tones (quantile matching on TONE_BOX),
    so the rim imagery continues the TRN mosaic instead of reading as a different picture."""
    from .paths import RAW

    cached = ensure(WORK / "mosaics") / "hirise_rdr_tone_lut.npy"
    if cached.exists():
        return np.load(cached)
    trn = next((RAW / "hirise-ortho-trn").glob("*.tif"))
    res = pixel_deg(14)  # ~2.3 m: a common grid; the match uses value distributions, not pixels
    common = dict(format="MEM", dstSRS=geographic_srs().ExportToWkt(), xRes=res, yRes=res,
                  outputBounds=(TONE_BOX.west, TONE_BOX.south, TONE_BOX.east, TONE_BOX.north),
                  resampleAlg="average", srcNodata=0, dstNodata=0)
    a = gdal.Warp("", str(_rdr_path()), srcSRS=HIRISE_RDR_SRS, **common).ReadAsArray().astype(np.float64)
    b = gdal.Warp("", str(trn), **common).ReadAsArray().astype(np.float64)
    valid = (a > 0) & (b > 0)
    q = np.linspace(0.5, 99.5, 199)
    src_q = np.percentile(a[valid], q)
    dst_q = np.percentile(b[valid], q)
    top = int(np.ceil(src_q[-1] * 1.5)) + 2
    lut = np.clip(np.interp(np.arange(top), src_q, dst_q), 1, 255).astype(np.uint8)
    lut[0] = 0  # nodata stays nodata
    np.save(cached, lut)
    print(f"[imagery] RDR tone match on {int(valid.sum())} px: RDR {src_q[0]:.0f}–{src_q[-1]:.0f} "
          f"→ TRN {dst_q[0]:.0f}–{dst_q[-1]:.0f}")
    return lut


def toned_rdr_crop(name: str, box: BBox, res_m: float | None) -> Path:
    """Crop of the RDR (label projection) at `res_m` (None: native 25 cm), tone-matched to the TRN
    mosaic, as 8-bit GeoTIFF with nodata 0. Written in row blocks (the west crop is ~110 MP)."""
    crop = ensure(WORK / "mosaics") / f"{name}.tif"
    if crop.exists():
        return crop
    lut = rdr_tone_lut()
    opts = dict(format="GTiff", projWin=_rdr_window(box, 60), outputSRS=HIRISE_RDR_SRS,
                creationOptions=["TILED=YES", "COMPRESS=DEFLATE", "BIGTIFF=IF_SAFER"])
    if res_m:
        opts.update(xRes=res_m, yRes=res_m, resampleAlg="average")
    raw = WORK / "mosaics" / f"{name}_raw.tif"
    src = gdal.Translate(str(raw), str(_rdr_path()), **opts)
    w, h = src.RasterXSize, src.RasterYSize
    out = gdal.GetDriverByName("GTiff").Create(str(crop), w, h, 1, gdal.GDT_Byte,
                                               options=["TILED=YES", "COMPRESS=DEFLATE", "BIGTIFF=IF_SAFER"])
    out.SetGeoTransform(src.GetGeoTransform())
    out.SetProjection(src.GetProjection())
    band = src.GetRasterBand(1)
    for y0 in range(0, h, 1024):
        rows = min(1024, h - y0)
        block = band.ReadAsArray(0, y0, w, rows)
        out.GetRasterBand(1).WriteArray(lut[np.clip(block, 0, len(lut) - 1)], 0, y0)
    out.GetRasterBand(1).SetNoDataValue(0)
    out = src = None
    raw.unlink(missing_ok=True)
    print(f"[imagery] {name}: {w}×{h} px, toned to the TRN mosaic")
    return crop


def build_hirise_rover() -> dict:
    """25 cm HiRISE around Perseverance's current position on the crater rim (outside the TRN
    mosaic): the RDR cropped with the label's projection, tone-matched to the TRN mosaic, tiled to
    z18 with feathered edges."""
    crop = toned_rdr_crop("hirise_rover_toned", ROVER_BOX, None)
    return pyramid("hirise-rover", geographic_mosaic(crop, "hirise-rover-toned", ROVER_BOX, 18, "average", 0),
                   ROVER_BOX, 13, 18, {"datasetId": "hirise-rdr-rover", "observation": "ESP_085859_1985",
                                       "acquired": "2024-11-19T11:28:57Z", "tone": "matched to hirise-ortho-trn"},
                   feather_deg=0.0018)


def build_hirise_west() -> dict:
    """The crater rim west of the TRN window (Witch Hazel Hill, Crocodile Bridge, the flights between
    the panoramas there) from the same RDR, read at 0.5 m like the TRN layer and tone-matched to it,
    so the whole tour is seen on one consistent HiRISE picture instead of falling back to 5 m CTX."""
    crop = toned_rdr_crop("hirise_west_toned", WEST_BOX, 0.5)
    return pyramid("hirise-west", geographic_mosaic(crop, "hirise-west", WEST_BOX, 16, "average", 0),
                   WEST_BOX, 12, 16, {"datasetId": "hirise-rdr-rover", "observation": "ESP_085859_1985",
                                      "acquired": "2024-11-19T11:28:57Z", "tone": "matched to hirise-ortho-trn"},
                   feather_deg=0.004)


def build() -> list[dict]:
    layers = []
    layers.append(build_viking_globe())
    ctx = fetch.download("ctx-ortho-jpl")
    layers.append(
        pyramid("ctx", geographic_mosaic(ctx, "ctx", CRATER, 13, "average", 0), CRATER, 6, 13,
                {"datasetId": "ctx-ortho-jpl", "source": read_record(ctx)}, feather_deg=0.12)
    )
    hirise = fetch.window("hirise-ortho-trn", res_m=0.5)
    layers.append(
        pyramid("hirise", geographic_mosaic(hirise, "hirise", JEZERO_AOI, 16, "average", 0), JEZERO_AOI, 12, 16,
                {"datasetId": "hirise-ortho-trn", "source": read_record(hirise)}, feather_deg=0.008)
    )
    for layer in layers:
        entry = dataset(layer["datasetId"])
        print(f"[imagery] {layer['id']}: {layer['tiles']} tiles from {entry['productId']}")
    return layers
