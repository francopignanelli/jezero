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


def test_grid_normals_point_up_on_flat_ground_and_tilt_downhill():
    import math

    from copernico_geo.frames import MARS_R
    from copernico_geo.terrain import grid_normals

    n = 9
    flat = np.zeros((n + 2, n + 2))
    nrm = grid_normals(flat, TILE)
    lat, lon = math.radians(TILE.north), math.radians(TILE.west)
    up = np.array([math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat)])
    assert np.allclose(nrm[0, 0], up, atol=1e-9)
    assert np.allclose(np.linalg.norm(nrm, axis=-1), 1.0)
    # Heights rising to the east by 10 %: the normal leans west (negative east component).
    step_m = math.radians((TILE.east - TILE.west) / (n - 1)) * MARS_R * math.cos(math.radians(TILE.north))
    ramp = np.tile(np.arange(n + 2) * 0.1 * step_m, (n + 2, 1))
    east = np.array([-math.sin(lon), math.cos(lon), 0.0])
    assert np.dot(grid_normals(ramp, TILE)[0, 0], east) < -0.09
