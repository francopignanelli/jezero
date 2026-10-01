"""Acquisition: full downloads (resumable) and windowed range reads of large remote GeoTIFFs."""
from __future__ import annotations

import math
import urllib.request
from pathlib import Path

from osgeo import gdal

from .frames import JEZERO_AOI, MARS_R, BBox
from .paths import RAW, dataset, ensure
from .provenance import read_record, write_record

gdal.UseExceptions()
USER_AGENT = "Copernico-pipeline/0.1 (NASA Space Apps research prototype)"


def download(dataset_id: str, url: str | None = None, name: str | None = None) -> Path:
    entry = dataset(dataset_id)
    url = url or entry["accessUrl"]
    dest = ensure(RAW / dataset_id) / (name or url.rstrip("/").split("/")[-1].split("?")[0])
    if dest.name == "content":  # Zenodo API style URLs
        dest = dest.with_name(entry["productId"] + ".tif")
    if dest.exists() and read_record(dest):
        print(f"[fetch] {dest.relative_to(RAW)} already present")
        return dest
    part = dest.with_suffix(dest.suffix + ".part")
    offset = part.stat().st_size if part.exists() else 0
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    if offset:
        req.add_header("Range", f"bytes={offset}-")
    print(f"[fetch] {url} -> {dest.relative_to(RAW)} (resume at {offset} B)")
    with urllib.request.urlopen(req, timeout=120) as resp, part.open("ab" if offset else "wb") as out:
        if offset and resp.status != 206:
            out.seek(0)
            out.truncate()
        while chunk := resp.read(1 << 20):
            out.write(chunk)
    part.replace(dest)
    write_record(dest, datasetId=dataset_id, sourceUrl=url, method="http-download")
    return dest


def aoi_window_in_source(ds: gdal.Dataset, aoi: BBox, margin_m: float) -> list[float]:
    """AOI (+margin) as a projWin [ulx, uly, lrx, lry] in an eqc source with lat_ts from its SRS."""
    srs = ds.GetSpatialRef()
    lat_ts = srs.GetProjParm("standard_parallel_1", 0.0)
    radius = srs.GetSemiMajor()
    if abs(radius - MARS_R) > 1.0:
        raise ValueError(f"unexpected sphere radius {radius}")
    k = math.cos(math.radians(lat_ts))
    x0 = radius * math.radians(aoi.west) * k - margin_m
    x1 = radius * math.radians(aoi.east) * k + margin_m
    y0 = radius * math.radians(aoi.south) - margin_m
    y1 = radius * math.radians(aoi.north) + margin_m
    return [x0, y1, x1, y0]


def window(dataset_id: str, aoi: BBox = JEZERO_AOI, margin_m: float = 400.0, res_m: float | None = None) -> Path:
    """Reads only the AOI window of a large remote GeoTIFF through GDAL /vsicurl/ range requests."""
    entry = dataset(dataset_id)
    dest = ensure(RAW / dataset_id) / f"{entry['productId']}_jezero_aoi.tif"
    if dest.exists() and read_record(dest):
        print(f"[window] {dest.relative_to(RAW)} already present")
        return dest
    src = gdal.Open("/vsicurl/" + entry["accessUrl"])
    proj_win = aoi_window_in_source(src, aoi, margin_m)
    opts = dict(
        projWin=proj_win,
        creationOptions=["TILED=YES", "COMPRESS=DEFLATE", "BIGTIFF=IF_SAFER", "NUM_THREADS=ALL_CPUS"],
        callback=gdal.TermProgress_nocb,
    )
    if res_m:
        opts.update(xRes=res_m, yRes=res_m, resampleAlg="average")
    tmp = dest.with_suffix(".part.tif")
    print(f"[window] {entry['accessUrl']} projWin={proj_win} res={res_m}")
    gdal.Translate(str(tmp), src, **opts)
    tmp.replace(dest)
    write_record(
        dest,
        datasetId=dataset_id,
        sourceUrl=entry["accessUrl"],
        method="gdal-vsicurl-window",
        projWin=proj_win,
        aoi=aoi.__dict__,
        marginM=margin_m,
        resampledTo=res_m,
    )
    return dest
