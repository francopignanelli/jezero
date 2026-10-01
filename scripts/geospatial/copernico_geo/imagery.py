"""Imagery tile pyramids (WebP, 256 px, Cesium GeographicTilingScheme on IAU_2015:49900).

Pyramids (data/build/tiles/imagery/<id>/{z}/{x}/{y}.webp):
  viking   global       z0–5   Viking colorized mosaic (925 m)
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


def write_tile(mosaic: gdal.Dataset, tile: Tile, out_dir: Path) -> bool:
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


def pyramid(layer_id: str, mosaic_path: Path, box: BBox, zmin: int, zmax: int, meta: dict) -> dict:
    out_dir = ensure(OUT / layer_id)
    mosaic = gdal.Open(str(mosaic_path))
    written = 0
    for z in range(zmin, zmax + 1):
        tiles = tiles_covering(z, box)
        for tile in tiles:
            written += write_tile(mosaic, tile, out_dir)
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
        **meta,
    }
    (out_dir / "layer.json").write_text(json.dumps(layer, indent=2), encoding="utf-8")
    return layer


def build() -> list[dict]:
    layers = []
    viking = fetch.download("viking-color-925")
    layers.append(
        pyramid("viking", geographic_mosaic(viking, "viking", WORLD, 5, "average"), WORLD, 0, 5,
                {"datasetId": "viking-color-925", "source": read_record(viking)})
    )
    ctx = fetch.download("ctx-ortho-jpl")
    layers.append(
        pyramid("ctx", geographic_mosaic(ctx, "ctx", CRATER, 13, "average", 0), CRATER, 6, 13,
                {"datasetId": "ctx-ortho-jpl", "source": read_record(ctx)})
    )
    hirise = fetch.window("hirise-ortho-trn", res_m=0.5)
    layers.append(
        pyramid("hirise", geographic_mosaic(hirise, "hirise", JEZERO_AOI, 16, "average", 0), JEZERO_AOI, 12, 16,
                {"datasetId": "hirise-ortho-trn", "source": read_record(hirise)})
    )
    for layer in layers:
        entry = dataset(layer["datasetId"])
        print(f"[imagery] {layer['id']}: {layer['tiles']} tiles from {entry['productId']}")
    return layers
