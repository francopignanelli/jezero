# Research: Perseverance position, environment data, time and astronomy, POIs

Researched 2026-09-25. **UNVERIFIED** marks anything not confirmed from an official source.

## A. Perseverance position and traverse

**MMGIS JSON** (the source behind NASA's "Where is Perseverance" map; layer config at `https://mars.nasa.gov/maps/location/api/configure/get?mission=M20`):

| File (base `https://mars.nasa.gov/mmgis-maps/M20/Layers/json/`) | Contents | Last-Modified |
|---|---|---|
| `M20_waypoints_current.json` | 1 point, sol 1980 | 2026-09-15 |
| `M20_waypoints.json` (600 KB) | 703 points, sols 13–1980 | 2026-09-15 |
| `M20_traverse.json` (1.7 MB) | 556 LineStrings (sol, fromRMC/toRMC, length, SCLK) | 2026-09-15 |
| `M20_SAMPLE_v3.json` | 22 features (samples 1–30) | 2026-01-23 |
| `M20_TF_Sample_Depot.json` | Three Forks depot polygon | 2022-12-20 |
| `m20_heli_waypoints*.json`, `m20_heli_flight_path.json` | Ingenuity, to flight 72 (sol 1036) | 2026-05-11 |

- **Waypoint fields:** RMC, site, drive, sol, easting, northing, elev_geoid, lon, lat, roll/pitch/yaw, tilt, dist_m, dist_total_m, final, Note, panorama URL.
- **Frame:**
  - lat/lon are planetocentric, °E. They match PLACES exactly.
  - Easting/northing are equirectangular on R = 3,396,190 m with standard parallel 18.4663°: x = R·λ·cos(18.4663°), y = R·φ.
  - The declared `CRS84` is an Earth placeholder; ignore it.
- **CORS (conflicting reports):** one check found GET returns `Access-Control-Allow-Origin: *` and OPTIONS returns 403; another found no CORS header on `M20_waypoints.json`. **Snapshot at build time.**
- **Cadence:** irregular, about 10 sols behind (current sol ≈ 1990). Usage terms UNVERIFIED (normal NASA media guidance presumably applies).
- **Data bugs:**
  - Lefroy Bay's lat/lon is copied from Pelican Point. Its easting/northing gives 18.48867°N, 77.34705°E.
  - Gallants has sol "TBD".

**PDS PLACES** (`urn:nasa:pds:mars2020_rover_places`):
- Release 16 (2026-08-11) covers sols 0–1897 (to 2026-06-21). Releases come roughly every 4 months, with about 2 months of latency.
- `data_localizations/` contains `best_interp.csv`, `best_tactical.csv` (171 KB, 666 rows) and `telemetry.csv`, each with a PDS4 label.
- The `planetodetic_latitude` column is constant (18.3462), so it is unusable.
- No CORS headers.
- `data_maps/m20_orbital_dem.img`: 1 m, 325 MB, eqc sp 18.4663, 77.2089–77.4722°E, 18.4158–18.5082°N.

**Current position:**
- Sol 1980 (≈2026-09-14): **18.43687°N, 77.23205°E, −1930 m**.
- That is west of the rim crest, outside the crater floor: about 2.1 km west of the Gazetteer's westmost crater boundary (77.27°E) and about 640 m higher than the landing site (−2570 m).
- Traverse milestones:
  - Rim top at Lookout Hill on sol 1354 (2024-12-12), 77.2685°E, −1786 m.
  - Lac de Charmes selfie on sol 1797 (2026-03-11).
  - Arbot on sol 1890, the westmost point (77.2179°E).
  - Since then, about 0.95 km back to the east.
- **Relation to HiRISE coverage:** the point lies inside the TRN HiRISE DTM rectangle, but the ortho tiles are empty west of about 77.245–77.256°E at this latitude. So the rover is about 0.7 km outside valid data (DTM validity inferred, not read directly).
- **Terrain that does cover it:** CTX DTM, the PLACES DEM, the MSR HiRISE v003 mosaic, the MMGIS basemap.

## B. Environment

**MEDA on PDS** (Atmospheres node, `https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/`):
- Processing levels: raw, partially processed, calibrated, derived. One CSV per sensor per sol, each with a PDS4 label.
- Calibrated sensors: ATS (air temperature), PS (pressure), RHS (humidity), TIRS (ground/air IR, albedo), RDS (radiation/dust), ENG.
- Derived: PS, RHS, TIRS, ANCILLARY (sun position, rover pose at 1 s).
- **No wind after sol 315** (sensor damaged).
- **Latest: Release 16 (2026-08-11), sols 1740–1859, to 2026-05-13.** Releases about every 4 months, 3 months of latency. Next release expected around December 2026 (UNVERIFIED).
- License: none stated; NASA public data, so cite it. No CORS headers.

**Feeds and other sources:**

| Source | Status | Relevance to Jezero |
|---|---|---|
| MEDA JSON feed `https://mars.nasa.gov/rss/api/?feed=weather&category=mars2020&feedtype=json` | Only 7 sols (1127–1133, 2024-04-21..27). **Stale.** The old `mars.nasa.gov/mars2020/weather/` page redirects | — |
| Curiosity REMS feed | Latest sol 4995 (2026-08-25), marked "outreach purposes only" | Gale Crater, ~3,750 km away |
| InSight feed | Frozen at sol 681 (2020-10-26) | Elysium, ~3,460 km away |

**Model sources:**
- **Mars Climate Database v6.1** (LMD, funded by ESA/CNES): not NASA. It requires registration and forbids redistribution to third parties. **Do not bundle.**
- **NASA Ames Mars GCM** (`data.nas.nasa.gov/mcmc/`, NetCDF) + AmesCAP (MIT, Python): feasible to process an offline Jezero slice. Data license UNVERIFIED.
- **MRO MCS DDR v6.2:** runs through 2025-07-31. Too heavy for this project.

**Radiation:** MEDA RDS measures sunlight and dust (UV, visible, near-IR), **not ionizing radiation**. Only RAD on Curiosity at Gale measures dose. Carrying Gale values over to Jezero would be a modeled estimate at best.

## C. Time and astronomy

**Mars24 algorithm** (`https://www.giss.nasa.gov/tools/mars24/help/algorithm.html`, updated 2025-01-07):
- Steps A-1 to D-6 give MSD, MTC, LMST, LTST, Ls, subsolar longitude, solar declination, heliocentric distance, and local solar elevation and azimuth.
- Two worked examples are included.
- Uses planetographic longitude in °W (Jezero = 282.55°W) and planetographic latitude (18.4446°c → 18.649°g).
- Needs a TT−UTC leap-second table.
- Accuracy (Allison & McEwen 2000): Ls ~0.01°; mean solar time to about 0.1 s; valid 1874–2127.

**Mars 2020 sols** (NAIF `m2020_lmst_ops210303_v1.tsc`):
- Sol 0 midnight LMST = **2021-02-18T04:24:15.8058 UTC**; 1 sol = **88,775.244 s**.
- Uses the target longitude 77.4298°E (the actual landing longitude 77.45089°E differs by about 5 s).
- JS: `sol = floor((Date.now() − Date.UTC(2021,1,18,4,24,15,806)) / 88775244)`.

**TimeCraftJS** (`timecraftjs` v2.0.0): CSPICE in WASM, about 100 MB of memory (20 MB for the lite build). **License conflict:** npm says Apache-2.0, the repo says Caltech "all rights reserved", plus export control. Not used.

**Star catalogs:**
- Yale BSC5: 9,110 stars (V ≤ ~7). CfA/VizieR V/50, NASA HEASARC BSC5P. No explicit license; cite it.
- HYG v4.4: 119,614 stars, CC BY-SA 4.0 (share-alike).
- Hipparcos I/239.

**Mars pole (IAU WGCCRE 2015, Archinal et al. 2018):**
- α₀ = 317.269202 − 0.10927547 T (+ periodic terms)
- δ₀ = 54.432516 − 0.05827105 T (+ periodic terms)
- W = 176.049863 + 350.891982443297 d (+ periodic terms)

These values come from the astronomy-engine source (MIT), whose `RotationAxis(Body.Mars, t)` implements the 2015 report. The WGCCRE PDF itself could not be opened.

## D. Points of interest (planetocentric °N/°E, Mars 2020 frame)

"Waypoint" = the rover's position on the sol NASA names, so it is approximate for the feature itself.

| POI | Lat, Lon | Why interesting | Source |
|---|---|---|---|
| Octavia E. Butler landing (SITE 1) | 18.44457, 77.45091 (−2570 m) | Landing site; samples 8–9 | PLACES best_tactical |
| Máaz – Rochette/Artuby Ridge | 18.43073, 77.44433 | First cores; igneous crater floor | M20_SAMPLE_v3 |
| Séítah South – Brac | 18.43398, 77.44305 | Olivine-rich igneous cores | M20_SAMPLE_v3 |
| Enchanted Lake | ≈18.4506, 77.4014 (waypoint, sol 422) | First close look at delta-base sediments | NASA |
| Hawksbill Gap – Wildcat Ridge | 18.45864, 77.40589 | Delta-front mudstone with organics | M20_SAMPLE_v3 |
| Three Forks depot | centroid 18.45296, 77.40821 | 10 sample tubes left on the surface | M20_TF_Sample_Depot |
| Belva crater | ≈18.4829, 77.3690 (waypoint, sol 770) | Crater walls expose delta layers | NASA/JPL |
| Comet Geyser (Margin unit) | 18.49187, 77.32722 | Silica-cemented carbonate | M20_SAMPLE_v3 |
| Ingenuity final position | 18.49727, 77.32253 | Flight 72, sol 1036 | m20_heli_waypoints |
| Cheyava Falls / Sapphire Canyon (Bright Angel) | 18.49747, 77.30515 | Potential biosignature (Nature 2025) | M20_SAMPLE_v3; NASA 2025-09 |
| Neretva Vallis | 18.55, 77.20 (Gazetteer center) | River valley that fed the delta | USGS Gazetteer |
| Lookout Hill | ≈18.4575, 77.2685 (sol 1354) | Highest point on the traverse | JPL 2024-12-12 |
| Witch Hazel Hill – Silver Mountain | 18.46059, 77.26474 | Oldest rock sampled; serpentinite | M20_SAMPLE_v3 |
| Krokodillen – Gallants | 18.46088, 77.25723 | Rim sample 30 | M20_SAMPLE_v3 |
| Lac de Charmes | ≈18.4277, 77.2267 (sol 1792) | Crust that predates the crater | JPL 2026-05-12 |
| Arbot | 18.42813, 77.21790 (sol 1890) | Westmost point | NASA 2026-06-13 |

## Latency summary

| Source | Latency |
|---|---|
| MMGIS | ~0–10 sols |
| PLACES | ~2–3 months |
| MEDA on PDS | ~3–4 months |
| MEDA feed | Stuck at April 2024 |
| MCS | Through July 2025 |

**No source provides live weather for Jezero.**

## URLs read

- **mars.nasa.gov:**
  - mmgis-maps/M20/Layers/json/* (the files above)
  - maps/location/api/configure/get?mission=M20
  - rss/api weather feeds
- **science.nasa.gov:**
  - mission/mars-2020-perseverance/location-map/
  - mission/mars-2020-perseverance/mars-rock-samples/
  - photojournal pages
- **jpl.nasa.gov news:**
  - western frontier selfie
  - top of Jezero rim
- **pds-geosciences.wustl.edu:**
  - missions/mars2020/places.htm
  - PLACES bundle directories
- **pds-atmospheres.nmsu.edu:** MEDA and MCS pages
- **atmos.nmsu.edu:** MEDA readme, release notes, sol_1859
- **Mars Climate Database (www-mars.lmd.jussieu.fr):**
  - mars/access.html
  - MCD_pro
- **NASA Ames GCM:** data.nas.nasa.gov/mcmc/, github.com/NASA-Planetary-Science/AmesCAP
- **RAD (Curiosity):** pds-ppi.igpp.ucla.edu MSL/RAD
- **Mars24 and time:**
  - giss.nasa.gov/tools/mars24/help/algorithm.html
  - ntrs.nasa.gov/citations/20000097895
  - NAIF m2020 SCLK kernel directory
  - github.com/NASA-AMMOS/timecraftjs
- **astronomy-engine:** raw.githubusercontent.com/cosinekitty/astronomy (README, astronomy.ts)
- **Star catalogs:**
  - tdc-www.harvard.edu/catalogs/bsc5.html
  - heasarc.gsfc.nasa.gov BSC5P
  - codeberg.org/astronexus/hyg
- **USGS Gazetteer:** planetarynames.wr.usgs.gov/Feature/14300 and /15879
- **NASA-PDS operations:** github.com/NASA-PDS/operations/issues/1430
