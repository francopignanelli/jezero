# Copernico

A Mars exploration and **Marswalk planning** prototype for the NASA Space Apps Challenge 2026
("Interplanetary Survival Guide: Martian Map"). It starts on a Mars globe and moves into a validated
operational area in Jezero Crater. There you can plan a walking route of **lower estimated risk**
over a 1 m HiRISE-derived terrain model, alongside sourced science stops, the Perseverance traverse
and dated environmental context.

> Research and education prototype. Routes express lower *estimated* risk from orbital data, never
> guaranteed safety. Human-traversal limits come from lunar (Apollo/Artemis) sources and are labeled
> as assumptions for Mars.

- Plan and methodology: [docs/PLAN.md](docs/PLAN.md)
- Research evidence and sources: [docs/research/](docs/research/)
- Data provenance and validation: [docs/datasets.md](docs/datasets.md)
- Decisions log: [docs/decisions.md](docs/decisions.md)
- Update plan v2 (current work order): [docs/UPDATE_PLAN.md](docs/UPDATE_PLAN.md)
- Performance measurements: [docs/performance.md](docs/performance.md)

## NASA missions used

| Mission | Instrument(s) | Used for |
|---|---|---|
| Mars Global Surveyor | MOLA | Global relief |
| Mars Odyssey | THEMIS | Thermal inertia |
| Mars Reconnaissance Orbiter | HiRISE, CTX, CRISM | 1 m terrain and slopes, imagery, mineral indicators |
| Viking Orbiters | — | Global color |
| Mars 2020 | Perseverance localization, MEDA, samples, Ingenuity | Traverse, samples, measured environment |

## Quick start (development)

Requirements: Node ≥ 22, npm ≥ 10, Docker Desktop (for the geospatial pipeline only).

```bash
npm install
npm run verify          # typecheck + lint + tests (offline) + secret scan
```

Build the data. It is never committed; it lands in the gitignored `data/` folders.

```bash
scripts/geospatial/run.sh inspect        # header-only checks of every remote source
scripts/geospatial/run.sh operational    # Jezero 5 m routing grid + coverage outline
scripts/geospatial/run.sh terrain        # quantized-mesh terrain tiles (Mars sphere)
scripts/geospatial/run.sh imagery        # Viking / CTX / HiRISE imagery tiles
npx tsx scripts/data/snapshot-rover.ts   # Perseverance traverse, samples, Ingenuity
npx tsx scripts/data/snapshot-meda.ts    # MEDA per-sol summaries (sols 1740–1859)
npx tsx scripts/data/snapshot-crism.ts   # CRISM MTRDR carbonate and mafic composites (~6 MB)
npx tsx scripts/data/fetch-tiff-window.ts && scripts/geospatial/run.sh imagery-hd   # 232 m Viking colour near Jezero
curl -o data/raw/hirise-rover/ESP_085859_1985_RED.JP2 https://hirise.lpl.arizona.edu/PDS/RDR/ESP/ORB_085800_085899/ESP_085859_1985/ESP_085859_1985_RED.JP2 && scripts/geospatial/run.sh imagery-rover   # 25 cm around the rover
npx tsx scripts/data/fetch-zip-entry.ts && scripts/geospatial/run.sh terrain-rim   # MSR 1 m DTM on the crater rim (676 MB)
npx tsx scripts/data/fetch-panoramas.ts && scripts/geospatial/run.sh panoramas   # real Mastcam-Z 360° views (~2.4 GB originals): placed by sol, compass/horizon measured
npx -y @gltf-transform/cli@4 optimize data/raw/models/25042_Perseverance.glb data/build/models/perseverance.glb --texture-compress webp --texture-size 1024 --compress meshopt   # 3D rover
npx -y @gltf-transform/cli@4 optimize data/raw/models/25043_Ingenuity_v3.glb data/build/models/ingenuity.glb --texture-compress webp --texture-size 512 --compress meshopt   # Ingenuity (NASA 3D Resources 25043)
npx tsx scripts/data/build-sky.ts && scripts/geospatial/run.sh sky   # stars + Milky Way
scripts/geospatial/run.sh loading-bg   # loading-screen background (needs the sky step); imagery-relief also writes sky/mars_globe_2k.webp
npx tsx scripts/data/validate-grid.ts    # grid vs PDS PLACES + guided-route check
```

Run the app:

```bash
npm run dev             # http://localhost:5180
```

Browser tests use the installed Chrome (no browser download) and the built data:

```bash
npm run test:e2e        # guided flow, keyboard-only route, Spanish, share links, WCAG 2.2 AA (axe)
npm run test:perf       # reveal time, frame cost, route compute (writes a PERF line)
```

## Repository layout

| Path | Contents |
|---|---|
| `apps/web` | React + CesiumJS client. Routing runs in a Web Worker. |
| `packages/domain` | Pure TypeScript scientific core: Mars frames, slope, A* routing, metrics, Mars24 time. |
| `scripts/geospatial` | Reproducible GDAL/PROJ pipeline (Docker, Python) |
| `scripts/data` | Rover, MEDA and validation scripts (Node) |
| `data/catalog` | Dataset provenance and curated points of interest (tracked) |
| `tests` | Cross-cutting tests, including the network guard that blocks live AI calls in tests |
| `e2e` | Playwright end-to-end, accessibility and performance probes |
| `docs` | Plan, research, datasets, decisions |

## Status

Implemented:
- Scientific core with tests: Mars24 worked examples, PDS PLACES frame fixtures, analytic slope
  planes, nodata and slope barriers, no corner-cutting, property tests, timeline and detour pricing.
- Data pipeline for terrain, imagery, the routing grid, the rover and MEDA.
- Globe → Jezero experience. It includes:
  - A route planner with lower-risk and shortest alternatives, explanations and an itinerary.
  - An interactive elevation profile linked to the 3D route.
  - An EVA timeline with time at each stop, the calculated Sun elevation and a daylight check, plus
    a walk-back check.
  - A point inspector showing the planner's own grid values.
  - Science stops near the route, each priced as a detour.
  - Measured MEDA environment data.
  - A scientifically positioned star/planet/Milky Way background.
  - English and Spanish.
- Missions without an account: saved in the browser, share links that recompute the route
  deterministically, and GeoJSON/CSV exports with a printable briefing.
- Quality: Playwright end-to-end tests, an automated WCAG 2.2 AA audit (axe), CI, and measured
  performance.

Not yet done (see `docs/UPDATE_PLAN.md`):
- Public deployment.
- A reachability overlay.
- The demo video.
- The optional assistant (Gemini).

## License

Code: Apache-2.0 (see `LICENSE`). Data remain under their original terms. See
`data/catalog/datasets.json` for per-dataset licenses and citations.
