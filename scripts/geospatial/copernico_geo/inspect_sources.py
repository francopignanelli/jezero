"""Reads remote headers only (GDAL /vsicurl/) and asserts them against the catalog 'expect' fields."""
from __future__ import annotations

import json

from osgeo import gdal

from .paths import CATALOG

gdal.UseExceptions()


def describe(url: str) -> dict:
    ds = gdal.Open("/vsicurl/" + url)
    srs = ds.GetSpatialRef()
    band = ds.GetRasterBand(1)
    gt = ds.GetGeoTransform()
    return {
        "size": [ds.RasterXSize, ds.RasterYSize, ds.RasterCount],
        "dtype": gdal.GetDataTypeName(band.DataType),
        "nodata": band.GetNoDataValue(),
        "geotransform": gt,
        "proj4": srs.ExportToProj4() if srs else None,
        "lat_ts": srs.GetProjParm("standard_parallel_1", float("nan")) if srs else None,
        "lon_0": srs.GetProjParm("central_meridian", float("nan")) if srs else None,
        "radius": srs.GetSemiMajor() if srs else None,
        "overviews": band.GetOverviewCount(),
        "blockSize": band.GetBlockSize(),
    }


def check(entry: dict, info: dict) -> list[str]:
    problems = []
    exp = entry.get("expect", {})
    if "proj" in exp and info["proj4"] and f"+proj={exp['proj']}" not in info["proj4"]:
        problems.append(f"projection {info['proj4']} ≠ {exp['proj']}")
    for key in ("lat_ts", "lon_0"):
        if key in exp and abs(info[key] - exp[key]) > 1e-6:
            problems.append(f"{key} {info[key]} ≠ {exp[key]}")
    if "radius" in exp and abs(info["radius"] - exp["radius"]) > 1.0:
        problems.append(f"radius {info['radius']} ≠ {exp['radius']}")
    if "nodataBelow" in exp and not (info["nodata"] is not None and info["nodata"] < exp["nodataBelow"]):
        problems.append(f"nodata {info['nodata']} not < {exp['nodataBelow']}")
    return problems


def run() -> int:
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    failures = 0
    for entry in catalog["datasets"]:
        url = entry.get("accessUrl", "")
        if not url.endswith((".tif", ".tiff", "/content")):
            continue
        try:
            info = describe(url)
        except RuntimeError as err:
            print(f"[inspect] {entry['id']}: cannot open ({err})")
            failures += 1
            continue
        problems = check(entry, info)
        status = "OK" if not problems else "MISMATCH: " + "; ".join(problems)
        print(f"[inspect] {entry['id']}: {status}\n  {json.dumps(info)}")
        failures += bool(problems)
    return 1 if failures else 0
