"""Sample photos for the app: one NASA image per Perseverance sample (data/catalog/sample-images.json,
downloaded by scripts/data/fetch-sample-images.ts) as WebP, up to 1024 px wide and a 360 px thumbnail,
in data/build/rover/samples/."""
from __future__ import annotations

import json

from osgeo import gdal

from .paths import BUILD, RAW, ROOT, ensure

gdal.UseExceptions()
SAMPLE_IMAGES = ROOT / "data" / "catalog" / "sample-images.json"
SIZES = (("", 1024), ("_thumb", 360))


def build() -> int:
    catalog = json.loads(SAMPLE_IMAGES.read_text(encoding="utf-8"))
    out = ensure(BUILD / "rover" / "samples")
    written = 0
    for entry in catalog["images"]:
        if not entry.get("sourceFile"):
            print(f"[samples] #{entry['number']}: not downloaded, skipped")
            continue
        ds = gdal.Open(str(RAW / "sample-images" / entry["sourceFile"]))
        if ds.GetRasterBand(1).GetColorTable() is not None:
            # Palette PNGs: expand to real colours before resampling (averaging palette indices
            # would turn the photo into noise).
            ds = gdal.Translate("", ds, format="MEM", rgbExpand="rgb")
        bands = [1, 2, 3] if ds.RasterCount >= 3 else [1, 1, 1]  # greyscale shown as RGB
        for suffix, width in SIZES:
            dst = out / f"{entry['number']}{suffix}.webp"
            gdal.Translate(str(dst), ds, format="WEBP", bandList=bands, width=min(width, ds.RasterXSize),
                           height=0, resampleAlg="average", creationOptions=["QUALITY=82"])
            dst.with_suffix(".webp.aux.xml").unlink(missing_ok=True)
        written += 1
        print(f"[samples] #{entry['number']} {entry['name']}: {ds.RasterXSize}×{ds.RasterYSize} px")
    return written
