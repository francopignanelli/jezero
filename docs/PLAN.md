# Copernico — Implementation Plan

**Status:** draft v1 · 2026-09-25 · mode **PLAN_ONLY**: no application code, infrastructure, deployment, or Gemini calls have been made.
**Evidence:** detailed research notes with every source URL are in [`docs/research/`](research/). Anything marked **UNVERIFIED** could not be confirmed from an official source and must be checked before it is relied on.

---

## 0. Critical findings (read first)

| # | Finding | Consequence | Plan response |
|---|---|---|---|
| F1 | The Space Apps FAQ says *"Teams are not allowed to begin working on the challenges prior to the hackathon."* The Team Formation Guide says participants *"should NOT begin working on their project until the hackathon begins on November 14, 2026 (9:00 a.m. local time)."* | Building Copernico now and then submitting it to Space Apps 2026 conflicts with the official rules, which risks its eligibility. On 2026-09-25 the owner decided to continue. | Before authorizing implementation, get written confirmation from the Space Apps Global Organizing Team (spaceappschallenge.org/contact-us), or treat Copernico as independent of any Space Apps submission. §8.4 gives a scope cut that fits the hackathon window. |
| F2 | Only the challenge **summary** has been published. The full challenge statements (resources, requirements) come out on **2026-10-28**. | The requirement matrix in §2 is provisional. | Gate **G1**: re-read the full statement on 10-28 and update §2. |
| F3 | Space Apps T&C: original content must be released under an OSI license (Apache-2.0 by default). Third-party materials must be openly licensed, cited, and their licenses documented. | Excluded: Mars Climate Database (no redistribution), Cesium ion content (ToS), the Stack et al. 2020 photogeologic map (its README says "All rights reserved"), and the Murray Lab CTX mosaic (no data license stated). | Each catalog entry carries a license field. A dataset with an unclear license is never shipped. |
| F4 | On sol 1980 (≈2026-09-14) Perseverance was at 18.43687°N 77.23205°E. That is west of the crater rim, about 0.7 km outside the valid data of the USGS HiRISE mosaic. | The rover's current position can be shown on the map but not routed to in v1. | Show it labeled "outside route-planning coverage". The western rim becomes the first extension region (§4.2). |
| F5 | The USGS Mars 2020 TRN HiRISE DTM uses an Equirectangular projection with **lat_ts = 0** on a sphere of R = 3,396,190 m. | Treating its x coordinates as metres at Jezero overstates east-west distances by 1/cos 18.44° = **+5.4 %**. | Reproject every raster to the local metric frame (§6.1) and cover this with a unit test. |
| F6 | No source gives live weather for Jezero. The latest MEDA release on PDS covers sols 1740–1859 (to 2026-05-13) and was released 2026-08-11. NASA's MEDA JSON feed stopped at sol 1133 (April 2024). MEDA has no wind data after sol 315. | "Current conditions" can only mean the latest available observations plus calculated time and season, each with its date. | Environment UI classes (§6.9). Assistant behavior. |
| F7 | Since 2026-09-18, `gemini-2.5-flash-lite` is restricted to projects that already used it. The cheapest stable model open to new projects is **`gemini-3.1-flash-lite`**: $0.25 input / $1.50 output per 1M tokens, earliest shutdown 2027-05-07. The paid tier needs a **$5 prepay** that expires after 12 months. Gemini terms require users to be **18+**. On the free tier, content may be read by human reviewers. | The AI cost floor is about $0.42/month (the prepay spread over 12 months), and the assistant needs an age gate. | Paid tier with an AI Studio spend cap, plus an 18+ attestation before using the assistant (§7.3). |
| F8 | Open Cognito sign-up with auto-confirm is the largest uncontrollable AWS cost risk: bot accounts become billable monthly active users (MAU) beyond the 10k free tier. | Self-service `SignUp` must not be exposed. | Registration goes through the backend with caps and a captcha (§7.1). |
| F9 | The Cognito **Lite** plan has no refresh-token rotation, no managed login, and no choice-based (`USER_AUTH`) sign-in. | We need our own auth UI using SRP. | §7.1. |

---

## 1. Product and challenge alignment

**Challenge summary** (fetched 2026-09-25): *"Your challenge is to create a layered, integrated view of a location or route on the Martian surface that pulls together data from multiple NASA science missions and could help a human explorer plan and carry out a successful Marswalk while conducting new and exciting science along the way."* The background text mentions route and destination details, "updates on current conditions", and the data needed to complete the mission "quickly and safely". Difficulty: Intermediate. Subjects: Human Exploration, Mars, Planets & Moons, Software, Space Exploration.

**Copernico's answer.** The user starts on a Mars globe and moves into a validated operational area in Jezero Crater. There, the app combines data from **five NASA missions**:

| NASA mission | Instrument(s) | Role in Copernico |
|---|---|---|
| Mars Global Surveyor | MOLA | Global relief |
| Mars Odyssey | THEMIS | Thermal inertia, IR imagery |
| Mars Reconnaissance Orbiter | HiRISE, CTX, CRISM | 1 m terrain, imagery, mineralogy |
| Viking Orbiters | — | Global color |
| Mars 2020 | Perseverance traverse, MEDA, samples, Ingenuity | Surface position, environment, samples |

A deterministic planner computes Marswalk routes of lower **estimated** risk. Its slope constraints are documented, and its human-traversal assumptions are explicit and labeled. The route is then connected to sourced science stops and to environmental context whose provenance is shown. Accounts, saved missions, and a context-aware assistant are **agreed additions** on top of the challenge.

**Demo narrative (≈90 s).**
1. Globe view with the coverage outline.
2. "Explore Jezero" transition.
3. Guided mission: landing site → Three Forks depot → Hawksbill Gap.
4. Metrics and "why this route".
5. Toggle the slope and CRISM layers.
6. Compare the shortest and lower-risk routes.
7. The daylight and walkback check.
8. The assistant explains the detour.
9. Save the mission.

**Explicitly out of scope for v1:**
- Live weather.
- Radiation-dose, oxygen, or survival predictions.
- Consumables modeling beyond the walkback-time rule.
- Guaranteed safety.
- Voice, video, or lip-sync.
- Routes on terrain that the DTM doesn't cover.

---

## 2. Requirement matrix

**Origin:**
- **C:** stated in the challenge summary.
- **C~:** implied by the challenge background.
- **A:** agreed product scope.
- **O:** optional extension.

**Priority:**
- **P0:** core demo.
- **P1:** required for the agreed scope.
- **P2:** if time allows.
- **P3:** future.

| ID | Requirement | Origin | Component | Pri |
|---|---|---|---|---|
| C1 | Layered, integrated view of a location or route | C | Layer system + route overlay | P0 |
| C2 | Data from multiple NASA science **missions** (missions are counted, not instruments) | C | Five missions (§4.3) | P0 |
| C3 | Help plan a Marswalk | C | Route planner | P0 |
| C4 | Help carry out the walk: route and destination details | C | Itinerary, per-leg metrics, walkback, daylight window | P0 |
| C5 | Do science along the way | C | POIs, stops, CRISM/geology layers | P0 |
| C6 | "Updates on current conditions" | C~ | Latest MEDA observation + calculated season/time; never shown as live | P0 |
| C7 | Complete the mission quickly and safely | C~ | Duration estimate, lower-risk profile, hazard explanation | P0 |
| A1 | Mars globe oriented to Jezero, "Explore Jezero", return to orbit | A | Exploration feature | P0 |
| A2 | Progressive LOD and a visible coverage boundary | A | Tiling + coverage outline | P0 |
| A3 | Per-layer source, date, resolution, units, limitations; legend | A | Provenance cards | P0 |
| A4 | Start, destination and stops; metrics; explanation; no-route result | A | Routing | P0 |
| A5 | Compare shortest and lower-risk routes | A | Alternatives | P1 |
| A6 | Environmental categories (measured, summary, calculated, modeled); dates; LTST/Ls | A | Environment | P0 (measured + calculated); modeled P3 |
| A7 | Sourced POIs with rationale, addable as stops | A | Science | P0 |
| A8 | Rover's latest position and traverse, with dates | A | Science | P0 |
| A9 | Public exploration without an account | A | Architecture | P0 |
| A10 | Accounts without email confirmation; create, rename, reopen and delete missions; preferences; favorites; stored versions | A | Auth + missions | P1 |
| A11 | Assistant panel, avatar, app context, allowlisted tools, save on request | A | Assistant | P1 |
| A12 | Atomic quotas, kill switch, zero live Gemini calls in tests | A | Assistant backend | P1 |
| A13 | Keyboard, reduced motion, text equivalents, no color-only meaning | A | Cross-cutting | P0 |
| A14 | English/Spanish (i18n structure) | A | Cross-cutting | P0 structure, P1 Spanish content |
| A15 | Measured performance on desktop and mobile | A | QA | P1 |
| A16 | Documentation: setup, methodology, sources, cost, limitations, demo | A | docs/ | P0 |
| X1 | Walkback check and EVA duration limits | Added (supports C7) | Routing | P1 |
| X2 | Daylight window at Jezero (Mars24) | Added (supports C4, C6) | Environment | P1 |
| X3 | Guided demo mission | Added (presentation) | UX | P0 |
| X4 | Reachability overlay (area reachable within the EVA time budget) | Added | Routing | P2 |
| X5 | 2D fallback (static ortho + SVG route) for devices without WebGL2 or with low memory | Added (A13, A15) | UX | P1 |
| O1 | Mission export (GeoJSON, CSV) | O | Missions | P2 |
| O2 | Shareable read-only links | O | Missions | P3 |
| O3 | Offline small region | O | Service worker | P3 |
| O4 | More regions (western rim first) | O | Region config | P3 (architecture ready in P0) |
| O5 | Advanced environment models (Ames GCM slice, consumables) | O | Environment | P3 |

---

## 3. User journey and interface structure

### 3.1 Journey

| Step | User sees and does | System |
|---|---|---|
| 1. Arrive | Mars globe centered on Jezero. Coverage outline labeled "Route-planning coverage · HiRISE 1 m DTM". A three-step first-run hint. | Static tiles only. No auth, no API. |
| 2. Explore | "Explore Jezero" flies from orbit to the crater to the operational area. "Back to orbit" reverses it. With reduced motion the view cuts instead. | Terrain LOD: MOLA → CTX → HiRISE. |
| 3. Inspect | Layer panel: imagery, elevation, slope, thermal inertia, mineralogy, POIs, rover. A legend, plus an ⓘ provenance card per layer. | Catalog JSON. |
| 4. Plan | Choose start, destination, and stops by clicking the map, from the POI list, by typing coordinates, or with the guided mission. Choose a profile (lower-risk or shortest). | Routing Web Worker on the precomputed 5 m grid. |
| 5. Understand | Route drawer: summary metrics, elevation profile with slope bands, itinerary table, "Why this route", alternatives comparison, walkback and daylight checks, unresolved-hazards note. | Deterministic metrics and explanation codes. |
| 6. Science | POIs near the route with rationale; add or remove stops; detour cost. | Buffer query + re-route. |
| 7. Save | "Save mission" prompts for sign-in or registration and stores inputs, outputs and versions. The assistant can explain, compare, suggest stops, and propose a save that the user confirms. | Authenticated API. |

### 3.2 Layout

```
Desktop ≥1024 px
┌───────────────────────────────────────────────────────────────────────────────┐
│ COPERNICO · Mars › Jezero › Operational area   Sol 1990 · Ls 1xx° · LTST 14:05 │ EN|ES │ Sign in │
├──────┬────────────────────────────────────────────────────────┬──────────────┤
│ Rail │                                                        │ Inspector    │
│ ◎ Explore                                                     │ (selection,  │
│ ▤ Layers         3D canvas (globe / terrain)                  │  provenance, │
│ ⤳ Route                                                       │  environment)│
│ ✦ Science                                                     │              │
│ ☼ Environment                                                 │              │
│ ⌂ Missions  ├──────────────────────────────────────────────────┤  ┌────────┐  │
│      │ Route drawer: metrics · profile · itinerary · compare  │  │avatar ▾│  │
└──────┴────────────────────────────────────────────────────────┴──┴────────┴──┘
Mobile <768 px: full-screen canvas · top status chip · bottom sheet (tabs = rail) · assistant FAB above the sheet
```

### 3.3 Required states

Every panel has designed states for:
- Loading (skeletons and tile progress).
- Empty ("No route yet: pick a start point").
- Error (retry plus a plain-language cause).
- Offline (cached layers only; routing still works if the grid is cached).
- Unavailable data ("No HiRISE coverage here: route planning disabled").
- No route (§6.7).
- AI disabled, quota exhausted, or signed out.
- WebGL unavailable (2D fallback, X5).

### 3.4 Visual design and accessibility

**Visual design**
- Mission-control dark theme with a Mars ochre accent (≥4.5:1 contrast on the background) and IBM Plex Sans / Plex Mono (OFL license).
- Design tokens are CSS custom properties.
- Data colors use perceptually uniform ramps (cividis-like for slope). Every risk class also has a pattern or icon **and** a text label.

**Accessibility**
- Target: WCAG 2.2 AA.
- Everything is reachable by keyboard: map pan and zoom by keys, route creation from lists and coordinate entry.
- Focus is always visible. Results and assistant replies are announced through `aria-live`.
- `prefers-reduced-motion` disables fly-to animations, inertia, and avatar motion.
- Every map result also has a text equivalent: the itinerary table and a generated summary paragraph.

**Localization**
- react-i18next with ICU messages. All strings live in `src/i18n/{en,es}`.
- Units are formatted with `Intl`.
- Explanation codes map to templates in each language.

### 3.5 Avatar

- A professionally drawn SVG astronaut helmet (≈10–15 KB) animated with CSS and the Web Animations API.
- States: `idle` (slow visor glint), `processing` (scan line), `responding` (visor pulse while the text reveals), `error`, `disabled`.
- Reduced motion switches to static state icons.
- The panel is collapsible, sits in the bottom-right corner, and never covers route results on mobile.

---

## 4. Dataset feasibility and coverage

Full metadata, caveats and URLs: [`research/datasets-terrain.md`](research/datasets-terrain.md) and [`research/rover-environment-time.md`](research/rover-environment-time.md).

### 4.1 Selected datasets

| Role | Mission / instrument | Product | Resolution / CRS / datum | Size | License | Feasibility | Pri |
|---|---|---|---|---|---|---|---|
| **Operational terrain (routing, slope)** | MRO / HiRISE | USGS Mars 2020 TRN HiRISE DTM mosaic `JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40` (DOI 10.5066/P9REJ9JN, 2020) | 1 m, Float32. eqc lat_ts 0 on R = 3,396,190 m. Heights above the areoid. Extent 77.2229–77.5840°E, 18.3068–18.6693°N | 1.84 GB | No use constraints; cite Fergason et al. 2020 | High | P0 |
| Operational imagery | MRO / HiRISE | TRN HiRISE ortho mosaic, 25 cm (DOI 10.5066/P9QJDP48) | Same frame as the DTM. Tiled to 0.5 m for the AOI | 7.36 GB source | Same as DTM | Medium (size) | P0 |
| Crater-scale terrain | MRO / CTX | JPL Science Investigation CTX DEM, 20 m (+ 5 m ortho) | eqc lat_ts 18.4663. The page says R = 3,396,160 m but the label says 3,396,190 m, so check the file | 90 MB (+360 MB) | Cite Mangold et al. 2021 | High | P0 |
| Global terrain | MGS / MOLA | USGS MOLA DEM 463 m v2 | Heights above the areoid | 2 GB | CC0 | High | P0 |
| Global imagery | Viking Orbiters | MDIM 2.1 colorized, 232 m (tiled to ≈650 m) | Sphere, planetocentric | 12 GB source | Public domain | High | P0 |
| Regional IR imagery | Mars Odyssey / THEMIS | Controlled Day IR quad MC-13 (COG) | 100 m | COG | CC0 | High | P1 |
| Thermal inertia | Mars Odyssey / THEMIS (+ MGS TES albedo) | Edwards & Buz 2021 Jezero TI (Zenodo 4931348) | 100 m, J m⁻² K⁻¹ s⁻½. Extent 77.00–78.50°E, 17.75–19.25°N | 1.7 MB | CC BY 4.0 | High | P1 |
| Mineralogy | MRO / CRISM | MTRDR summary products, e.g. FRT000047A3 (NE delta, 18 m) + labeled browse PNGs | Local-radius projection (3394.84 km, clat 15°); reproject | 0.4–164 MB | PDS (NASA) | High | P1 |
| Rover position / traverse | Mars 2020 | MMGIS `M20_waypoints.json`, `M20_traverse.json`, `M20_SAMPLE_v3.json`, Ingenuity waypoints; snapshotted at build time | Planetocentric °E; eqc lat_ts 18.4663 easting/northing | 0.6–1.7 MB | NASA; usage terms UNVERIFIED | High | P0 |
| Validated localizations | Mars 2020 | PDS PLACES `best_tactical.csv` (Release 16, sols 0–1897) | Same frame | 171 KB | PDS | High | P0 (validation) |
| Environment (measured) | Mars 2020 / MEDA | PDS calibrated/derived CSVs (ATS, PS, RHS, TIRS). Release 16: sols 1740–1859 | Per sol, at the rover's position | Small after aggregation | PDS; cite | High | P0 |
| Science POIs | Mars 2020 + literature | Curated list of 16 POIs with coordinates (research notes §D) | Planetocentric °E | — | Cite each | High | P0 |
| Geologic units | USGS | SIM 3464 (Sun & Stack 2020, 1:75,000) | Mars Transverse Mercator. **Documented 100–200 m offset** | 333 MB | Public domain | Medium | P2 |

### 4.2 Deferred or rejected

| Dataset | Decision | Reason |
|---|---|---|
| MSR TRN HiRISE v003 mosaics (1 m DTM + figure-of-merit confidence, 77.057–77.380°E) | **Deferred to extension region 2 (western rim, rover area)** | 5.47 GB. Covers the rover's current area and ships per-pixel confidence. Best candidate for O4. |
| PDS PLACES `m20_orbital_dem` (1 m, rover frame) | Validation only | Source DTMs and nodata are UNVERIFIED. The label says "derived from HiRISE and CTX", so resolution may be mixed. |
| MOLA–HRSC blended DEM 200 m | Rejected | Contains ESA HRSC data under CC BY-SA 3.0 IGO (share-alike). MOLA 463 m is enough for the globe. |
| Murray Lab global CTX mosaic | Rejected | No data license stated. It is also only semi-controlled, so it wouldn't align with the TRN products. |
| Mars Climate Database (LMD/ESA/CNES) | Rejected | Not NASA, and its terms forbid redistribution. |
| Stack et al. 2020 photogeologic map (1:5000) | Rejected unless the license is clarified | Article is CC BY 4.0, but the README in the zip says "All rights reserved". |
| Cesium ion "Cesium Mars" tiles | Rejected | ToS forbids redistribution and offline storage. Jezero in that asset is CTX, not HiRISE. |
| NASA Mars Trek WMTS (streaming) | Development fallback only | CORS-open, but terms UNVERIFIED and it adds a live external dependency to the demo. |
| NASA Ames Mars GCM slice | P3 (modeled layer) | Feasible offline via AmesCAP (MIT). Data license UNVERIFIED. |
| TimeCraftJS (SPICE in WASM) | Rejected | Repository license conflicts (Caltech "all rights reserved"). Needs about 100 MB of memory. Mars24 + astronomy-engine are enough. |
| Rock-abundance or hazard rasters for Jezero | Not available | No public downloadable product found. Treated as an unresolved hazard. |

### 4.3 Mission count (missions, not instruments)

MGS (MOLA), Mars Odyssey (THEMIS), MRO (HiRISE, CTX and CRISM count as **one** mission), Viking Orbiters (MDIM), Mars 2020 (traverse, MEDA, samples, Ingenuity). That makes **5 NASA missions**.

The UI discloses that ESA's Mars Express HRSC is the absolute reference behind the TRN CTX DTM control. That reference therefore propagates into the HiRISE mosaic. It is not counted as a NASA mission.

### 4.4 Operational area (AOI) v1

- **Proposed box:** 77.28–77.48°E × 18.40–18.52°N, about 11.2 km × 7.1 km (1° of latitude = 59,274.7 m on the sphere).
- **Inside it:** the landing site, Máaz, Séítah, Enchanted Lake, Hawksbill Gap, the Three Forks depot, Belva crater, Comet Geyser, Ingenuity's final position, and Cheyava Falls.
- **Final boundary:** set in milestone M1 from the **valid-data mask** of the DTM, not from the box. Areas from the TRN "CR" crater-rim stereo model (documented quality problems) are excluded or flagged.
- **Routing grid:** 5 m cells, about 2,248 × 1,422 ≈ 3.2 M cells.
- **Coverage outline:** vectorized from the eroded valid mask and simplified *inward*, so the outline never overstates coverage.

### 4.5 Known data issues to handle

1. The TRN CTX FGDC XML says heights refer to the IAU sphere. The values prove they are above the areoid (the crater floor is about −2,570 m; above the sphere it would be about −4.26 km). The pipeline asserts the landing-site elevation against PLACES.
2. STAC HiRISE items carry a placeholder `datetime` (2006-09-29). Use the product label for dates.
3. The `planetodetic_latitude` column in PLACES is constant, so don't use it.
4. `M20_SAMPLE_v3.json`: Lefroy Bay has Pelican Point's latitude/longitude. Use its easting/northing, which gives 18.48867°N, 77.34705°E.
5. MMGIS files declare `CRS84`, an Earth placeholder. Ignore it.
6. The CORS headers on MMGIS were reported inconsistently. Snapshot at build time instead of fetching at runtime.
7. The areoid model version differs between the MEGDR label (GMM3) and the USGS 463 m page (GMM-2B). The size of the difference is UNVERIFIED; measure it at Jezero in M1.

---

## 5. Architecture

### 5.1 Stack

| Concern | Choice | Why |
|---|---|---|
| Frontend | TypeScript, React 19, Vite, pnpm workspaces | Mature and fast; one language across web, API and IaC |
| 3D engine | **CesiumJS 1.145 (pinned), used directly through a React ref; no Resium, no Cesium ion** | Only engine evaluated with terrain + imagery LOD, draped layers, fly-to, and planet-scale precision (relative-to-eye rendering, log depth). `Ellipsoid.default` exists since 1.119. Cost: ≈1.75 MB gzipped plus about a dozen Earth defaults to override (§5.3). Fallback: NASA-AMMOS 3DTilesRendererJS. |
| State | Zustand (app), TanStack Query (server), Zod (contracts) | Small, typed, testable |
| Scientific core | `packages/domain`: pure TypeScript, no DOM, runs in a Web Worker and in Node | Calculations independent of rendering and storage |
| Astronomy | Own Mars24 implementation + `astronomy-engine` (MIT) for the IAU 2015 Mars rotation and heliocentric vectors; `geographiclib-geodesic` for cross-checks | Documented algorithms; two independent sources to cross-check the sun direction |
| Geospatial pipeline | Python 3.12 + uv: rasterio (bundled GDAL/PROJ ≥ 8.2 with IAU_2015 codes), numpy, pyproj, morecantile, rio-tiler, pydelatin, quantized-mesh-encoder | Standard tooling; reproducible lockfile |
| Backend | AWS Lambda (Node 22), API Gateway HTTP API, DynamoDB, Cognito **Lite**, SSM Parameter Store SecureString, CloudFront + S3, CloudWatch (7-day retention), Budgets | As requested; always-free tiers cover demo traffic |
| Infrastructure as code | AWS CDK v2 (TypeScript) | Same language; separate dev/prod stages |
| Testing | Vitest, fast-check (property tests), Playwright, MSW, DynamoDB Local | Covers numerics, contracts, access control, E2E |
| AI | `@google/genai` (GA), server-side only, pinned model `gemini-3.1-flash-lite` | Cheapest stable model open to new projects (F7) |
| Region | **us-east-1** | Cheapest; sa-east-1 costs 1.5–1.6× on DynamoDB, API Gateway and S3 for about 100 ms less latency on a non-interactive API |

### 5.2 System overview

```
                 ┌──────────────────────── Browser (public, no auth needed) ─────────────────────────┐
                 │ React UI ── Cesium adapter (Mars sphere) ◄── imagery / quantized-mesh tiles       │
                 │    │                                                                              │
                 │    ├── routing.worker (packages/domain) ◄── 5 m routing grids (binary + header)   │
                 │    ├── catalog / POIs / MEDA summaries / rover snapshot (static JSON)             │
                 │    └── Auth (Cognito SRP) ──► access token (memory)                               │
                 └────────────┬───────────────────────────────────────────▲──────────────────────────┘
                              │ Bearer access token (only for private ops) │ CloudFront (S3 origin, OAC,
                              ▼                                            │ security-headers policy)
        API Gateway HTTP API (JWT authorizer: iss, client_id/aud, exp, scope; stage + route throttles)
          ├── fn-register  ──► Cognito AdminCreateUser / AdminSetUserPassword (caps + captcha)
          ├── fn-profile / fn-missions ──► DynamoDB (single table, owner-scoped keys)
          └── fn-assistant ──► quota transaction (DynamoDB) ──► Gemini adapter ──► generativelanguage API
                                   ▲ kill switch + key: SSM SecureString (aws/ssm key, cached)
Offline: scripts/geospatial ──► artifacts + manifest (sha256) ──► S3        CloudWatch Logs (7 d) · Budgets
```

**Routing runs in the browser.** That means zero server cost, it works without an account, and the demo can't be taken down by API abuse. Saved missions store the inputs, the outputs, and the versions they were computed with.

### 5.3 Rendering on Mars: required Cesium overrides

These are adoption criteria for milestone M2. Each needs a test or a screenshot check. Engine comparison and API details: [`research/rendering-engine.md`](research/rendering-engine.md).

1. **Render body is the sphere `new Ellipsoid(3396190, 3396190, 3396190)`, not `Ellipsoid.MARS`.**
   - `Ellipsoid.MARS` is flattened, and Cesium treats latitude on it as planetographic. Our data is planetocentric, so using it would shift positions about **12 km north–south at 18.4°N**.
   - Set `Ellipsoid.default` before creating the `Viewer`.
   - Also pass the sphere explicitly to `Viewer`, `Globe`, `GeographicTilingScheme`, `CesiumTerrainProvider.fromUrl`, and any `Cesium3DTileset`. The tileset defaults to WGS84.
2. **Remove Earth defaults:** `baseLayer: false`, `baseLayerPicker: false`, `geocoder: false`, `sceneModePicker: false`. Set `Camera.DEFAULT_VIEW_RECTANGLE` to Jezero. Never set `Ion.defaultAccessToken`.
3. **Sun direction:** by default the Sun is placed using Earth's heliocentric position.
   - Set `scene.light = new DirectionalLight({direction})`, computed from astronomy-engine `HelioVector(Body.Mars)` + `RotationAxis(Body.Mars)` and cross-checked against the Mars24 subsolar point.
   - Hide `scene.sun`, disable bloom, and use `DynamicAtmosphereLightingType.SCENE_LIGHT`.
4. **Stars:** the `SkyBox` rotates with Earth's frame, so disable it. The optional star field (P2) uses the BSC5 catalog on a `CubeMapPanorama` transformed from ICRF to the Mars-fixed frame; whether that transform can be updated per frame is UNVERIFIED. The default background is plain black.
5. **Ground clamping:** `ApproximateTerrainHeights` carries Earth assumptions, so clamped polylines may be culled incorrectly.
   - Primary approach: draw routes at heights sampled from our own DTM plus a small visual offset, with a `depthFailMaterial`.
   - `clampToGround` is used only if a test shows it works.
6. **Tile formats:**
   - 3D Tiles must use `box` bounding volumes, because `region` volumes are always read as WGS84.
   - Quantized-mesh headers must be encoded with the Mars sphere.
   - Heightmap-1.0 can't hold heights below −1000 m. Jezero is about −2,600 m, so terrain uses quantized-mesh.
7. **Globe settings:** set `globe.baseColor` to a Mars tone and `depthTestAgainstTerrain = true`.
   - Vertical exaggeration defaults to 1.0. Any other value shows a persistent badge: "Vertical exaggeration ×N (visual only)".
8. **Performance and reduced motion:** use `requestRenderMode: true`. With reduced motion, use `flyTo({duration: 0})` and set inertia to 0.

### 5.4 Data pipeline and tiling (`scripts/geospatial`)

Each step is a command that is idempotent, checksummed, and writes to `data/work/` (gitignored). Outputs go to S3 together with a manifest.

1. `fetch`: download from the catalog URLs and record sha256 and the retrieval date. Large files support HTTP range and resume.
2. `inspect`: read the CRS, nodata and scale from each file header, and **assert** them against the catalog. Stop on a mismatch.
3. `reproject`:
   - Imagery and DEMs → `IAU_2015:49900` for the global and crater tiles.
   - Operational DTM → local frame `+proj=eqc +lat_ts=18.4663 +lon_0=0 +R=3396190` at 1 m, bilinear, with explicit src/dst nodata.
   - Then erode the valid mask by 1 px.
   - **Never interpolate across nodata.**
4. `derive`:
   - 5 m block-mean DEM (only where all 25 sub-cells are valid).
   - Slope S10 (Horn, 5 m grid) and S2 (Horn, 1 m grid), aggregated per 5 m cell (median, P90).
   - Gradient components, and thermal inertia resampled by nearest neighbour (flagged "100 m source").
   - Connected-component labels for the default constraint set, and the coverage polygon.
5. `grid`: pack routing grids as little-endian chunks: elevation int16 (0.1 m units), slopes uint16 (0.01° units), flags uint8. Each chunk has a JSON header (CRS WKT, geotransform, units, scale factors, nodata, sha256).
6. `tile`:
   - Imagery: morecantile TMS on `IAU_2015:49900` with a 2×1 root (matches Cesium's `GeographicTilingScheme`). WebP/JPEG. Global to z6, crater to z12, AOI to z16 (≈0.6 m/px). Fallback: `gdal raster tile` on a raster relabeled as EPSG:4326; this is only valid because tile math uses degrees, and the test asserts tile bounds.
   - Terrain: pydelatin mesh (max error 0.5 m in the AOI) → quantized-mesh with `Ellipsoid(3396190, 3396190)` + vertex normals. `layer.json` with sparse availability: global z0–7, crater to z12, AOI to z16.
7. `rover` / `meda` / `pois`: snapshot and normalize to contracts, recording source URL, retrieval time, and last sol.
8. `manifest`: write `datasetVersion = jezero-v1@<sha256-12>` over all artifacts.

**Storage estimate:** 2–4 GB of tiles and grids in S3. Raw sources (~25 GB) stay local and are never committed.

### 5.5 API boundaries

Public static content through CloudFront: `/catalog/*.json`, `/tiles/**`, `/grids/**`, `/data/*.json`. The API exists **only for private operations and registration**.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/v1/auth/register` | Public + captcha + caps | Create a confirmed user without an email-confirmation step (§7.1) |
| GET | `/v1/me` | JWT | Profile, preferences, favorites, AI quota status |
| PATCH | `/v1/me` | JWT, `If-Match` | Preferences, favorites, 18+ AI attestation |
| GET | `/v1/missions` | JWT | List summaries (≤ 50 per user) |
| POST | `/v1/missions` | JWT | Create |
| GET | `/v1/missions/{id}` | JWT | Read, including geometry |
| PATCH | `/v1/missions/{id}` | JWT, `If-Match` | Rename or update (optimistic concurrency) |
| DELETE | `/v1/missions/{id}` | JWT | Delete |
| POST | `/v1/assistant/messages` | JWT + attestation | One assistant turn (≤ 2 model calls) |

- **Errors:** RFC 9457 `application/problem+json` with stable codes: `VALIDATION_FAILED`, `NOT_FOUND`, `VERSION_CONFLICT`, `QUOTA_USER_DAILY`, `QUOTA_GLOBAL`, `AI_DISABLED`, `AI_UNAVAILABLE`, `AI_BUSY`, `REGISTRATION_CLOSED`.
- **Not found vs forbidden:** another user's resource returns 404, never 403, so its existence isn't revealed.
- **Admin controls:** no admin API. The kill switch and quotas are SSM parameters changed through the CLI.

### 5.6 Persistence (DynamoDB single table `copernico-{stage}`, on-demand, TTL attribute `expiresAt`)

**Access patterns, all bounded queries with no scans:**
- (1) Load the profile.
- (2) List my missions.
- (3) Get, create, update or delete one mission.
- (4) Update preferences and favorites.
- (5) Atomically reserve and reconcile AI quota: per user per day, global per day, global per month.
- (6) One active generation per user.
- (7) Registration caps: global per day and per IP hash per day.

**Items:**

| Entity | PK | SK | Notes |
|---|---|---|---|
| Profile | `USER#{sub}` | `PROFILE` | `schemaVersion`, `version`, locale, units, favorites (≤ 200 IDs), `aiAttested18At`, preferences |
| Mission | `USER#{sub}` | `MISSION#{ulid}` | Name, waypoints, parameters, metrics, explanation codes, conditions snapshot, assumptions IDs, `datasetVersion`, `algorithmVersion`, `version`, timestamps |
| Mission geometry | `USER#{sub}` | `GEOM#{ulid}` | Delta-encoded route geometry, ≤ 5,000 vertices. Written in the same `TransactWriteItems` as the mission item |
| AI lock | `USER#{sub}` | `AILOCK` | `requestId`, `expiresAt` (TTL safety net) |
| Usage | `USAGE#USER#{sub}` / `USAGE#GLOBAL` | `DAY#yyyy-mm-dd` / `MONTH#yyyy-mm` | `requests`, `reservedMicroUsd`, `actualMicroUsd`, `tokensIn`, `tokensOut`, `uncertain`. TTL 35 days (daily), 400 days (monthly) |
| Registration caps | `REG#GLOBAL` / `REG#IP#{hmac}` | `DAY#…` | TTL 2 days. The IP is stored only as a keyed HMAC |

- **Ownership:** the key prefix `USER#{sub}` always comes from the verified JWT and never from the request.
- **Concurrency:** updates use `ConditionExpression version = :expected`; a mismatch returns 409.
- **Schemas:** every record carries `schemaVersion`, is validated with Zod on write and on read, and has migrators for older versions.
- **Chat retention:** conversations are **not persisted on the server**. The client keeps the conversation in memory and sends at most the last 4 turns, bounded by tokens. Usage records keep only counts, never content.
- **Backups and cost caps:** point-in-time recovery is enabled in prod (negligible cost at this size). The table's maximum-throughput setting is used as a best-effort cost cap.

### 5.7 File organization

```
copernico/
├─ apps/web/src/
│  ├─ app/                 shell, providers, error boundaries
│  ├─ features/{exploration,layers,routes,science,environment,missions,auth,assistant}/
│  ├─ render/              Cesium adapter: Mars body, providers, overrides, lighting, coverage
│  ├─ workers/             routing.worker.ts
│  ├─ ui/                  tokens, primitives (Button, Panel, Sheet, Legend, ProvenanceCard…)
│  └─ i18n/{en,es}/
├─ packages/domain/src/    frames, projection, raster, slope, routing, traversal, marsTime, explain
├─ packages/contracts/src/ zod schemas: api, mission, catalog, provenance, assistant
├─ services/api/src/       handlers/, adapters/{dynamo,cognito,gemini,ssm}/, assistant/{context,tools,quota,prefilter}/
├─ scripts/geospatial/     pyproject.toml, uv.lock, copernico_geo/{fetch,inspect,reproject,derive,grid,tile,…}.py
├─ data/catalog/           datasets.yaml, pois.yaml, licenses/, kb/ (assistant knowledge cards)
├─ infra/                  CDK app: web, data, auth, api, observability stacks
├─ tests/                  e2e/, fixtures/ (small synthetic rasters), security/
└─ docs/                   PLAN.md, architecture.md, methodology.md, datasets.md, security.md, cost.md, demo.md, research/
```

### 5.8 Reproducibility and versioning

- `datasetVersion` is the manifest hash.
- `algorithmVersion` is `route@<semver>+params@<sha256-8>` over the parameter set (§6.5).
- A saved mission stores both versions plus all parameters. When it is reopened under different versions, the UI shows the stored results labeled "computed with dataset X / algorithm Y" and offers "Recompute with current data".
- The routing output is deterministic: heap ties are broken by node index, and golden-route tests compare hashes of the output.

---

## 6. Scientific methodology and validation

### 6.1 Reference frames and conventions

| Item | Convention |
|---|---|
| Body | Mars (NAIF 499) |
| Canonical geographic CRS | `IAU_2015:49900`: sphere R = 3,396,190 m, planetocentric latitude, east-positive longitude. This matches the USGS and PDS products. |
| Reference ellipsoid (conversions only) | IAU 2015: a = 3,396.19 km, b = 3,376.20 km. Used only for the planetographic latitude that Mars24 solar geometry needs: tan φg = (a/b)² tan φc, so 18.4446°c becomes 18.649°g. |
| Longitude | Stored as °E in [0, 360). Rendered in (−180, 180]. Mars24 needs °W, so Jezero becomes 282.57°W. All conversions are explicit functions with tests. |
| Vertical datum | Height above the MOLA areoid, in metres, for every selected DEM (verified by value). Slope is computed from areoid heights. The areoid is an equipotential surface, so this slope is relative to local gravity. |
| Local metric frame | `+proj=eqc +lat_ts=18.4663 +lon_0=0 +R=3396190`. This is identical to the Mars 2020 PLACES/MMGIS rover frame. East-west lengths get a per-row scale correction k(φ) = cos φ / cos 18.4663°; without it the error would reach about 0.1 % at the AOI edges. |
| Render frame | Cesium sphere with R = 3,396,190 m. Vertex radius = R + h_areoid. The shape of the areoid is not rendered; this is a visual simplification only and doesn't affect latitude/longitude placement or any calculation. |
| Time | UTC → TT via a leap-second table (TT − UTC = 69.184 s since 2017). MSD, MTC, LMST, LTST and Ls follow Mars24 (Allison & McEwen 2000). The Mars 2020 sol comes from the NAIF LMST SCLK: sol 0 starts at 2021-02-18T04:24:15.806 UTC, and 1 sol = 88,775.244 s. |

### 6.2 Terrain rules

- **Imagery resolution is not elevation resolution.**
  - The ortho is 0.25 m, but the DTM post spacing is 1 m with an effective resolution of a few metres.
  - Vertical precision is about 0.2 m (Kirk et al. 2008). The HiRISE-to-CTX median offset is 0.4 m.
  - The provenance cards state all of these.
- **Nodata is a barrier.** Outside the valid mask the routing grid is blocked, and the render tiles show the coverage outline.
- **Decorative only:** vertical exaggeration and mesh simplification (≤ 0.5 m error) affect only rendering. Every metric reads the scientific grids.

### 6.3 Slope

θ = atan √((∂z/∂x)² + (∂z/∂y)²), with x, y and z all in metres after the scale correction. Gradients use Horn's 3×3 operator.

**Baselines:**
- **S10** is computed on the 5 m block-mean DEM (10 m baseline). It is the primary constraint slope, comparable to the 6 m baseline used in Apollo slope analyses.
- **S2** is computed on the 1 m DEM (2 m baseline) and aggregated per cell as the median and P90. It detects micro-relief.

**Noise, assuming independent vertical errors:** σ_grad ≈ 0.433·σz/Δ per component. With σz = 0.2 m:
- About ±5° for S2. Slopes below about 5° at a 2 m baseline are not meaningful.
- About ±1° or less for S10.

Real DTM errors are correlated and measured noise is lower (1.8–2.8° RMS at a 1 m baseline in Kirk 2008), so these figures are a conservative bound. The UI always states the baseline.

**Directional grade along an edge:** γ = atan(Δz / L_h). **Cross-slope:** atan(|∇z × û|).

### 6.4 Routing graph and cost function

- **Graph:** 8-connected, over the traversable 5 m cells.
  - A diagonal move is allowed only if both orthogonal neighbours are traversable, which prevents corner-cutting.
  - A cell is traversable if the DTM is valid, S10 ≤ θmax, median S2 ≤ θmax, and it is outside the QA exclusion mask.
- **Per-edge quantities:**
  - Horizontal length L_h, with the row scale correction.
  - 3D length L_3D = √(L_h² + Δz²).
  - Travel time t = 1.3 · L_3D / v(γ), where v(γ) = v0 · max(0.1, 1 − k·|γ°|).
  - Risk multiplier m = 1 + w_s·band(max(S10, medS2)) + w_c·cross-slope term + w_r·[P90(S2) > θrough] + w_t·[TI < 100].
- **Profiles:**
  - **Shortest feasible:** cost = L_3D, subject only to the hard constraints.
  - **Lower estimated risk:** cost = t · m.
- **Search:** A* with admissible heuristics. Shortest: octile distance. Lower-risk: 1.3 × octile distance ÷ v0, since m ≥ 1 and v ≤ v0. Octile distances use the AOI's minimum row scale factor so they never overestimate. Typed arrays with a binary heap, run in a Web Worker. Ties are broken by node index.
- **Smoothing:** line-of-sight shortcuts are accepted only if every cell of the **supercover** line is traversable **and** the recomputed cost is not greater than the original. Metrics are always recomputed on the final polyline, sampled at ≤ 5 m.
- **No silent coverage expansion:** start, stops and destination must lie inside the valid mask. Otherwise the result is an explicit "outside coverage".

### 6.5 Human traversal parameters (versioned set `eva-params@1`)

Each parameter is marked **S** (sourced) or **A** (assumption). The UI shows the letter next to every parameter. Evidence: [`research/human-traversal.md`](research/human-traversal.md).

| Parameter | Default | Basis |
|---|---|---|
| θmax, hard slope limit | 20° in any direction | **S** (lunar): xEVA ConOps suit capability ≤ 20°; NASA CSRM uses ±20°. **A**: applying it to Mars. No suited slope data at Mars gravity exists. |
| Slope bands | 0–10° mild · 10–15° moderate · 15–20° steep | **S**: breakpoints (Apollo walked < 15°). **A**: penalty weights (0 / 0.5 / 2.0). |
| Cross-slope penalty | w_c = 1.0 × tan(cross-slope) | **A**: concept from CSRM ("rollover"); the weight is our choice |
| v0, level walking speed | 2.0 km/h | **S** (lunar Artemis planning pace). **A** for Mars. Below the 1.5 m/s near-maximum measured for suited walking at simulated 3/8 g, and below the 3.4 km/h unsuited Mars optimum. |
| Slope speed factor k | 0.0133 /° (applied symmetrically) | **S**: relative slope of the Apollo 12/14 fit. **A**: symmetric use. Slope explains little of the Apollo speed variation (R² = 0.18). |
| Timeline factor | ×1.3 | **S**: Apollo surface operations ran 25–30 % over |
| Duration sensitivity | Range shown across (a) the default, (b) the SEXTANT piecewise model, (c) Apollo 2.7 km/h | **S**: the models. **A**: using the spread as an uncertainty indicator. |
| EVA cap / nominal | 8 h cap / 6 h nominal | **S** (lunar suit): 6 ± 2 h plus 1 h of secondary O2, never counted |
| Walkback rule | At every vertex: elapsed + t_return(along the planned path) + 0.5 h ingress ≤ 8 h | **S**: Apollo method, improved to use path distance instead of line-of-sight |
| Walking radius | Warning beyond 2 km from the start (habitat) | **S** (lunar ConOps). **A** for Mars. |
| Loose-material flag | TI < 100 J m⁻² K⁻¹ s⁻½ | **S**: MSL rover trafficability guide. **A**: applying it to humans. The source is 100 m resolution. |
| Micro-relief flag | P90(S2) > 25° | **A**. It is a soft penalty, never a block, because it is noise-sensitive. |
| Daylight | Warning if the sun elevation at Jezero is < 10° at any time during the EVA | **A**: threshold. The sun elevation itself is calculated with Mars24. |

**Unresolved hazards,** shown with every route:
- Rocks smaller than about 1.5 m.
- Relief below about 0.5 m.
- DTM artifacts: seams, faceting, "boxes".
- Loose or dust-covered voids (no detectability source exists).
- Actual soil strength.
- Suit-specific limits at Mars gravity.

### 6.6 Metrics and displayed precision

| Metric | Computation | Display |
|---|---|---|
| Horizontal and 3D distance | Sum over the final polyline, sampled ≤ 5 m | Nearest 10 m (0.01 km at ≥ 1 km) |
| Elevation gain and loss | 5 m block-mean profile, 0.5 m hysteresis to suppress noise (**A**) | Nearest 1 m |
| Maximum slope | Max S10 along the route, plus the max directional grade | Nearest 1° |
| Distance per slope band | Length-weighted | Nearest 1 % |
| Estimated duration | Σt, plus rest assumptions (none by default) | Nearest 5 min, with the sensitivity range |
| Coordinates | Canonical CRS | 5 decimals in degrees (≈ 1 m); local E/N to 1 m |

### 6.7 Explanation, alternatives and no-route

- **Explanation codes.** The planner emits structured facts, for example `DETOUR_AVOIDS_SLOPE_BAND{band, lengthAvoided_m, extraDistance_m}`, `BLOCKED_BY_SLOPE_LIMIT`, `BLOCKED_BY_NODATA`, `OUTSIDE_COVERAGE`, `WALKBACK_EXCEEDED{vertex}`, `DAYLIGHT_WARNING`, `ROUGH_TERRAIN`, `LOW_THERMAL_INERTIA`.
  - Localized templates turn them into prose. The assistant receives the same facts.
- **Alternatives.** Shortest and lower-risk routes are computed together and shown in a table of Δdistance, Δtime, meters per slope band, and maximum slope.
- **No-route result.**
  - Connected-component labels are precomputed for the default constraints, so different components give an immediate answer.
  - The response names the barrier type (slope vs. nodata along the component boundary nearest the destination), highlights the reachable region, and gives the nearest reachable point.
  - It suggests alternatives: a different destination or waypoint. It **never** suggests relaxing constraints beyond sourced limits.

### 6.8 Time, season and illumination (P0 calculated, P1 daylight window)

- **Mars24 steps A–D** give MSD, LMST and LTST at Jezero, Ls, the Mars year, the subsolar point, and the sun's elevation and azimuth. Ls is accurate to about 0.01° (per the source).
- **The Mars 2020 sol number** comes from the NAIF formula.
- **Scene lighting** uses the calculated sun direction and is labeled "Calculated sun direction; no atmospheric scattering or terrain shadows" unless shadows are enabled. The surface sky tint is labeled **illustrative**.

### 6.9 Environmental data classes

| Class | Example | UI label |
|---|---|---|
| `observed` | MEDA ATS air temperature, sol 1859 | "Measured · MEDA · Sol 1859 (2026-05-13 UTC) · rover was X km from this point, ΔZ m" |
| `historical_summary` | MEDA daily min/max aggregated by 15° Ls bins over Mars years 36–38 | "Historical summary of measurements" |
| `calculated` | LTST, Ls, sun elevation, daylight window | "Calculated (Mars24 algorithm)" |
| `modeled` | Ames GCM slice (P3) | "Model estimate: not a measurement" |
| `illustrative` | Sky color, ambient lighting | "Illustrative" |

**Spatial relevance:** the rover has moved from −2,570 m (crater floor) to about −1,930 m (rim). Pressure depends on elevation, so every observation shows where it was taken. Nothing is ever labeled "current weather".

### 6.10 Validation strategy (automated unless noted)

| Area | Tests |
|---|---|
| Slope | Flat plane → 0°. Analytic planes at 5°, 15°, 20°, 30° with aspects 0°, 45°, 90°, 225° → Horn is exact to < 0.01°. Scale correction: the same plane at different rows gives the same slope. |
| Routing | Flat grid → straight line with length error < 0.5 % after smoothing. A ridge above θmax → a detour with the `BLOCKED_BY_SLOPE_LIMIT` code. A nodata wall with no gap → no route. A one-cell gap → passes through it. A diagonal gap between blocked cells → **no corner-cutting**. Property tests (fast-check): paths never touch blocked cells; smoothing never increases cost; results are deterministic. |
| Coordinates | Longitude wrap (−180/180/360). eqc round trips < 1 mm. Local frame vs. great-circle distance on the sphere (and GeographicLib) agree to < 0.01 % after correction. **Regression test for the lat_ts = 0 pitfall** (5.4 %). Planetocentric ↔ planetographic (18.4446° ↔ 18.649°). |
| Data integrity | CRS, nodata and scale assertions per file. DTM elevation at PLACES localizations inside the AOI compared with the PLACES `elevation` values, with RMS and bias reported and a threshold set in M1. The landing site is about −2,570 m. Rover easting/northing recomputed from lat/lon matches exactly. |
| Time | Both Mars24 worked examples (MSD, Ls, LMST, LTST, EOT) to their published precision. Mars 2020 sol at known events (landing = sol 0; Lookout Hill = sol 1354 on 2024-12-12). Sun direction from Mars24 vs. astronomy-engine agrees to < 0.1°. |
| Rendering | Manual checklist with screenshots: landing-site and sample markers sit on the correct HiRISE features; the rover traverse follows visible tracks; no Earth assets are requested (network log). |
| Performance | Playwright + Chrome tracing on the reference devices (§8.3). Results recorded in `docs/performance.md`. |

---

## 7. Security, assistant guardrails and cost control

### 7.1 Authentication and registration

- **User pool.** Cognito, Lite plan. Username = email (not an alias, so unverified emails can still sign in). **Self sign-up is disabled** (`AllowAdminCreateUserOnly`).
- **Registration** (`POST /v1/auth/register`):
  1. Validate the input and the password policy.
  2. Verify the captcha (Cloudflare Turnstile, free; needs a CSP entry and a privacy note).
  3. Check the global cap (default 25 per day, 300 in total for the demo) and the per-IP-HMAC cap (3 per day). Optionally require an invite code while the demo is running.
  4. `AdminCreateUser` (`MessageAction=SUPPRESS`, `email_verified=false`), then `AdminSetUserPassword(Permanent=true)`.

  The user is `CONFIRMED` without any confirmation email, and the email stays explicitly **unverified**. A pre-sign-up trigger is still attached so the logic works the same if self sign-up is ever re-enabled.
- **Why not a public `SignUp` + pre-sign-up auto-confirm:** the `SignUp` API is public and needs only the client ID. Bots would become billable MAUs, and it is UNVERIFIED whether a sign-up rejected by the trigger still counts. Trade-off: the password passes through our Lambda over TLS. It is handled only in memory and never logged.
- **Sign-in.** A public app client with no secret, `USER_SRP_AUTH`, and our own React forms using Amplify v6 `aws-amplify/auth` only.
  - The access token lives in memory; the refresh token in `sessionStorage`. The refresh token lasts 24 h because Lite has no rotation.
  - Sign-out calls `RevokeToken`.
- **Password recovery.** `AccountRecoverySetting = verified_email`.
  - Users can verify their email later from their profile (`GetUserAttributeVerificationCode`/`VerifyUserAttribute`), which enables self-service reset. Cognito's default sender is limited to 50 emails per day per account.
  - Unverified users see "Password reset unavailable until your email is verified". The documented fallback is an admin reset with `AdminSetUserPassword`, run manually.
- **API authorization.** The HTTP API JWT authorizer checks the signature, `iss`, `client_id` (audience = the app client ID), `exp`, and requires the scope `aws.cognito.signin.user.admin` on every route. That scope rejects ID tokens, which would otherwise pass the audience check. Handlers take `sub` only from the verified claims.

### 7.2 Web security

- **Secrets.** Only in SSM SecureString, encrypted with the `aws/ssm` key (no monthly fee). Read at cold start and cached. The IAM policy is scoped to that single parameter ARN. The frontend receives only public identifiers: API URL, pool ID, client ID, region, Turnstile site key. The repo has a placeholder-only `.env.example`. gitleaks runs in pre-commit and CI, and a post-build scan checks `dist/` for key patterns (e.g. `AIza`).
- **Headers** (CloudFront response-headers policy):
  - CSP: `default-src 'self'`; `script-src 'self'` (+ Turnstile); `worker-src 'self' blob:`; `connect-src` for self, the API, the regional Cognito endpoint and Turnstile; `img-src 'self' data: blob:`; `object-src 'none'`; `base-uri 'none'`; `frame-ancestors 'none'`. Whether Cesium needs `'unsafe-eval'` is UNVERIFIED and is tested in M2.
  - Also HSTS, `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`, and `Permissions-Policy`.
- **CORS and CSRF.** CORS allows only the app origin. Bearer tokens are never sent automatically as cookies are, so CSRF doesn't apply. CORS is **not** treated as authentication.
- **Input validation.** Zod at every handler. Body ≤ 256 KB, name ≤ 80 characters (NFC, control characters stripped), ≤ 20 waypoints, coordinates inside region bounds, ≤ 5,000 geometry vertices. DynamoDB calls use expression attribute values only. No outbound fetches except the fixed Gemini endpoint, so there is no SSRF surface.
- **Rendering model output.** Model text is rendered as text plus a minimal Markdown subset with no raw HTML. Links are stripped unless they point to an allowlisted domain (nasa.gov, usgs.gov, the PDS nodes).
- **Logging.** Structured JSON (Powertools logger) with redaction and 7-day retention. Prompts, responses, passwords and tokens are never logged; token counts, outcome codes and request IDs are.
- **Throttling.** API stage throttle at about 5 requests/s (burst 10). The assistant route is throttled at 1 request/s (burst 2). DynamoDB max-throughput limits on the table.

### 7.3 Assistant design

- **Model call.** The deterministic services compute everything; Gemini only phrases, explains, and picks allowlisted actions.
  - Model `gemini-3.1-flash-lite`, pinned in SSM; there is **no automatic fallback** model.
  - `thinkingLevel: "minimal"`; this can't be switched off fully, and thinking tokens are billed as output.
  - `maxOutputTokens: 512`; this limit includes thinking. `finishReason = MAX_TOKENS` shows a "truncated" notice and is never retried.
  - No Google Search grounding, and no audio, image or video.
- **Pipeline for one interaction:**
  1. Auth.
  2. Check the 18+ attestation.
  3. Validate the request with Zod.
  4. **Local prefilter.** Off-topic requests (no Mars, app or context terms, matching deny patterns) get a canned redirect with suggested questions. No quota is used.
  5. Kill switch, read from SSM with a 60 s cache.
  6. Build the prompt within the token budget.
  7. **Atomic reservation** (§7.4).
  8. Call Gemini: 15 s abort, no retry.
  9. If a server tool was requested: run it deterministically, reserve again, make **one** final call with `functionCallingConfig.mode = NONE`. If that second reservation fails, return the tool result formatted by template, without the model.
  10. Validate the output.
  11. Reconcile usage.
- **Prompt token budget (≤ 2,000 input tokens):**

  | Part | Tokens |
  |---|---|
  | System instruction | ≈ 350 |
  | Function declarations (these count as input) | ≈ 250 |
  | App context | ≤ 500 |
  | Retrieved knowledge cards | ≤ 400 |
  | History | ≤ 300 |
  | User message | ≤ 200 |

  - **Enforcement:** a conservative byte-based estimator per component with calibrated bytes-per-token ratios plus a 25 % margin, then reconciliation against `usageMetadata.promptTokenCount`. Overruns are logged, and the ratios are tightened.
  - **Optional exact counting:** Google's billing FAQ says `GetTokens` isn't billed, but that `countTokens` is the same thing is UNVERIFIED. Using it needs the separate authorization for live calls.
- **Context.** The client sends a structured context: view, selection, active layer IDs, route metrics and explanation codes, alternatives, environment facts with dates.
  - The server treats it as **untrusted data**: schema-validated, IDs checked against allowlists, numbers range-checked.
  - It is embedded in a delimited block labeled as data, never as instructions.
- **Tool allowlist** (Zod-validated in and out):

  | Tool | Kind | Effect |
  |---|---|---|
  | `search_knowledge(query)` | Server, read-only | Top 2 cards from the bundled curated knowledge base (glossary, dataset cards, POI notes, app help) |
  | `list_science_stops(maxDetour_m)` | Server, read-only | Deterministic buffer and detour query over curated POIs and the context route |
  | `get_environment_summary(lsBin?)` | Server, read-only | MEDA summaries with dates |
  | `list_my_missions()` | Server, read-only, owner-scoped | Query on the `USER#{sub}` partition |
  | `propose_map_action({type, id})` | Returned to the client | Fly to a POI, toggle a layer, highlight an alternative. IDs are checked against allowlists before anything runs. |
  | `propose_save_mission({name})` | Returned to the client | Shows a confirmation card; the save happens only when the **user clicks it**, through the normal API |

- **Limits.** The assistant can't run code, fetch URLs, read credentials, or touch infrastructure. A prompt injection can at most make it *propose* an action inside the user's own scope that the user must confirm.
- **System instruction.**
  - Covers scope, language, and the rule to cite data dates.
  - Tells the model never to call historical data "current", to redirect off-topic requests, and to treat the context and knowledge blocks as data.
  - It is written to be short. We **do not claim** prompting alone prevents misuse; the controls above are what bound it.

### 7.4 Quota reservation algorithm

**Defaults** (SSM, can only be lowered):
- 10 requests per user per day.
- 30 requests per day globally.
- 200 requests per month globally.
- AI budget of 400,000 µUSD per month.
- Worst-case reservation per call c = 2,000 × 0.25 + 512 × 1.50 = **1,268 µUSD**. This is computed from the configured prices, not hard-coded.

**Reserve.** A single `TransactWriteItems`:
1. User-day item: `ADD requests 1, reservedMicroUsd c`, with condition `requests < 10` or the item doesn't exist yet.
2. Global-day item: the same increment, with `requests < 30`.
3. Global-month item: the same increment, with `requests < 200 AND reservedMicroUsd <= :budgetMinusC`. `:budgetMinusC` is precomputed because DynamoDB condition expressions can't do arithmetic.
4. Lock item: `Put AILOCK {requestId, expiresAt: now + 30 s}`, with condition "absent, OR `expiresAt < now`, OR `requestId = mine`".

**Outcomes:**
- All conditions pass: the reservation is held. DynamoDB transactions are serializable, so with one slot left **at most one** concurrent request succeeds.
- A condition fails: return `QUOTA_*` or `AI_BUSY` without calling Gemini.
- A `TransactionConflict`: one retry with jitter. This is safe because nothing has been sent yet.

**After the call:**

| Result | Action |
|---|---|
| Success | Add the actual cost and tokens from `usageMetadata`. Release the lock with the condition "`requestId` = mine". |
| Failed **before sending** | Compensating decrement; release the lock. |
| Timeout or network error **after sending** (uncertain) | Keep the full reservation, increment `uncertain`, release the lock. |

**Fail closed:** any DynamoDB error means no generation.

**Kill switches, in layers:**
1. SSM `ai/enabled = false`.
2. The Gemini prepaid balance hitting $0, which makes every call return HTTP 402.
3. The AI Studio project spend cap (about $2; "experimental").
4. Emergency: Lambda reserved concurrency 0. New accounts may have a concurrency quota too low to reserve any (UNVERIFIED), so we may need to request an increase.

**Testing:** a concurrency test runs N = 20 parallel reservations against DynamoDB Local with 1 slot left and asserts exactly 1 success and 0 Gemini adapter calls for the rest.

### 7.5 Cost model

Prices checked 2026-09-25 (details in [`research/platform-costs.md`](research/platform-costs.md)).

| Item | Monthly at demo scale (50 MAU, 2k API calls, 3 GB tiles, 20 GB transfer) |
|---|---|
| Cognito Lite (≤ 10k MAU free) | $0 |
| API Gateway HTTP ($1.00/M) | ≈ $0.002 |
| Lambda (always free) | $0 |
| DynamoDB on-demand | ≈ $0.01 |
| S3 storage + origin GETs | ≈ $0.11 |
| CloudFront (always free: 1 TB, 10M requests), SSM, KMS, Logs, Budgets | $0 |
| **AWS subtotal** | **≈ $0.12** (≈ $0.20 in sa-east-1) + about $0.30 one-time for tile PUTs |
| Gemini, worst case at the 200 requests/month cap | ≤ $0.25 (paid from the $5 prepay) |
| **Total usage-based** | **≈ $0.37/month.** The cash floor is the $5 Gemini prepay per 12 months (≈ $0.42/month) plus AWS. Taxes (e.g. Argentine VAT on digital services) are UNVERIFIED and could push this past $1. |

**Residual costs that application quotas can't control:**

| # | Risk | Mitigation |
|---|---|---|
| 1 | Floods against CloudFront on pay-as-you-go (e.g. 100M requests ≈ $198 at South America rates) | Budget alerts. Emergency: disable the distribution. The flat-rate Free plan (no overages, WAF included) is only available if the account isn't on the Free Tier, and it doesn't allow custom header policies, so CSP would move to a CloudFront Function. |
| 2 | API Gateway floods | Throttles cap them at about $0.43/day at 5 requests/s. Whether rejected or unauthorized requests are billed is UNVERIFIED. |
| 3 | Lambda and log ingestion during floods | Low log levels and 7-day retention |
| 4 | Cognito MAUs from abuse | Blocked by admin-only creation and the caps |
| 5 | Delay in AWS alerts | Budgets update about 3 times a day, so alerts are not caps. **AWS has no hard spending cap** except the Free account plan, which ends by closing the account. |

### 7.6 Test isolation from Gemini

- The Gemini adapter factory throws unless `AI_PROVIDER=gemini` **and** `COPERNICO_ENV ∈ {dev-live, prod}`. Tests use the `mock` provider (fixtures).
- The global Vitest setup installs an undici `MockAgent` with `disableNetConnect()` (localhost only), plus an assertion that fails any test that attempts to reach `generativelanguage.googleapis.com`.
- CI has no Gemini key.
- Playwright routes `/v1/assistant/*` to MSW fixtures.
- **The supplied key is never used for testing.** A live smoke test (≤ 3 requests) happens only after the separate authorization at gate G3.

---

## 8. Roadmap

### 8.1 Gates

| Gate | When | Condition |
|---|---|---|
| G0 | Before any code | Owner authorizes implementation, having read F1 |
| G1 | 2026-10-28 | Full challenge statement reviewed; §2 updated; scope re-prioritized if the requirements differ |
| G2 | Before M7 deploy | Owner authorizes AWS resource creation (account type and region confirmed) |
| G3 | Before any live Gemini call | Owner authorizes paid-tier setup, the key in SSM, and a ≤ 3-request smoke test |
| G4 | Demo freeze | Every acceptance criterion in §8.2 checked and recorded; limitations documented |

### 8.2 Milestones (solo + Claude, estimates in focused days)

| # | Vertical slice | Key deliverables | Acceptance criteria | Est. |
|---|---|---|---|---|
| M0 | Foundations | `git init`, pnpm monorepo, TS strict, lint, Vitest/Playwright, CI, contracts skeleton, design tokens, i18n scaffold, Gemini network guard, gitleaks, Apache-2.0 license, `docs/` | CI green. A test proves outbound Gemini calls are blocked. No secrets (gitleaks). | 1 |
| M1 | Data pipeline v1 | Catalog with licenses; fetch, inspect, reproject and derive for the DTM, CTX, MOLA and Viking; routing grids; AOI mask and outline; rover, POI and MEDA snapshots; manifest | Re-run reproduces the same hashes. CRS/nodata assertions pass. DTM vs. PLACES elevation RMS reported. lat_ts pitfall test passes. Every artifact has provenance. | 4 |
| M2 | Globe → Jezero | Cesium on the Mars sphere with every §5.3 override; MOLA/Viking globe; crater CTX; AOI HiRISE; transition and return; coverage outline; progressive LOD | Markers at known coordinates sit on the correct features (screenshot checklist). Network log shows zero Earth or ion requests. FPS measured. Reduced-motion path works. | 3 |
| M3 | Route core | Domain slope and routing (§6.3–6.4), worker, start/stop/end UI, metrics, profile, itinerary, explanation codes, no-route diagnostics, text summary | All §6.10 slope, routing and coordinate tests pass. Golden routes are deterministic. P95 compute time recorded. Keyboard-only route creation works. | 4 |
| M4 | Layers and provenance | Layer registry, legend, provenance cards; slope, elevation, TI, CRISM, THEMIS IR layers | Every layer shows source, date, resolution, units and limitations. Five NASA missions visible and attributed. Risk encoding passes a colorblind simulation check. | 2 |
| M5 | Environment and time | Mars24 + sol, LTST/Ls chip, MEDA observed and summary panel, daylight window, calculated scene light | Mars24 worked examples pass. Sun-direction cross-check < 0.1°. Every value carries a class label and date. Nothing reads "current weather". | 2 |
| M6 | Science and comparison | POIs with rationale, rover traverse and latest position (with date and the outside-coverage label), stops and detours, shortest vs. lower-risk comparison, walkback check, guided demo mission | Guided mission runs end-to-end in ≤ 90 s. Comparison explanation cites the slope band and data source. The walkback violation fixture triggers the warning. | 3 |
| M7 | Accounts and missions | CDK stacks (dev), register flow, Cognito Lite, JWT authorizer, profile and missions CRUD, favorites, preferences, version display | Registration works with no email step. Tests for unauthenticated (401), cross-user (404), ID token rejected (scope), version conflict (409). Mission reopens with its stored versions. | 3 |
| M8 | Assistant | Panel and avatar states; gateway with mock provider; prefilter; context builder; tools; quota transaction; kill switch; sanitization; 18+ gate | Concurrency test: exactly 1 of 20 succeeds on the last slot. Injection fixtures can't trigger unconfirmed actions or reveal the configuration. Off-topic requests make 0 model calls. Zero live calls in the whole test suite. (Live smoke test only after G3.) | 4 |
| M9 | Hardening and demo | Spanish content, 2D fallback, accessibility audit (axe + manual keyboard), mobile layout, performance runs, docs (setup, methodology, sources, cost, limitations), demo script; prod deploy (G2) | §8.3 targets met or deviations documented. All 16 owner acceptance criteria traced to evidence in `docs/acceptance.md`. | 3 |

**Total ≈ 29 focused days.** Vertical slices M0–M6 give a complete, account-free demo, which is the core challenge answer. M7 and M8 add the agreed layers on top. If time runs short, cut from the end: M8 → M7 → the P2 layers. The P0 workflow never gets cut.

### 8.3 Proposed performance targets (confirm devices)

| | Desktop reference | Mobile reference |
|---|---|---|
| Device | Laptop with integrated GPU (Intel Iris Xe class), Chrome, 1920×1080 | Mid-range Android (Pixel 6a class) in Chrome, and iPhone 12+ in Safari |
| Globe interaction | ≥ 50 fps | ≥ 30 fps |
| Terrain view | ≥ 40 fps | ≥ 25 fps |
| First globe render (cold, on a Fast 4G profile) | ≤ 5 s | ≤ 8 s |
| Route computation, 5 km, P95 | ≤ 1.5 s | ≤ 4 s |
| Memory ceiling | — | ≤ 500 MB (otherwise fall back to 2D) |

### 8.4 Contingency: hackathon-window cut (≈ 39 h, if F1 forces a fresh build on Nov 14–15)

Realistic in 39 hours solo with Claude:
- A thin M1: AOI-only DTM + ortho, MOLA globe at low resolution.
- M2 without the crater tier.
- The M3 core.
- 3 layers.
- POIs + rover.
- The Ls/LTST chip + the latest MEDA reading.
- Local-only saving (browser storage).

**Not realistic in that window:** AWS auth, missions backend, the assistant, Spanish content, the performance program. This plan's research, methodology and architecture carry over either way.

---

## 9. Questions that block progress

1. **G2, blocks only M7 deployment.** Which AWS account plan do you have: a new "Free plan", a "Paid plan" with credits, or an older paid account? Is us-east-1 OK? Which email should receive budget alerts?
2. **G3, blocks only live AI. Development continues with mocks.** Do you accept the Gemini paid tier with the minimum $5 prepay, auto-reload off, and a project spend cap of about $2? The free tier is not suitable for real users' prompts: content may be read by human reviewers, and EEA/UK users are excluded.
3. **Blocks only M9 sign-off.** Which physical devices will you use for the desktop and mobile performance runs? Otherwise the targets in §8.3 stay as proposed.

Everything else uses the defaults in this plan and gets recorded in `docs/decisions.md` during implementation.

---

## Appendix A. Key sources (full lists in `docs/research/`)

- Challenge: https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/
- FAQ: https://www.spaceappschallenge.org/resources/participant-faqs/
- Team Formation Guide: https://www.spaceappschallenge.org/resources/team-formation-guide/
- T&C: https://www.spaceappschallenge.org/legal/
- TRN HiRISE DTM: https://astrogeology.usgs.gov/search/map/Mars/Mars2020/JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40
- PLACES: https://pds-geosciences.wustl.edu/missions/mars2020/places.htm
- MEDA (PDS Atmospheres): https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/meda.html
- Mars24 algorithm: https://www.giss.nasa.gov/tools/mars24/help/algorithm.html
- xEVA ConOps (EVA-EXP-0042 Rev B): https://www.nasa.gov/wp-content/uploads/2017/02/eva-exp-0042_xeva_system_con_ops_rev_b_final_dtd_10192020_ref_doc.pdf
- Gemini pricing: https://ai.google.dev/gemini-api/docs/pricing
- Gemini deprecations: https://ai.google.dev/gemini-api/docs/deprecations
- Cognito feature plans: https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-sign-in-feature-plans.html
- CesiumJS changelog: https://github.com/CesiumGS/cesium/blob/main/CHANGES.md
