# Datasets: built artifacts, provenance and validation

The authoritative registry is [`data/catalog/datasets.json`](../data/catalog/datasets.json). It lists
mission, instrument, product, URL, dates, resolution, CRS, datum, uncertainty, license and citation
for each dataset. Every raw download writes a `*.provenance.json` next to the file, recording the
source URL, window, sha256, retrieval time and GDAL version. Raw and intermediate data are
gitignored and never committed.

## Source header checks (2026-09-25, `run.sh inspect`)

| Dataset | Size (px) | Type | Nodata | CRS (from file) | Result |
|---|---|---|---|---|---|
| USGS TRN HiRISE DTM 1 m | 21400 × 21488 | Float32 | −3.4028e38 | eqc lat_ts 0, lon_0 0, R 3396190 | OK |
| USGS TRN HiRISE ortho 25 cm | 85600 × 85952 | Byte | 0 | eqc lat_ts 0, R 3396190 | OK |
| JPL CTX DEM 20 m | 4456 × 5067 | Float32 | −3.4028e38 | eqc **lat_ts 18.4663**, R 3396190 | OK. Radius confirmed 3396190; the Astropedia page's 3396160 is wrong. |
| JPL CTX ortho 5 m | 17766 × 20234 | Byte | none (0 = background) | eqc lat_ts 18.4663 | OK |
| Viking colorized 925 m | 23059 × 11530 × 3 | Byte | 0 | eqc lat_ts 0 | OK |
| THEMIS TI (Edwards & Buz 2021) | 890 × 890 | Float32 | 0 | eqc lat_ts 0 | OK |

## Built artifacts

| Artifact | Contents | Size |
|---|---|---|
| `data/build/regions/jezero/` | 5 m routing grid, 2250 × 1424 cells, AOI 77.28–77.48°E, 18.40–18.52°N. Bands: elevation (int16, 0.05 m, areoid), fine-slope median and P90 (uint8, 0.25°), thermal inertia (uint8, ×4). Also `grid.json` (header + provenance) and `coverage.geojson`. | 16 MB |
| `data/build/tiles/terrain/` | Quantized-mesh on the R = 3,396,190 m sphere: MOLA z0–5, CTX z6–12, HiRISE z13–16 | 9,087 tiles, 72 MB |
| `data/build/tiles/imagery/viking` | Viking colorized, z0–5 | 2,730 tiles |
| `data/build/tiles/imagery/ctx` | CTX 5 m, crater, z6–13 | 7,656 tiles |
| `data/build/tiles/imagery/hirise` | HiRISE, read at 0.5 m, AOI z12–16 | built by `run.sh imagery` |
| `data/build/rover/` | Perseverance waypoints (703, sols 13–1980), traverse (556 drives), 22 sample sites, 73 Ingenuity flights | ~0.9 MB |
| `data/build/environment/meda.json` | Per-sol MEDA summaries, sols 1740–1859 (Release 16): 112 sols with data | 60 KB |
| `data/build/sky/stars.json` | Yale Bright Star Catalog (J2000), 8,404 stars with V ≤ 6.5, proper motion to 2026.75 | 246 KB |
| `data/build/sky/milkyway_4k.webp` | NASA SVS Deep Star Maps 2020 Milky Way background (no bright stars), ICRF plate carrée, asinh display stretch | 2.5 MB |

Grid statistics (from `grid.json`):
- 3,189,320 valid cells (79.7 km²).
- Elevation −2623.5 to −1783.6 m.
- 3.4 % of cells above 20° at the 10 m baseline; 4.6 % by the fine-scale median.
- Thermal-inertia coverage 100 %.

## Validation (`scripts/data/validate-grid.ts`, 2026-09-25)

**PLACES frame check.** For all 666 PDS PLACES localizations, easting/northing recomputed from
lat/lon in our Mars 2020 frame match to ≤ 0.5 mm.

**Grid vs PLACES elevation.** 509 localizations fall inside the grid.

| Statistic | Value |
|---|---|
| Mean | −0.01 m |
| RMS | 0.07 m |
| P05 / P95 | −0.12 / +0.10 m |

This is **not** an independent accuracy test: PLACES elevations are themselves derived from the
orbital DEM. It confirms that our reprojection, 5 m aggregation, datum and horizontal registration
are consistent with the mission's own localization frame.

**Guided Marswalk** (landing site → Three Forks → Wildcat Ridge → back to the start), both profiles
computed in 209 ms in Node:

| Profile | Distance | Gain / loss | Max slope | Duration | Walk-back |
|---|---|---|---|---|---|
| Lower-risk | 5.64 km | 74 / 74 m | 14.75° | 3.76 h | OK |
| Shortest | 5.60 km | 74 / 74 m | 18.25° | 3.74 h | OK |

The lower-risk route is 34 m longer and avoids 198 m of 15–20° slopes and 259 m of 10–15° slopes.

## Sky background validation

| Check | Result |
|---|---|
| Brightest catalogue entries | Sirius (RA 101.28°, Dec −16.73°, V −1.46, A), Canopus, Arcturus, α Cen, Vega at catalogue positions |
| Milky Way map orientation | Galactic centre ≈ RA 17.7 h, Dec −26°; LMC ≈ 5.3 h, −70°; SMC ≈ 0.9 h, −72° |
| ICRF → Mars-fixed rotation (IAU 2015) | Sun direction agrees with Mars24 to < 0.1°; the Mars pole maps to the body z-axis |
| Sky projection vs Cesium camera | Identical to 0.1 px at 4 test points |
| Sun angular diameter | True size from distance (0.31–0.39° over Mars's orbit) |

## MEDA summary (latest released sol)

Sol 1859 (Ls 137.3°), rover at −1,959 m (west of the rim):
- Mast air temperature (median of ATS 1–3): 189.1–252.6 K (−84 to −21 °C).
- Pressure: mean 736 Pa (716.6–750.9).

Across sols 1740–1859:
- Nightly lows −91 to −69 °C.
- Daily highs −49 to 0 °C.

These are local mast values that may include rover thermal influence.

## Known data issues and limitations

1. **Crater-rim stereo models.** The TRN "CR" crater-rim models have documented quality problems.
   Their footprints (CR_NORTH 77.223–77.335°E, CR_SOUTH 77.241–77.349°E) overlap the western part
   of the AOI. A per-pixel QA flag is **not yet implemented**; routes west of ~77.35°E should be
   read with extra caution.
2. **Lefroy Bay.** NASA's MMGIS sample file gives Lefroy Bay the same lat/lon as Pelican Point. The
   snapshot script detects the 370 m disagreement with the sample's own easting/northing and uses
   the latter.
3. **Rover position.** Perseverance (sol 1980) is west of the crater rim, outside the operational
   AOI. It is shown with a date, but routes cannot be planned to it.
4. **MEDA.** Released data lag observations by ~3–4 months, and ATS temperatures are local to the
   mast. There is no live weather.
5. **Thermal inertia.** The 100 m source is much coarser than the 5 m grid. It is used as a soft
   flag only.
6. **Reproducibility.** The GDAL image is pinned (`ghcr.io/osgeo/gdal:ubuntu-small-3.13.3` by digest).
7. **CTX holes.** The CTX ortho uses 0 as nodata, so a few fully shadowed pixels are transparent and
   show the Viking colour underneath as small specks.
8. **Rim terrain.** The MSR 1 m DTM is blended into the CTX DEM over 180 m at its box edges (it sits
   ~1.5 m higher on average, with up to ~5 m steps at the edges).

## 3D model: Perseverance rover

- **Source:** `25042_Perseverance.glb`, NASA 3D Resources (NASA/JPL-Caltech), supplied by the owner on 2026-10-02. Kept unmodified in `data/raw/models/` (gitignored).
- **Licence:** NASA media usage guidelines (UNVERIFIED for this specific file; NASA 3D Resources models are published for free public use).
- **Scale:** metres, glTF Y-up. Assembled extent 2.70 × 2.23 × 4.11 m (the length includes the robotic arm), consistent with the published 3.0 × 2.7 × 2.2 m rover size.
- **Build:** glTF-Transform `optimize` (WebP textures at 1024 px, meshopt geometry): 11.7 MB → 2.3 MB. Command in the README.
- **Placement:** at the latest published MMGIS position (sol 1980), on the rendered terrain, facing along the last drive segment. It is drawn at true scale up close; from far away it is enlarged to stay at least 44 px tall and hidden beyond 40 km.

## Real surface photos: Mastcam-Z 360° panoramas

- **Sources:** 11 natural-colour mosaics from the ASU Mastcam-Z 360° collection (#1, #3, #8, #20, #21, #23, #25, #37, #39, #41, #42) plus Photojournal PIA26699 (“Crocodile Bridge”). Free public use with credit NASA/JPL-Caltech/ASU/MSSS. Originals (113–477 MB each) stay in `data/raw/panoramas` with sha256 in `data/catalog/panoramas.json`; the app ships 8192 px WebPs (≈2–3 MB each).
- **Placement:** the MMGIS waypoint of the first sol of each mosaic (`scripts/data/fetch-panoramas.ts`). Several match the curated POIs exactly (Rochette, Comet Geyser, Witch Hazel Hill), a useful cross-check.
- **Measured geometry** (`scripts/geospatial/run.sh panoramas`): the skyline is traced on a 0.05°/px copy and matched to the horizon computed from our terrain (1 m HiRISE/MSR, 20 m CTX, MOLA; Mars sphere curvature) from the Mastcam-Z position (ground + 2 m). Fitted per mosaic: compass azimuth of the left edge, column direction, vertical scale, horizon row and mast tilt. Results for the 10 panoramas shown: median residual 0.021–0.080°, vertical scale 0.96–1.01 (the mosaics are equal-angle cylinders, as assumed). Diagnostic overlays: `data/work/panoramas/*_skyline.png`.
- **Excluded:** Bunsen Peak (median residual 0.24°, vertical scale 0.93: not trustworthy) and Lookout Hill (#41, a Gigapan mosaic with no plausible fit; its projection is not a simple equal-angle cylinder).
- **Unimaged areas:** 2–32 % of each mosaic (all at the bottom) is the rover's own body, which the published mosaics leave black. The pipeline fills it smoothly from the surrounding ground (push-pull, no detail added, darkened with depth) and writes `panoramas/<id>_mask.png`; `geometry.unimagedFraction` records the share, and the viewer can hatch exactly those areas.
- **In the app:** places within 8 km (and other panoramas within 6 km) are labelled at their true direction and elevation, dimmed when terrain hides them (line of sight sampled on the rendered terrain); panoramas link to each other.
