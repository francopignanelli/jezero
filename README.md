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

## NASA missions used

| Mission | Instrument(s) | Used for |
|---|---|---|
| Mars Global Surveyor | MOLA | Global relief |
| Mars Odyssey | THEMIS | Thermal inertia |
| Mars Reconnaissance Orbiter | HiRISE, CTX | 1 m terrain and slopes, imagery |
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
npx tsx scripts/data/build-sky.ts && scripts/geospatial/run.sh sky   # stars + Milky Way
npx tsx scripts/data/validate-grid.ts    # grid vs PDS PLACES + guided-route check
```

Run the app:

```bash
npm run dev             # http://localhost:5180
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
| `docs` | Plan, research, datasets, decisions |

## Status

Implemented:
- Scientific core with 90+ tests: Mars24 worked examples, PDS PLACES frame fixtures, analytic slope
  planes, nodata and slope barriers, no corner-cutting, property tests.
- Data pipeline for terrain, imagery, the routing grid, the rover and MEDA.
- Globe → Jezero experience with a route planner, alternatives, explanations, itinerary,
  walk-back and daylight checks, science stops, measured MEDA environment, a
  scientifically positioned star/planet/Milky Way background, and English/Spanish.

Not yet implemented: accounts and saved missions (AWS), and the assistant (Gemini).

## License

Code: Apache-2.0 (see `LICENSE`). Data remain under their original terms. See
`data/catalog/datasets.json` for per-dataset licenses and citations.
