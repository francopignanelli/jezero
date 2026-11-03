"""Rover game assets: height encoding, seamless ground tiles, and the panorama-to-ground projection."""
import gzip

import numpy as np

import copernico_geo.game as game


def test_heights_round_trip_through_the_delta_coding(tmp_path, monkeypatch):
    monkeypatch.setattr(game, "OUT", tmp_path)
    rng = np.random.default_rng(3)
    z = -2560 + np.cumsum(rng.normal(0, 0.3, (40, 50)), axis=1) + rng.normal(0, 2, (40, 1))
    meta = game._write_heights("t", z, 0.01, 1.0, (50.0, 40.0))
    raw = np.frombuffer(gzip.decompress((tmp_path / "t.bin.gz").read_bytes()), dtype="<u2").reshape(40, 50)
    # The browser's decoder: running sums modulo 2^16 per row.
    q = np.cumsum(raw.astype(np.int64), axis=1) % 65536
    back = meta["baseM"] + q * meta["stepM"]
    assert np.abs(back - z).max() <= 0.005 + 1e-9
    assert meta["cols"] == 50 and meta["rows"] == 40


def test_make_tileable_has_no_seam_across_the_wrap():
    rng = np.random.default_rng(5)
    img = np.clip(rng.normal(128, 40, (64, 64, 3)) + np.linspace(0, 80, 64)[:, None, None], 0, 255)
    tile = game.make_tileable(img)
    # Across the wrap the jump is no larger than between neighbouring pixels inside the tile.
    wrap = np.abs(tile[0] - tile[-1]).mean()
    inside = np.abs(np.diff(tile, axis=0)).mean()
    assert wrap <= inside * 1.2
    # Contrast is preserved (variance-preserving blend), the mean unchanged.
    assert abs(tile.std() - img.std()) / img.std() < 0.35
    assert abs(tile.mean() - img.mean()) < 3


def test_ground_patch_projects_azimuth_and_distance(monkeypatch):
    # A synthetic panorama whose colour encodes the view direction: red = azimuth, green = elevation.
    w, h = 720, 200
    az = np.arange(w) * 360 / w
    el = 10 - np.arange(h) * 100 / h  # top +10°, bottom −90°
    rgb = np.zeros((h, w, 3), np.float32)
    rgb[..., 0] = az[None, :]
    rgb[..., 1] = el[:, None]
    geometry = {
        "azimuthAtLeftDeg": 0.0,
        "direction": 1,
        "spanDeg": 360,
        "elevationDeg": {"top": 10.0, "bottom": -90.0},
        "tiltDeg": 0.0,
        "tiltTowardAzimuthDeg": 0.0,
    }
    monkeypatch.setattr(game, "_pano", lambda pid: (rgb, geometry))
    # A tiny patch 4 m due east of a camera 2 m up: azimuth 90°, elevation −atan(2/4) = −26.6°.
    out = game.ground_patch("x", (4.0, 0.0), 0.02, 3, camera_m=2.0)
    assert abs(out[1, 1, 0] - 90) < 1
    assert abs(out[1, 1, 1] - (-26.57)) < 0.6
