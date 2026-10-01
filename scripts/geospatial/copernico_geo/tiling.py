"""Cesium GeographicTilingScheme math (2×1 root tiles, y counted from the north) on the Mars sphere."""
from __future__ import annotations

import math
from dataclasses import dataclass

from .frames import BBox

TILE_PX = 256


@dataclass(frozen=True)
class Tile:
    z: int
    x: int
    y: int  # from the north (imagery). Terrain (TMS) uses tms_y.

    @property
    def size_deg(self) -> float:
        return 180.0 / (1 << self.z)

    @property
    def bounds(self) -> BBox:
        s = self.size_deg
        west = -180.0 + self.x * s
        north = 90.0 - self.y * s
        return BBox(west=west, south=north - s, east=west + s, north=north)

    @property
    def tms_y(self) -> int:
        return (1 << self.z) - 1 - self.y


def tiles_covering(z: int, box: BBox) -> list[Tile]:
    """Tiles at level z intersecting a lon/lat box (longitudes in −180..180)."""
    s = 180.0 / (1 << z)
    x0 = max(0, math.floor((box.west + 180.0) / s))
    x1 = min((2 << z) - 1, math.ceil((box.east + 180.0) / s) - 1)
    y0 = max(0, math.floor((90.0 - box.north) / s))
    y1 = min((1 << z) - 1, math.ceil((90.0 - box.south) / s) - 1)
    return [Tile(z, x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)]


def pixel_deg(z: int) -> float:
    return 180.0 / (1 << z) / TILE_PX


WORLD = BBox(west=-180.0, south=-90.0, east=180.0, north=90.0)
