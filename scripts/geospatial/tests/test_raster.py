"""Mirrors the TypeScript slope tests so both Horn implementations are held to the same truth."""
import math

import numpy as np

from copernico_geo.frames import MARS_R, eqc_forward, eqc_inverse
from copernico_geo.raster import blocks, erode, horn_gradient, row_widths_m, slope_deg
from copernico_geo.tiling import Tile, tiles_covering
from copernico_geo.frames import BBox

CELL = 5.0
ORIGIN_Y = MARS_R * math.radians(18.45) + 50 * CELL


def plane(rows, cols, slope, az):
    g = math.tan(math.radians(slope))
    ge, gn = g * math.sin(math.radians(az)), g * math.cos(math.radians(az))
    widths = row_widths_m(ORIGIN_Y, CELL, rows)
    z = np.zeros((rows, cols), dtype=np.float64)
    for r in range(rows):
        north = (rows / 2 - (r + 0.5)) * CELL
        east = (np.arange(cols) + 0.5 - cols / 2) * widths[r]
        z[r] = -2500 + ge * east + gn * north
    return z


def test_horn_recovers_planes():
    for slope, az in [(5, 0), (15, 45), (20, 90), (30, 225)]:
        z = plane(21, 21, slope, az)
        s = slope_deg(*horn_gradient(z, ORIGIN_Y, CELL))
        assert abs(s[10, 10] - slope) < 0.01
        assert np.isnan(s[0, 0])


def test_horn_nodata_is_not_extrapolated():
    z = plane(21, 21, 10, 0)
    z[10, 10] = np.nan
    s = slope_deg(*horn_gradient(z, ORIGIN_Y, CELL))
    assert np.isnan(s[9:12, 9:12]).all()
    assert not np.isnan(s[10, 13])


def test_erode_and_blocks():
    m = np.ones((7, 7), dtype=bool)
    m[3, 3] = False
    e = erode(m, 1)
    assert not e[2:5, 2:5].any() and not e[0].any() and e[1, 1]
    b = blocks(np.arange(100, dtype=float).reshape(10, 10), 5)
    assert b.shape == (2, 2, 25) and b[0, 0, 0] == 0 and b[1, 1, -1] == 99


def test_frame_matches_places_landing_site():
    x, y = eqc_forward(18.444571297, 77.450910771)
    assert abs(x - 4354495.494) < 0.01 and abs(y - 1093296.385) < 0.01
    lat, lon = eqc_inverse(x, y)
    assert abs(lat - 18.444571297) < 1e-9 and abs(lon - 77.450910771) < 1e-9


def test_tiling_scheme():
    t = Tile(0, 1, 0)
    assert t.bounds == BBox(west=0.0, south=-90.0, east=180.0, north=90.0)
    assert Tile(3, 0, 0).tms_y == 7
    jezero = tiles_covering(16, BBox(west=77.28, south=18.40, east=77.48, north=18.52))
    size = 180 / 2**16
    assert all(t.bounds.east > 77.28 and t.bounds.west < 77.48 for t in jezero)
    assert len(jezero) == (math.ceil((77.48 + 180) / size) - math.floor((77.28 + 180) / size)) * (
        math.ceil((90 - 18.40) / size) - math.floor((90 - 18.52) / size)
    )


def test_edge_feather_ramps_to_zero_at_the_box_edge():
    from copernico_geo.frames import BBox
    from copernico_geo.imagery import edge_feather
    from copernico_geo.tiling import tiles_covering

    box = BBox(west=77.0, south=17.6, east=78.58, north=19.28)
    tile = next(t for t in tiles_covering(10, box) if t.bounds.west <= 77.0 <= t.bounds.east)
    w = edge_feather(tile, box, 0.12)
    assert w.min() >= 0 and w.max() <= 1
    # Column nearest the west edge is (almost) transparent; well inside it is opaque.
    col = int((77.0 - tile.bounds.west) / (tile.bounds.east - tile.bounds.west) * 256)
    assert w[:, min(col + 1, 255)].max() < 0.05
