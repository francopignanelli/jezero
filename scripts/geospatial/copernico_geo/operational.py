"""Builds the operational routing grid for Jezero from the 1 m HiRISE DTM (docs/PLAN.md §5.4, §6).

Outputs (data/build/regions/jezero/):
  grid.json                 header: CRS, geotransform, band encodings, provenance, statistics
  elevation.bin             int16 LE, 5 m block mean of the 1 m DTM (all 25 sub-cells valid), areoid
  fine_slope_median.bin     uint8 LE, median of the 1 m Horn slope (2 m baseline) per 5 m cell
  fine_slope_p90.bin        uint8 LE, P90 of the same
  thermal_inertia.bin       uint8 LE, THEMIS TI (Edwards & Buz 2021) nearest-resampled from 100 m
  coverage.geojson          outline of routable data, eroded 2 cells so it never overstates coverage
"""
from __future__ import annotations

import json
import math
import warnings

import numpy as np
from osgeo import gdal, ogr, osr

from . import fetch
from .frames import JEZERO_AOI, ROUTING_CELL_M, eqc_forward, eqc_inverse, local_srs
from .paths import BUILD, WORK, dataset, ensure
from .provenance import read_record, sha256
from .raster import blocks, erode, horn_gradient, slope_deg

gdal.UseExceptions()
OUT = BUILD / "regions" / "jezero"
FINE_M = 1.0
K = int(ROUTING_CELL_M / FINE_M)

ELEV_SCALE = 0.05  # m per count
SLOPE_SCALE = 0.25  # deg per count; values above 63.5° saturate (all far beyond the 20° limit)
TI_SCALE = 4.0  # J m^-2 K^-1 s^-1/2 per count


def aligned_local_bounds(margin_m: float = 0.0) -> tuple[float, float, float, float]:
    x0, y0 = eqc_forward(JEZERO_AOI.south, JEZERO_AOI.west)
    x1, y1 = eqc_forward(JEZERO_AOI.north, JEZERO_AOI.east)
    snap = ROUTING_CELL_M
    return (
        math.floor((x0 - margin_m) / snap) * snap,
        math.floor((y0 - margin_m) / snap) * snap,
        math.ceil((x1 + margin_m) / snap) * snap,
        math.ceil((y1 + margin_m) / snap) * snap,
    )


def warp_to_local(src_path, dst_name: str, res: float, resample: str, src_nodata=None) -> gdal.Dataset:
    xmin, ymin, xmax, ymax = aligned_local_bounds()
    dst = ensure(WORK / "jezero") / dst_name
    gdal.Warp(
        str(dst),
        str(src_path),
        dstSRS=local_srs().ExportToWkt(),
        outputBounds=(xmin, ymin, xmax, ymax),
        xRes=res,
        yRes=res,
        resampleAlg=resample,
        srcNodata=src_nodata,
        dstNodata=float("nan"),
        outputType=gdal.GDT_Float32,
        multithread=True,
        warpOptions=["NUM_THREADS=ALL_CPUS"],
        creationOptions=["TILED=YES", "COMPRESS=DEFLATE", "PREDICTOR=3", "BIGTIFF=IF_SAFER"],
    )
    return gdal.Open(str(dst))


def quantize(values: np.ndarray, scale: float, offset: float, dtype, nodata) -> np.ndarray:
    info = np.iinfo(dtype)
    q = np.round((values - offset) / scale)
    q = np.clip(q, info.min + (1 if nodata == info.min else 0), info.max - (1 if nodata == info.max else 0))
    q[~np.isfinite(values)] = nodata
    return q.astype(dtype)


def coverage_geojson(valid: np.ndarray, origin_x: float, origin_y: float, cell: float) -> dict:
    rows, cols = valid.shape
    mem = gdal.GetDriverByName("MEM").Create("", cols, rows, 1, gdal.GDT_Byte)
    mem.SetGeoTransform((origin_x, cell, 0, origin_y, 0, -cell))
    mem.SetSpatialRef(local_srs())
    band = mem.GetRasterBand(1)
    band.WriteArray(valid.astype(np.uint8))
    vds = ogr.GetDriverByName("Memory").CreateDataSource("")
    layer = vds.CreateLayer("coverage", srs=local_srs(), geom_type=ogr.wkbPolygon)
    layer.CreateField(ogr.FieldDefn("v", ogr.OFTInteger))
    gdal.Polygonize(band, band, layer, 0)
    features = []
    for feat in layer:
        geom = feat.GetGeometryRef().Simplify(cell)  # ≤ 1 cell change; outline is eroded by 2 cells
        if geom.GetArea() < 100 * cell * cell:
            continue  # drop specks smaller than 100 cells
        ring_sets = []
        for poly in [geom] if geom.GetGeometryType() == ogr.wkbPolygon else list(geom):
            rings = []
            for r in range(poly.GetGeometryCount()):
                ring = poly.GetGeometryRef(r)
                pts = []
                for p in range(ring.GetPointCount()):
                    lat, lon = eqc_inverse(ring.GetX(p), ring.GetY(p))
                    pts.append([round(lon, 6), round(lat, 6)])
                rings.append(pts)
            ring_sets.append(rings)
        for rings in ring_sets:
            features.append({"type": "Feature", "properties": {}, "geometry": {"type": "Polygon", "coordinates": rings}})
    return {
        "type": "FeatureCollection",
        "properties": {
            "description": "Route-planning coverage (HiRISE-derived 1 m DTM). Drawn 2 cells inside valid data.",
            "coordinates": "planetocentric lat, east longitude (deg), IAU_2015:49900",
        },
        "features": features,
    }


def build() -> dict:
    dtm = fetch.window("hirise-dtm-trn")
    ti_src = fetch.download("themis-ti-jezero")
    dtm_ds = gdal.Open(str(dtm))  # keep a reference: bands die with their dataset
    src_nodata = dtm_ds.GetRasterBand(1).GetNoDataValue()
    dtm_ds = None

    print("[operational] warping DTM to the Mars 2020 frame at 1 m (bilinear, nodata-aware)")
    fine_ds = warp_to_local(dtm, "dtm_1m_local.tif", FINE_M, "bilinear", src_nodata)
    gt = fine_ds.GetGeoTransform()
    z1 = fine_ds.GetRasterBand(1).ReadAsArray().astype(np.float32)
    z1[z1 < -1e30] = np.nan
    # Bilinear warping renormalises weights at nodata edges; drop that 1 px fringe.
    z1[~erode(np.isfinite(z1), 1)] = np.nan

    print("[operational] fine-scale Horn slope (2 m baseline)")
    s2 = slope_deg(*horn_gradient(z1, gt[3], FINE_M))

    print("[operational] 5 m aggregation")
    zb = blocks(z1, K)
    full = np.isfinite(zb).all(axis=2)
    elev5 = np.where(full, zb.mean(axis=2), np.nan).astype(np.float32)
    sb = blocks(s2, K)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", category=RuntimeWarning)
        med = np.nanmedian(sb, axis=2).astype(np.float32)
        p90 = np.nanpercentile(sb, 90, axis=2).astype(np.float32)
    med[~full] = np.nan
    p90[~full] = np.nan

    rows, cols = elev5.shape
    origin_x, origin_y = gt[0], gt[3]

    print("[operational] thermal inertia to the 5 m grid (nearest; source 100 m)")
    ti_ds = warp_to_local(ti_src, "ti_5m_local.tif", ROUTING_CELL_M, "near", 0)
    ti = ti_ds.GetRasterBand(1).ReadAsArray().astype(np.float32)[:rows, :cols]

    # Cross-check statistic with the 10 m-baseline slope the web app derives from elev5.
    s10 = slope_deg(*horn_gradient(elev5, origin_y, ROUTING_CELL_M))
    valid5 = np.isfinite(s10)

    elev_offset = float(np.round(np.nanmedian(elev5)))
    bands = {
        "elevation": (quantize(elev5, ELEV_SCALE, elev_offset, np.int16, -32768), "int16", ELEV_SCALE, elev_offset, -32768, "m", "Height above the MOLA areoid; 5 m block mean of the 1 m DTM"),
        "fine_slope_median": (quantize(med, SLOPE_SCALE, 0.0, np.uint8, 255), "uint8", SLOPE_SCALE, 0.0, 255, "deg", "Median of the 1 m Horn slope (2 m baseline) within each 5 m cell"),
        "fine_slope_p90": (quantize(p90, SLOPE_SCALE, 0.0, np.uint8, 255), "uint8", SLOPE_SCALE, 0.0, 255, "deg", "90th percentile of the 1 m Horn slope within each 5 m cell"),
        "thermal_inertia": (quantize(ti, TI_SCALE, 0.0, np.uint8, 0), "uint8", TI_SCALE, 0.0, 0, "J m^-2 K^-1 s^-1/2", "THEMIS-derived thermal inertia, nearest-resampled from 100 m"),
    }
    ensure(OUT)
    band_meta = []
    for name, (arr, dtype, scale, offset, nodata, units, desc) in bands.items():
        path = OUT / f"{name}.bin"
        arr.astype(arr.dtype.newbyteorder("<")).tofile(path)
        band_meta.append({"name": name, "file": path.name, "dtype": dtype, "scale": scale, "offset": offset, "nodata": nodata, "units": units, "description": desc, "sha256": sha256(path)})

    coverage = coverage_geojson(erode(valid5, 2), origin_x, origin_y, ROUTING_CELL_M)
    (OUT / "coverage.geojson").write_text(json.dumps(coverage), encoding="utf-8")

    srs = local_srs()
    header = {
        "schemaVersion": 1,
        "region": "jezero",
        "cols": cols,
        "rows": rows,
        "cellSize": ROUTING_CELL_M,
        "originX": origin_x,
        "originY": origin_y,
        "projection": {"latTsDeg": srs.GetProjParm("standard_parallel_1"), "lon0Deg": srs.GetProjParm("central_meridian"), "radiusM": srs.GetSemiMajor()},
        "crsWkt": srs.ExportToWkt(),
        "crsProj": srs.ExportToProj4(),
        "verticalDatum": "MOLA areoid",
        "bands": band_meta,
        "sources": {
            "hirise-dtm-trn": read_record(dtm),
            "themis-ti-jezero": read_record(ti_src),
        },
        "processing": [
            "Window read of the USGS TRN HiRISE DTM (1 m, eqc lat_ts 0) via GDAL /vsicurl/.",
            "Warp to Mars 2020 frame (eqc lat_ts 18.4663, R 3396190 m) at 1 m, bilinear, nodata-aware; 1 px fringe removed.",
            "Horn slope at 1 m (2 m baseline); 5 m blocks: mean elevation only where all 25 sub-cells are valid; median and P90 fine slope.",
            "THEMIS TI nearest-resampled to 5 m (source 100 m: coarse).",
            "Coverage outline: valid 10 m-baseline slope area eroded 2 cells, simplified ≤ 1 cell.",
        ],
        "statistics": {
            "validCells": int(valid5.sum()),
            "validAreaKm2": round(float(valid5.sum()) * ROUTING_CELL_M**2 / 1e6, 2),
            "elevationRangeM": [round(float(np.nanmin(elev5)), 1), round(float(np.nanmax(elev5)), 1)],
            "fractionAbove20DegS10": round(float(np.mean(s10[valid5] > 20)), 4),
            "fractionAbove20DegFineMedian": round(float(np.nanmean(med[valid5] > 20)), 4),
            "tiCoverage": round(float(np.mean(np.isfinite(ti[valid5]))), 4),
        },
        "datasets": [dataset("hirise-dtm-trn")["productId"], dataset("themis-ti-jezero")["productId"]],
    }
    (OUT / "grid.json").write_text(json.dumps(header, indent=2), encoding="utf-8")
    print(json.dumps(header["statistics"], indent=2))
    return header
