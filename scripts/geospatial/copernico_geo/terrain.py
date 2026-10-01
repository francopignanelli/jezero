"""Quantized-mesh-1.0 terrain tiles on the Mars sphere (R = 3 396 190 m), heights above the areoid.

Heights are for rendering only (meshes are simplified to a per-level max error); all scientific
metrics read the routing grid instead. Levels: global MOLA z0–5, crater CTX z6–12, Jezero HiRISE
z13–16. Output: data/build/tiles/terrain/{layer.json,{z}/{x}/{tmsY}.terrain} (uncompressed).
"""
from __future__ import annotations

import json

import numpy as np
from osgeo import gdal
from pydelatin import Delatin
from quantized_mesh_encoder import encode
from quantized_mesh_encoder.ellipsoid import Ellipsoid
from quantized_mesh_encoder.extensions import VertexNormalsExtension

from . import fetch
from .frames import JEZERO_AOI, MARS_R, BBox, geographic_srs
from .imagery import CRATER
from .paths import BUILD, WORK, ensure
from .tiling import WORLD, Tile, tiles_covering

gdal.UseExceptions()
OUT = BUILD / "tiles" / "terrain"
MARS_SPHERE = Ellipsoid(MARS_R, MARS_R)

# (zmin, zmax, region, grid samples per side, max mesh error in m)
LEVELS = [
    (0, 5, WORLD, 65, 150.0),
    (6, 9, CRATER, 65, 25.0),
    (10, 12, CRATER, 65, 5.0),
    (13, 14, JEZERO_AOI, 129, 1.0),
    (15, 16, JEZERO_AOI, 129, 0.5),
]


def height_source(src, name: str, box: BBox, res_deg: float, src_nodata=None) -> gdal.Dataset:
    dst = ensure(WORK / "mosaics") / f"height_{name}.tif"
    if not dst.exists():
        print(f"[terrain] height mosaic {name} at {res_deg:.2e}°")
        gdal.Warp(
            str(dst),
            str(src),
            dstSRS=geographic_srs().ExportToWkt(),
            outputBounds=(box.west, box.south, box.east, box.north),
            xRes=res_deg,
            yRes=res_deg,
            resampleAlg="bilinear",
            srcNodata=src_nodata,
            dstNodata=float("nan"),
            outputType=gdal.GDT_Float32,
            multithread=True,
            creationOptions=["TILED=YES", "COMPRESS=DEFLATE", "PREDICTOR=3", "BIGTIFF=IF_SAFER"],
        )
        ds = gdal.Open(str(dst), gdal.GA_Update)
        ds.BuildOverviews("AVERAGE", [2, 4, 8, 16, 32])
        ds = None  # flush and close before reopening read-only
    return gdal.Open(str(dst))


def sample(ds: gdal.Dataset, b: BBox, n: int) -> np.ndarray:
    """n×n samples whose outer samples lie exactly on the tile edges (shared with neighbours)."""
    half = (b.east - b.west) / (n - 1) / 2
    mem = gdal.Warp(
        "",
        ds,
        format="MEM",
        outputBounds=(b.west - half, b.south - half, b.east + half, b.north + half),
        width=n,
        height=n,
        resampleAlg="bilinear",
        dstNodata=float("nan"),
    )
    return mem.ReadAsArray().astype(np.float64)


def mesh_tile(heights: np.ndarray, b: BBox, max_error: float) -> tuple[np.ndarray, np.ndarray]:
    """TIN for a tile as (lon, lat, height) positions and counter-clockwise triangle indices."""
    n = heights.shape[0]
    tin = Delatin(heights.astype(np.float32), max_error=max_error)
    # pydelatin vertices are (x, y, height) with x = column and y counted from the BOTTOM row
    # (verified: tests/test_terrain.py). Our array's row 0 is north, so y grows northwards.
    vertices = tin.vertices.astype(np.float64)
    lon = b.west + vertices[:, 0] / (n - 1) * (b.east - b.west)
    lat = b.south + vertices[:, 1] / (n - 1) * (b.north - b.south)
    positions = np.column_stack([lon, lat, vertices[:, 2]]).astype(np.float32)
    # Triangles are counter-clockwise in that y-up frame, as Cesium expects (it culls clockwise faces).
    triangles = tin.triangles.astype(np.uint32)
    return positions, triangles


def encode_tile(heights: np.ndarray, b: BBox, max_error: float, path) -> None:
    positions, triangles = mesh_tile(heights, b, max_error)
    indices = np.ascontiguousarray(triangles).flatten()
    normals = VertexNormalsExtension(positions=positions, indices=indices, ellipsoid=MARS_SPHERE)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as f:
        encode(
            f,
            positions,
            indices,
            bounds=[b.west, b.south, b.east, b.north],
            ellipsoid=MARS_SPHERE,
            extensions=[normals],
        )


def build() -> dict:
    fetch.download("mola-megdr-32")  # megt90n000fb.img, referenced by the PDS3 label below
    lbl = fetch.download("mola-megdr-32", url=_label_url(), name="megt90n000fb.lbl")
    ctx = fetch.download("ctx-dem-jpl")
    local_dtm = WORK / "jezero" / "dtm_1m_local.tif"
    if not local_dtm.exists():
        raise SystemExit("run the 'operational' step first (it produces the 1 m local DTM)")

    sources = [
        height_source(str(lbl), "mola", WORLD, 1 / 32),
        height_source(ctx, "ctx", CRATER, 20 / 59274.7),
        height_source(local_dtm, "hirise", JEZERO_AOI, 1.25 / 59274.7),
    ]
    available: list[list[dict]] = []
    count = 0
    for zmin, zmax, region, n, max_error in LEVELS:
        for z in range(zmin, zmax + 1):
            tiles = tiles_covering(z, region)
            for tile in tiles:
                b = tile.bounds
                heights = sample(sources[0], b, n)
                for finer in sources[1:]:
                    patch = sample(finer, b, n)
                    ok = np.isfinite(patch)
                    heights[ok] = patch[ok]
                if not np.isfinite(heights).all():
                    heights = np.where(np.isfinite(heights), heights, np.nanmean(heights))
                encode_tile(heights, b, max_error, OUT / str(z) / str(tile.x) / f"{tile.tms_y}.terrain")
                count += 1
            xs = [t.x for t in tiles]
            ys = [t.tms_y for t in tiles]
            available.append([{"startX": min(xs), "startY": min(ys), "endX": max(xs), "endY": max(ys)}])
            print(f"[terrain] z{z}: {len(tiles)} tiles")
    layer = {
        "tilejson": "2.1.0",
        "name": "copernico-mars-terrain",
        "description": "Rendering terrain only. Heights above the MOLA areoid on the R = 3396190 m sphere.",
        "version": "1.0.0",
        "format": "quantized-mesh-1.0",
        "scheme": "tms",
        "tiles": ["{z}/{x}/{y}.terrain"],
        "projection": "EPSG:4326",
        "bounds": [-180, -90, 180, 90],
        "available": available,
        "extensions": ["octvertexnormals"],
        "copernico": {"crs": "IAU_2015:49900", "radiusM": MARS_R, "levels": [list(level[:2]) + [level[3], level[4]] for level in LEVELS]},
    }
    ensure(OUT)
    (OUT / "layer.json").write_text(json.dumps(layer, indent=2), encoding="utf-8")
    print(f"[terrain] {count} tiles")
    return layer


def _label_url() -> str:
    from .paths import dataset

    return dataset("mola-megdr-32")["labelUrl"]
