"""Terrain mesh orientation tests: geographic placement and triangle winding.

Regressions caught on 2026-09-25: pydelatin counts y from the bottom row; mapping it as a top-down row
mirrored every tile north-south (ledges at tile-row boundaries) and flipped the winding (culled faces).
"""
import numpy as np

from copernico_geo.frames import BBox
from copernico_geo.terrain import mesh_tile

TILE = BBox(west=77.0, south=18.0, east=77.1, north=18.1)


def test_heights_keep_their_north_south_position():
    rows = cols = 17
    # Row 0 is NORTH in our arrays: heights decrease from north (0 m) to south (−160 m).
    heights = np.repeat((-10.0 * np.arange(rows))[:, None], cols, axis=1)
    positions, _ = mesh_tile(heights, TILE, 0.01)
    lat, h = positions[:, 1].astype(np.float64), positions[:, 2].astype(np.float64)
    north = np.isclose(lat, TILE.north, atol=1e-6)
    south = np.isclose(lat, TILE.south, atol=1e-6)
    assert north.any() and south.any()
    assert np.allclose(h[north], 0.0) and np.allclose(h[south], -160.0)
    # height is a linear function of latitude everywhere
    expected = -160.0 * (TILE.north - lat) / (TILE.north - TILE.south)
    assert np.allclose(h, expected, atol=1e-3)


def test_triangles_are_counter_clockwise_in_lon_lat():
    heights = np.random.default_rng(7).random((33, 33)) * 50 - 2500
    positions, triangles = mesh_tile(heights, TILE, 0.5)
    p = positions[:, :2].astype(np.float64)
    a, b, c = p[triangles[:, 0]], p[triangles[:, 1]], p[triangles[:, 2]]
    signed = (b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (c[:, 0] - a[:, 0]) * (b[:, 1] - a[:, 1])
    assert (signed > 0).all()


def test_positions_stay_inside_tile():
    positions, _ = mesh_tile(np.full((17, 17), -2570.0), TILE, 0.5)
    assert positions[:, 0].min() >= TILE.west - 1e-6 and positions[:, 0].max() <= TILE.east + 1e-6
    assert positions[:, 1].min() >= TILE.south - 1e-6 and positions[:, 1].max() <= TILE.north + 1e-6
    assert np.allclose(positions[:, 2], -2570.0)
