"""CLI: python -m copernico_geo <command>. See scripts/geospatial/README.md.

Rover, sample and POI snapshots are produced by scripts/data/snapshot-rover.ts (no GDAL needed).
"""
from __future__ import annotations

import argparse
import sys


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="copernico_geo")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("inspect", help="print and assert source metadata (header reads only)")
    sub.add_parser("operational", help="build the Jezero routing grid and coverage outline")
    sub.add_parser("imagery", help="build imagery tile pyramids")
    sub.add_parser("imagery-hd", help="regional 232 m Viking colour pyramid around Jezero")
    sub.add_parser("terrain", help="build quantized-mesh terrain tiles (needs 'operational')")
    sub.add_parser("all", help="operational, imagery, terrain")
    sub.add_parser("sky", help="convert the Milky Way PNG from scripts/data/build-sky.ts to WebP")
    args = parser.parse_args(argv)

    if args.cmd == "sky":
        from osgeo import gdal

        from .paths import BUILD

        gdal.UseExceptions()
        for src in sorted((BUILD / "sky").glob("milkyway_*.png")):
            dst = src.with_suffix(".webp")
            gdal.Translate(str(dst), str(src), format="WEBP", creationOptions=["QUALITY=88"])
            dst.with_suffix(".webp.aux.xml").unlink(missing_ok=True)
            src.unlink()
            print(f"[sky] {dst.name}: {dst.stat().st_size} bytes")
        return 0

    if args.cmd == "inspect":
        from .inspect_sources import run

        return run()
    if args.cmd in ("operational", "all"):
        from .operational import build

        build()
    if args.cmd == "imagery-hd":
        from .imagery import build_viking_hd

        layer = build_viking_hd()
        print(f"[imagery] viking-hd: {layer['tiles']} tiles")
        return 0
    if args.cmd in ("imagery", "all"):
        from .imagery import build as build_imagery

        build_imagery()
    if args.cmd in ("terrain", "all"):
        from .terrain import build as build_terrain

        build_terrain()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
