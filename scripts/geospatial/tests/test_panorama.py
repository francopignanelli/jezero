"""Panorama geometry: the skyline fit must recover a known compass offset, direction,
vertical scale, horizon row and tilt from a synthetic skyline."""
import math

import numpy as np

from copernico_geo.panorama import COLS, DEG_PX, fit


def synthetic_horizon() -> np.ndarray:
    """A terrain horizon with distinct features (ridges at several scales), degrees per azimuth step."""
    az = np.arange(COLS) * DEG_PX
    return (1.2 * np.exp(-(((az - 40) / 12) ** 2)) + 0.7 * np.exp(-(((az - 200) / 5) ** 2))
            + 0.4 * np.sin(np.radians(az) * 3) + 0.15 * np.cos(np.radians(az) * 11))


def skyline_rows(horizon, az0, direction, scale, horizon_row, tilt, tilt_toward, span=360.0):
    c = np.arange(COLS)
    idx = np.round(az0 / DEG_PX + direction * c * span / 360).astype(int) % COLS
    az = np.radians(idx * DEG_PX)
    photo = horizon[idx] + tilt * np.cos(az - math.radians(tilt_toward))  # photo = true + tilt
    return horizon_row - photo / (scale * DEG_PX)


def test_fit_recovers_the_viewing_geometry():
    horizon = synthetic_horizon()
    rows = skyline_rows(horizon, az0=123.45, direction=1, scale=0.97, horizon_row=180.0, tilt=0.3, tilt_toward=40)
    outliers = np.random.default_rng(7).choice(COLS, COLS // 50, replace=False)
    rows[outliers] += 25  # rover hardware in front of the skyline on 2 % of the columns (random)
    f = fit(rows, horizon)
    assert f["direction"] == 1
    assert abs(f["azimuthAtLeftDeg"] - 123.45) <= DEG_PX
    assert abs(f["verticalScale"] - 0.97) < 0.01
    assert abs(f["horizonRow"] - 180.0) < 1.0
    assert abs(f["tiltDeg"] - 0.3) < 0.03
    assert abs((f["tiltTowardAzimuthDeg"] - 40 + 180) % 360 - 180) < 5
    assert f["medianResidualDeg"] < 0.01


def test_fit_finds_a_mirrored_mosaic():
    horizon = synthetic_horizon()
    rows = skyline_rows(horizon, az0=300.0, direction=-1, scale=1.0, horizon_row=150.0, tilt=0.0, tilt_toward=0)
    f = fit(rows, horizon)
    assert f["direction"] == -1
    assert abs(f["azimuthAtLeftDeg"] - 300.0) <= DEG_PX


def test_fill_unimaged_fills_big_black_holes_smoothly_and_keeps_real_pixels():
    from copernico_geo.panorama import fill_unimaged

    h, w = 120, 400
    rgb = np.empty((3, h, w), dtype=np.float32)
    rgb[0], rgb[1], rgb[2] = 150.0, 100.0, 65.0  # ground
    rgb[:, 80:, 100:220] = 0.0  # big unimaged block (rover body)
    rgb[:, 20:22, 300:302] = 5.0  # a tiny dark speck (a real shadow): must stay as it is
    filled, hole = fill_unimaged(rgb)
    assert hole[100, 160] and not hole[21, 301] and not hole[10, 10]
    assert np.allclose(filled[:, 10, 10], [150, 100, 65], atol=0.5)  # real pixels untouched
    assert np.allclose(filled[:, 21, 301], 5.0, atol=0.5)
    inside = filled[:, 82, 160]
    assert inside.min() > 40  # no black left: filled from the surroundings
    assert inside[0] > inside[1] > inside[2]  # keeps the warm ground hue
