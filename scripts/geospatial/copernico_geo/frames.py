"""Mars reference frames. Mirrors packages/domain/src/geo (same constants, same conventions)."""
from __future__ import annotations

import math
from dataclasses import dataclass

from osgeo import osr

MARS_R = 3_396_190.0  # IAU 2015 Mars reference sphere (IAU_2015:49900), m
M2020_LAT_TS = 18.4663  # Mars 2020 rover localization frame standard parallel, deg

osr.UseExceptions()


def _srs(user_input: str) -> osr.SpatialReference:
    s = osr.SpatialReference()
    s.SetFromUserInput(user_input)
    s.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    return s


def geographic_srs() -> osr.SpatialReference:
    """Planetocentric, east-positive lat/lon on the Mars sphere."""
    return _srs("IAU_2015:49900")


def local_srs() -> osr.SpatialReference:
    """Mars 2020 frame: IAU_2015:49910 (eqc on the sphere) with lat_ts = 18.4663°."""
    s = _srs("IAU_2015:49910")
    s.SetProjParm(osr.SRS_PP_STANDARD_PARALLEL_1, M2020_LAT_TS)
    return s


def eqc_forward(lat: float, lon: float, lat_ts: float = M2020_LAT_TS) -> tuple[float, float]:
    lon180 = ((lon + 180.0) % 360.0) - 180.0
    return (
        MARS_R * math.radians(lon180) * math.cos(math.radians(lat_ts)),
        MARS_R * math.radians(lat),
    )


def eqc_inverse(x: float, y: float, lat_ts: float = M2020_LAT_TS) -> tuple[float, float]:
    lat = math.degrees(y / MARS_R)
    lon = math.degrees(x / (MARS_R * math.cos(math.radians(lat_ts))))
    return lat, lon % 360.0


@dataclass(frozen=True)
class BBox:
    west: float
    south: float
    east: float
    north: float


# Operational area v1 (docs/PLAN.md §4.4). The final valid area is the DTM valid mask inside it.
JEZERO_AOI = BBox(west=77.28, south=18.40, east=77.48, north=18.52)
ROUTING_CELL_M = 5.0
