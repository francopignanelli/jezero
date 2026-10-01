# Research: terrain, imagery and surface-property datasets (Jezero)

Researched 2026-09-25 from official sources. **UNVERIFIED** marks anything not confirmed from an official source. No large files were downloaded; only file headers and labels were read.

## High-resolution terrain

| Dataset (mission/instrument) | Grid and extent | CRS and datum | Size and format | Uncertainty | Access and license |
|---|---|---|---|---|---|
| **USGS Mars 2020 TRN HiRISE DTM mosaic** `JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif` (MRO/HiRISE, 7 stereo models; published 2020-07-24; DOI 10.5066/P9REJ9JN) | 1 m, 21400×21488, Float32. Extent 77.2229–77.5840°E, 18.3068–18.6693°N. Values −2659.8 to −1942.1 m | Equirectangular, lat_ts 0, lon_0 0, sphere R = 3,396,190 m (≡ IAU_2015:49910). Heights relative to the areoid. NoData −3.40282265508890445e+38 | 1.84 GB, uncompressed stripped GeoTIFF (not a COG; HTTP range reads work) | Median 0.4 m below the CTX DTM. HiRISE co-registration < 3 m (P99), mostly < 1.1 m. The "CR" crater-rim model has quality problems | `planetarymaps.usgs.gov/mosaic/mars2020_trn/HiRISE/`, mirrored on the `asc-pds-services` S3 bucket. No constraints; cite Fergason et al. 2020 (LPSC #2020) |
| TRN HiRISE ortho `JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first.tif` (DOI 10.5066/P9QJDP48) | 0.25 m, 85600×85952, 8-bit | Same as the DTM | 7.36 GB (`_dd` variant 9.8 GB). A 3.4 GB `soc_007…blend120` "Surface Operations" version also exists; its projection is UNVERIFIED | — | Same |
| TRN CTX DTM `JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0.tif` (MRO/CTX; DOI 10.5066/P906QQT8) | 20 m, 1596×1512. Extent 77.1605–77.6990°E, 18.2110–18.7212°N | lat_ts 0, sphere | 9.7 MB | Pairs agree to 3.8 m after a **183.3 m shift to the ESA HRSC Level-5 DTM**. Horizontal error 9.6 m. CTX 6 m ortho: 36 MB (DOI 10.5066/P9GV1ND3) | Same |
| JPL Science Investigation CTX DEM `M20_JezeroCrater_CTXDEM_20m.tif` (+ 5 m ortho, 360 MB) | 20 m, 4456×5067. Extent 76.997–78.583°E, 17.581–19.290°N | **lat_ts 18.4663**, lon_0 0, sphere. The Astropedia page says R = 3,396,160 m but the PDS4 label says 3,396,190 m; check the file. NoData −3.4028234663852886e+38 | 90 MB | "Accurate to control net" | S3 `CTX/ScienceInvestigationMaps_JPL/`. Cite Mangold et al. 2021 (Science) |
| MSR TRN HiRISE mosaics v003 (Bland et al.; DOI 10.5066/P13CPYYU; 2025-02-28) | 1 m DTM, 0.25 m ortho, and figure-of-merit (FOM) confidence rasters. Extent 77.057–77.380°E, 18.135–18.588°N (western rim and fan) | lat_ts 0, sphere | 5.47 GB zip (mosaics); 13.6 GB (strips) | Vertical < 2.3 m (P99) except on the rim. Horizontal < 0.9 m | S3 `mosaic/Mars/MSR_TRN_HiRISE_soc_003_USGS_release_aug2024/`. Please cite |
| PDS PLACES `m20_orbital_dem` (label v16.0) | 1 m, 14800×5480. Extent 77.2089–77.4722°E, 18.4158–18.5082°N | eqc sp 18.4663, lon_0 0, R 3396.19 km | 325 MB `.img`: PDS3 and VICAR headers (118,400 B), then big-endian Float32 | Label only says "derived from MRO HiRISE and CTX". **Source DTMs and nodata UNVERIFIED** | pds-geosciences.wustl.edu/m2020/urn-nasa-pds-mars2020_rover_places/data_maps/ |
| University of Arizona HiRISE DTMs (PDS) | 1 m. DTEEC_002387_1985_003798_1985_A01 (delta, 320 MB); 045994/046060 (381 MB); 048842/048908 (411 MB); 023524/023379 (700 MB); 023247/022957 (642 MB); 022680/022746 | **Local radius 3394.84 km, center lat 15°, lon 77.53°** (differs from the USGS mosaics) | PDS3 `.IMG`. Also available as COGs reprojected to 49910 via USGS STAC `mro_hirise_socet_dtms` (CORS open) | Vertical "tens of cm" | Public domain; credit NASA/JPL/UArizona |
| USGS CTX DTM STAC `mro_ctx_controlled_usgs_dtms` | 20 m COGs. 52 items intersect Jezero. NoData −32767. Heights above the areoid | — | COG | 3–5 m | CC0 |

**STAC catalog flaws:**
- HiRISE items carry a placeholder `datetime` of 2006-09-29.
- The provenance file lists `-ot UInt16` for the DTM, but the file is actually Float32.

## Vertical datum ("DeltaGeoid")

- The MSR README defines `MOLATopography_DeltaGeoid` as heights relative to the Mars areoid, computed with ASP `dem_geoid`. "Delta radius" products are instead relative to the 3,396,190 m sphere.
- The TRN CTX FGDC XML says the heights are relative to the IAU sphere. **The values contradict it**:
  - At Jezero the areoid radius is 3,394,502 m, i.e. 1,688 m below the sphere.
  - The crater floor in MEGDR is −2,568 to −2,588 m, the same range as the TRN, UA and PLACES products.
  - If the heights were relative to the sphere, the floor would read about −4.26 km.
- **Conclusion:** MEGDR, the USGS MOLA DEMs, UA HiRISE, TRN, MSR, CTX STAC and PLACES all use areoid heights.
- **Areoid model versions differ:** the MEGDR label cites GMM3 (mgm1025, degree 50), while the USGS 463 m page cites GMM-2B. The size of the difference is UNVERIFIED.

## Global context

| Dataset | Specs | License |
|---|---|---|
| MOLA MEGDR (MGS) | 4–128 ppd. Radius minus areoid. Grid radius 3396.0 km, lon 0–360 | NASA PDS |
| USGS MOLA DEM 463 m v2 | 2 GB, 16-bit, areoid | CC0 |
| MOLA–HRSC blended 200 m v2 (2018) | 11 GB. HRSC covers 44 %. ±3 m | MOLA CC0 + **HRSC CC BY-SA 3.0 IGO (ESA)** |
| Viking MDIM 2.1 colorized 232 m (2009) | 12 GB. Accuracy ~200 m (RMS 300 m) | Public domain |
| MOLA color shaded relief 463 m | 1 GB | Public domain |
| THEMIS Day IR global 100 m v12 (Odyssey) | 21 GB, not quantitative. Controlled quads as CC0 COGs; MC-13 covers Jezero | Public domain; please cite |
| Murray Lab CTX mosaic V01 (MRO) | 5 m. Tile E076_N16, 1.81 GB. Absolute error < 200 m. Semi-controlled to THEMIS | **No data license stated** (the paper itself is CC BY-NC-ND) |

Streaming option: NASA Mars Trek WMTS serves Viking, MOLA, CTX and THEMIS layers as JPEG with CORS `*`, on a 2×1 lon/lat grid. Its terms of use are UNVERIFIED.

## Surface properties and science layers

- **Edwards & Buz 2021 THEMIS thermal inertia, Jezero** (Zenodo 10.5281/zenodo.4931348, CC BY 4.0). 1.7 MB GeoTIFF, 890×890 at 100 m, Float32, NoData 0, units J m⁻² K⁻¹ s⁻½. Extent 77.00–78.50°E, 17.75–19.25°N. Uses TES albedo.
- **THEMIS quantitative TI tile 00N060E** (2014). About 20 % absolute accuracy. 2.53 GB. Public domain.
- **CRISM MTRDR** (MRO; PDS mrocr_4001).
  - Observations over Jezero: HRL000040FF, FRT000047A3, FRT00005850, FRT00005C5E, FRT000066A4, FRT0001ECBA, FRT0001FB74, FRT00021DA6.
  - FRT000047A3: 18 m/px, 847×808, 77.376–77.642°E, 18.443–18.688°N, 60 summary parameters (164 MB). Labeled browse PNGs are 0.4–1 MB.
  - Projection uses a local radius of 3394.84 km with center latitude 15°.
- **CRISM Jezero false-color mosaic** (Seelos; used in Stack et al. 2020). `data.nasa.gov/docs/datasets/public/CRISM-Mosaic/jezero_crater_mosaic_SET_OPT_TAN_rect_flightCTX.tif`, 6.1 MB, 18 m. Metadata and license UNVERIFIED.
- **USGS SIM 3464 geologic map** (Sun & Stack 2020; 1:75,000; 76.8–77.8°E, 17.7–18.7°N). 333 MB GIS package in Mars Transverse Mercator (CM 77.5°E). **100–200 m offset** relative to the surface-operations CTX mosaic.
- **Stack et al. 2020 photogeologic map** (1:5000; MOESM3_ESM.zip, 3.3 MB). About 4,700 polygons, in the TRN projection. **The article is CC BY 4.0, but the README inside the zip says "All rights reserved".**
- **Slope product** `J03_045994_1986_J03_046060_1986_20m_slope_20m.tif` (42 MB, public domain, 2017).
- **Rock abundance and hazard rasters for Jezero:** none found for download. The TRN hazard map is not public. MBARS boulder data is UNVERIFIED.

## Overlap

- **Fully contain the TRN HiRISE extent:** the CTX DTMs, both thermal-inertia products, the CRISM mosaic footprint, and SIM 3464.
- **Partial:** the CRISM MTRDRs (FRT000047A3 covers the NE delta). The MSR mosaic shares 77.22–77.38°E.
- **UNVERIFIED:** internal gaps in CRISM coverage.

## PROJ / GDAL

- PROJ 8.2.0 added the IAU_2015 CRSs. Relevant Mars codes:

  | Code | Definition |
  |---|---|
  | 49900 | Sphere, planetocentric, R = 3,396,190 m |
  | 49901 | Ellipsoid, planetographic, **west-positive** |
  | 49902 | Ellipsoid, planetocentric |
  | 49910 / 49911 | Equirectangular on the sphere, clon 0 / 180 |

- **Which files use which definition:**
  - USGS STAC COGs declare 49910.
  - The TRN, MSR, Stack and Zenodo files are equivalent to it but use unnamed WKT1.
  - The JPL CTX DEM and the PLACES DEM need `+proj=eqc +lat_ts=18.4663 +lon_0=0 +R=3396190`.
  - UA HiRISE and CRISM use local-radius definitions.
- **Always read each file's own CRS.**
- No areoid vertical CRS was found in PROJ (UNVERIFIED), so the vertical datum is tracked in metadata.

## Missions represented

MGS (MOLA; TES albedo inside the TI product), Mars Odyssey (THEMIS), MRO (HiRISE, CTX, CRISM), Viking Orbiters 1 and 2. ESA Mars Express HRSC is not NASA. It is the absolute reference for the TRN CTX DTM, and therefore also for the TRN HiRISE mosaic.

## URLs read

- **astrogeology.usgs.gov/search/map/…:** `Mars/Mars2020/JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40`, `mars_mgs_mola_mex_hrsc_blended_dem_global_200m`, `mars_mgs_mola_dem_463m`, `mars_viking_colorized_global_mosaic_232m`, `mars_odyssey_themis_ir_day_global_mosaic_100m_v12`, `mars_mgs_mola_global_color_shaded_relief_463m`, `themis_thermal_inertia_mosaic_quantitative_00n060e_100mpp`, `mars-themis-derived-global-thermal-inertia-mosaic`, `mars-mro-ctx-global-mosaic-murray-lab-v1`, `mars-2020-jezero-crater-landing-site-products`, `mars-sample-return-terrain-relative-navigation-hirise-dtm-mosaic`, `topographic_slopes_of_mars_2020_landing_site_jezero_west`, `mars_2020_science_investigation_ctx_dem_mosaic`
- **asc-pds-services.s3.us-west-2.amazonaws.com:** `mosaic/` listings, `mars2020_trn` `.lbl`/`.xml`, the MSR `README.md`
- **stac.astrogeology.usgs.gov:** `/api` (collections, search, items), `/docs/data/mars/ctxdtms/`
- **HiRISE:** hirise-pds.lpl.arizona.edu/PDS/INDEX/DTMCUMINDEX.TAB; uahirise.org/dtm/, /dtm/about.php, /media/usage.php
- **pds-geosciences.wustl.edu:** missions/mgs/megdr.html, the MEGDR meg016 labels, CRISM mrocr_4001, the PLACES `data_maps`
- **oderest.rsl.wustl.edu:** CRISM MTRDR query
- **murray-lab.caltech.edu/CTX/**
- **pds.nasa.gov:** DOI 10.17189/m23v-ae12
- **zenodo.org/api/records/4931348**
- **data.nasa.gov:** CRISM-Mosaic headers
- **pubs.usgs.gov:** /publication/sim3464, /sim/3464/
- **Papers:** pmc.ncbi.nlm.nih.gov/articles/PMC7116714/; link.springer.com/article/10.1007/s11214-020-00739-x
- **LPSC abstracts:** hou.usra.edu/meetings/lpsc2020/pdf/2020.pdf, lpsc2025/pdf/1659.pdf
- **PROJ:** raw.githubusercontent.com/OSGeo/PROJ/master/NEWS.md
- **Trek:** trek.nasa.gov WMTS capabilities
