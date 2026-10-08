"""Quantized-mesh-1.0 terrain tiles on the Mars sphere (R = 3 396 190 m), heights above the areoid.

Heights are for rendering only (meshes are simplified to a per-level max error); all scientific
metrics read the routing grid instead. Levels: global MOLA z0–5, crater CTX z6–12, Jezero HiRISE
z13–16. Output: data/build/tiles/terrain/{layer.json,{z}/{x}/{tmsY}.terrain} (uncompressed).
"""
from __future__ import annotations

import json
import math
from struct import pack

import attr
import numpy as np
from osgeo import gdal
from pydelatin import Delatin
from quantized_mesh_encoder import encode
from quantized_mesh_encoder.constants import EXTENSION_HEADER
from quantized_mesh_encoder.ellipsoid import Ellipsoid
from quantized_mesh_encoder.extensions import VertexNormalsExtension
from quantized_mesh_encoder.normals import oct_encode

from . import fetch
from .frames import JEZERO_AOI, MARS_R, BBox, geographic_srs
from .imagery import CRATER
from .paths import BUILD, RAW, WORK, ensure
from .tiling import WORLD, Tile, tiles_covering

gdal.UseExceptions()
OUT = BUILD / "tiles" / "terrain"
MARS_SPHERE = Ellipsoid(MARS_R, MARS_R)

# Crater rim around Perseverance's recent positions (sols ~1710–1980), covered by the USGS MSR
# HiRISE 1 m DTM (v003, 2024): detailed terrain for the rover close-up and its 360° panorama.
RIM = BBox(west=77.2150, south=18.4180, east=77.2500, north=18.4500)
# The MSR DTM sits ~1.5 m above the CTX DEM on average, with up to ~5 m steps along its edges
# (measured on 10 m averages): it is blended in over this band so no wall appears at low angles.
RIM_FEATHER_DEG = 0.003  # ≈ 180 m

# (zmin, zmax, region, grid samples per side, max mesh error in m)
LEVELS = [
    (0, 5, WORLD, 65, 150.0),
    (6, 9, CRATER, 65, 25.0),
    (10, 12, CRATER, 65, 5.0),
    (13, 14, JEZERO_AOI, 129, 1.0),
    (15, 16, JEZERO_AOI, 129, 0.5),
    (13, 14, RIM, 129, 1.0),
    (15, 16, RIM, 129, 0.5),
]


def _intersects(a: BBox, b: BBox) -> bool:
    return a.west < b.east and b.west < a.east and a.south < b.north and b.south < a.north


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


def edge_weight(b: BBox, n: int, box: BBox, feather_deg: float) -> np.ndarray:
    """n×n weights (same grid as sample()): 0 outside `box`, rising linearly to 1 at feather_deg inside."""
    lon = b.west + np.arange(n) / (n - 1) * (b.east - b.west)
    lat = b.north - np.arange(n) / (n - 1) * (b.north - b.south)
    dx = np.minimum(lon - box.west, box.east - lon)[None, :]
    dy = np.minimum(lat - box.south, box.north - lat)[:, None]
    return np.clip(np.minimum(dx, dy) / feather_deg, 0.0, 1.0)


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


def curvature_drop(b: BBox, n: int) -> np.ndarray:
    """Drop (m) of the sphere below the plane tangent at the tile centre, at the n×n grid nodes."""
    lat0, lon0 = math.radians((b.south + b.north) / 2), math.radians((b.west + b.east) / 2)
    lat = np.radians(b.north - np.arange(n) * (b.north - b.south) / (n - 1))[:, None]
    lon = np.radians(b.west + np.arange(n) * (b.east - b.west) / (n - 1))[None, :]
    cos_theta = np.sin(lat0) * np.sin(lat) + np.cos(lat0) * np.cos(lat) * np.cos(lon - lon0)
    return MARS_R * (1 - np.clip(cos_theta, -1, 1))


def mesh_tile(heights: np.ndarray, b: BBox, max_error: float) -> tuple[np.ndarray, np.ndarray]:
    """TIN for a tile as (lon, lat, height) positions and counter-clockwise triangle indices.

    Mesh triangles are flat in 3D, so a big triangle over flat ground is a chord cutting inside the
    sphere (a 22° chord sags ~65 km). Simplifying heights alone made the globe's silhouette a polygon
    with dips. The TIN is therefore built on heights minus the sphere's drop below the tile's
    tangent plane, so the error budget also bounds that sag; the vertices keep their real heights."""
    n = heights.shape[0]
    tin = Delatin((heights - curvature_drop(b, n)).astype(np.float32), max_error=max_error)
    # pydelatin vertices are (x, y, height) with x = column and y counted from the BOTTOM row
    # (verified: tests/test_terrain.py). Our array's row 0 is north, so y grows northwards.
    vertices = tin.vertices.astype(np.float64)
    col = np.rint(vertices[:, 0]).astype(int)
    row = (n - 1) - np.rint(vertices[:, 1]).astype(int)
    lon = b.west + vertices[:, 0] / (n - 1) * (b.east - b.west)
    lat = b.south + vertices[:, 1] / (n - 1) * (b.north - b.south)
    positions = np.column_stack([lon, lat, heights[row, col]]).astype(np.float32)
    # Triangles are counter-clockwise in that y-up frame, as Cesium expects (it culls clockwise faces).
    triangles = tin.triangles.astype(np.uint32)
    return positions, triangles


@attr.s(kw_only=True)
class SurfaceNormalsExtension(VertexNormalsExtension):
    """Octahedral vertex normals supplied by the caller instead of averaged from the TIN faces."""

    normals: np.ndarray = attr.ib(validator=attr.validators.instance_of(np.ndarray))

    def encode(self) -> bytes:
        encoded = oct_encode(self.normals.astype(np.float32)).tobytes("C")
        return (pack(EXTENSION_HEADER["extensionId"], self.id.value)
                + pack(EXTENSION_HEADER["extensionLength"], len(encoded)) + encoded)


def grid_normals(ext: np.ndarray, b: BBox) -> np.ndarray:
    """Unit surface normals (Mars-fixed Cartesian) at the n×n grid nodes of a tile, from central
    differences on an (n+2)×(n+2) height grid that has one extra ring of samples outside the tile.

    Normals averaged from the TIN faces (the encoder default) change abruptly across big coarse
    triangles and at tile edges, which lit the globe as large flat facets with straight seams. These
    come from the same global height field on the same global grid nodes, so neighbouring tiles agree
    on their shared edge, and their smoothing scale follows the tile's sample spacing."""
    n = ext.shape[0] - 2
    step = math.radians((b.east - b.west) / (n - 1))
    lat = np.radians(b.north - np.arange(n) * (b.north - b.south) / (n - 1))[:, None]
    lon = np.radians(b.west + np.arange(n) * (b.east - b.west) / (n - 1))[None, :]
    de = (ext[1:-1, 2:] - ext[1:-1, :-2]) / (2 * step * MARS_R * np.maximum(np.cos(lat), 1e-3))
    dn = (ext[:-2, 1:-1] - ext[2:, 1:-1]) / (2 * step * MARS_R)
    inv = 1 / np.sqrt(de * de + dn * dn + 1)
    ue, un, uu = -de * inv, -dn * inv, inv  # local east, north, up components
    sl, cl, sf, cf = np.sin(lon), np.cos(lon), np.sin(lat), np.cos(lat)
    x = -sl * ue - sf * cl * un + cf * cl * uu
    y = cl * ue - sf * sl * un + cf * sl * uu
    z = cf * un + sf * uu
    return np.stack([x, y, z], axis=-1)


def _fill_ring(ext: np.ndarray) -> np.ndarray:
    """Outer-ring samples beyond the data (poles, ±180°) take the adjacent inner value."""
    for src, dst in ((1, 0), (-2, -1)):
        ext[dst] = np.where(np.isfinite(ext[dst]), ext[dst], ext[src])
        ext[:, dst] = np.where(np.isfinite(ext[:, dst]), ext[:, dst], ext[:, src])
    return np.where(np.isfinite(ext), ext, np.nanmean(ext))


def encode_tile(heights: np.ndarray, b: BBox, max_error: float, path, normal_grid: np.ndarray) -> None:
    positions, triangles = mesh_tile(heights, b, max_error)
    indices = np.ascontiguousarray(triangles).flatten()
    n = heights.shape[0]
    col = np.rint((positions[:, 0] - b.west) / (b.east - b.west) * (n - 1)).astype(int)
    row = np.rint((b.north - positions[:, 1]) / (b.north - b.south) * (n - 1)).astype(int)
    normals = SurfaceNormalsExtension(positions=positions, indices=indices, ellipsoid=MARS_SPHERE,
                                      normals=normal_grid[np.clip(row, 0, n - 1), np.clip(col, 0, n - 1)])
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


def build(only: BBox | None = None) -> dict:
    """All terrain tiles, or (with `only`) just the tiles intersecting that box; layer.json always
    lists the full availability."""
    fetch.download("mola-megdr-32")  # megt90n000fb.img, referenced by the PDS3 label below
    lbl = fetch.download("mola-megdr-32", url=_label_url(), name="megt90n000fb.lbl")
    ctx = fetch.download("ctx-dem-jpl")
    local_dtm = WORK / "jezero" / "dtm_1m_local.tif"
    if not local_dtm.exists():
        raise SystemExit("run the 'operational' step first (it produces the 1 m local DTM)")

    msr = RAW / "msr-hirise" / "MSR_hirise_soc_003_DTM_MOLATopography_DeltaGeoid_1m_Eqc_latTs0_lon0_Blend40.tif"
    if not msr.exists():
        raise SystemExit("run: npx tsx scripts/data/fetch-zip-entry.ts (MSR HiRISE 1 m DTM)")
    # Coarse to fine; a finer source overwrites wherever it has data (blended at its edges when it
    # has a feather band).
    sources = [
        (height_source(str(lbl), "mola", WORLD, 1 / 32), None),
        (height_source(ctx, "ctx", CRATER, 20 / 59274.7), None),
        (height_source(msr, "msr", RIM, 1.25 / 59274.7, -32767), (RIM, RIM_FEATHER_DEG)),
        (height_source(local_dtm, "hirise", JEZERO_AOI, 1.25 / 59274.7), None),
    ]
    ranges: dict[int, list[dict]] = {}
    count = 0
    for zmin, zmax, region, n, max_error in LEVELS:
        for z in range(zmin, zmax + 1):
            tiles = tiles_covering(z, region)
            for tile in tiles:
                b = tile.bounds
                if only is not None and not _intersects(b, only):
                    continue
                # One extra ring of samples outside the tile, for the surface normals.
                step = (b.east - b.west) / (n - 1)
                eb = BBox(west=b.west - step, south=b.south - step, east=b.east + step, north=b.north + step)
                ext = sample(sources[0][0], eb, n + 2)
                for finer, feather in sources[1:]:
                    patch = sample(finer, eb, n + 2)
                    ok = np.isfinite(patch)
                    if feather is None:
                        ext[ok] = patch[ok]
                    else:
                        w = edge_weight(eb, n + 2, *feather)
                        ext[ok] = ext[ok] * (1 - w[ok]) + patch[ok] * w[ok]
                heights = ext[1:-1, 1:-1].copy()
                if not np.isfinite(heights).all():
                    heights = np.where(np.isfinite(heights), heights, np.nanmean(heights))
                normal_grid = grid_normals(_fill_ring(ext.copy()), b)
                encode_tile(heights, b, max_error, OUT / str(z) / str(tile.x) / f"{tile.tms_y}.terrain",
                            normal_grid)
                count += 1
            xs = [t.x for t in tiles]
            ys = [t.tms_y for t in tiles]
            ranges.setdefault(z, []).append({"startX": min(xs), "startY": min(ys), "endX": max(xs), "endY": max(ys)})
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
        "available": [ranges[z] for z in sorted(ranges)],
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
