<p align="center"><img src="apps/web/public/logo.png" alt="Jezero logo" width="120" /></p>

# Jezero

**Jezero Crater rebuilt from NASA's own data. Plan a crewed walk across it, or relive Perseverance's
mission on the ground it drove.**

NASA Space Apps Challenge 2026 · Challenge: *Interplanetary Survival Guide: Martian Map*

## Summary

Jezero is a web app with two modes over the same piece of Mars:

- **Planner.** Plan a Marswalk in Jezero Crater. It finds a route of lower estimated risk on a 1 m
  terrain model, explains the choice, and checks the plan against daylight and the walk-back limit.
  It also prices science stops along the way.
- **Rover game.** Drive Perseverance through seven real episodes of its mission, from the landing
  to the crater rim, with NASA's own images and videos.

The challenge asks for an integrated map that helps astronauts plan a walk, carry it out, do
science and stay informed about conditions. The data to do that already exists, but it is spread
across missions, instruments, coordinate frames and archives. Jezero brings it together for one
real place, in depth, and is clear about what is calculated, what was measured and what is
assumed.

## What it does

**Planner**
- A Mars globe with IAU-labelled features, under the real sky (stars, planets and the Milky Way at
  their true positions). One click flies into Jezero Crater.
- Map layers: slope, elevation, thermal inertia, CRISM mineral indicators and round-trip reach.
  Each layer has a legend and a source card (mission, date, resolution, limits).
- A Marswalk in five steps:
  1. Choose stops.
  2. Calculate a lower-risk and a shortest route.
  3. Review them: metrics, an explanation, the elevation profile, an EVA timeline with a daylight
     check, and the walk-back margin.
  4. Simulate the walk.
  5. Save, share or export it.
- 14 sourced science sites and 12 real Mastcam-Z 360° panoramas, placed on the terrain.
- Conditions: the sol, local solar time, season and Sun position (calculated), and the latest
  released MEDA weather (measured, dated). Nothing is labelled as live.

**Rover game**
- Seven episodes:
  1. Seven minutes (the landing).
  2. Wright Brothers moment (Ingenuity's first flight).
  3. The empty tube (the first coring).
  4. Back to the chute (Ingenuity's flight 26).
  5. The delta front.
  6. Leopard spots.
  7. The rim.
- Free exploration on five maps.
- Real hazards: soft sand, sharp rocks, slopes over 30°, dust storms. Tools: AutoNav, SuperCam's
  laser (seven rock types), coring into the rover's 43 tubes, MOXIE, panoramas and a photo mode.
- A planner site that lies on a game map opens there, at that point.

**For everyone:** no account, English and Spanish, keyboard support, reduced motion, and an
automated WCAG 2.2 AA audit.

## How it works

1. A reproducible pipeline (GDAL/PROJ in Docker, plus Node scripts) turns public NASA archives
   into terrain tiles, imagery tiles and a 5 m routing grid. The grid covers 79.7 km² and is
   derived from the HiRISE 1 m elevation model on the IAU 2015 Mars sphere.
2. A static web site serves three pages: home, planner and game.
   - The planner uses CesiumJS and computes routes with A* in a Web Worker.
   - The game uses three.js.
3. Everything is served from the same origin. There are no accounts, no tracking and no external
   services.

**Validation:**
- All 666 PDS PLACES rover localizations re-project to ≤ 0.5 mm.
- Grid elevations match those localizations with an RMS of 0.07 m.
- The Sun direction agrees with Mars24 to < 0.1°.
- 215 unit and property tests and 20 browser tests pass.

**Tools and languages:** TypeScript, React, CesiumJS, three.js, zustand, zod, i18next, Vite,
Vitest, fast-check, Playwright, axe-core; Python, GDAL, PROJ, Docker.

## NASA data used

| Mission · instrument | Data | Used for |
|---|---|---|
| MRO · HiRISE | Mars 2020 TRN DTM (1 m) and orthomosaic (25 cm); MSR rim DTM (1 m); ESP_085859_1985 | Terrain, slopes, routing, imagery |
| MRO · CTX | Mars 2020 Science Investigation DEM (20 m) and orthomosaic (5 m) | Regional terrain and imagery |
| MRO · CRISM | MTRDR summary-parameter composites | Mineral indicators |
| MGS · MOLA | MEGDR, 32 pixels/degree | Global relief |
| Viking Orbiters | Colorized global mosaic (925 m), MDIM 2.1 (232 m) | Global colour |
| Mars Odyssey · THEMIS | Thermal inertia of Jezero (Edwards & Buz 2021) | Sand versus rock |
| Mars 2020 | MMGIS traverse, samples and Ingenuity flights; PDS PLACES; MEDA; Mastcam-Z panoramas | Rover route, validation, weather, 360° views |
| NASA media | Landing and first-flight videos; Photojournal images; NASA 3D Resources models (Perseverance, Ingenuity, sample tube) | Rover game |

Full citations and licences: [`data/catalog/datasets.json`](data/catalog/datasets.json) and
[`docs/datasets.md`](docs/datasets.md).

## Space Agency Partner data

- **ESA Gaia DR2 and Hipparcos**: the planner's Milky Way, through NASA SVS's Deep Star Maps 2020.
  Credit: ESA/Gaia/DPAC, CC BY-SA 3.0 IGO.

## Other resources and references

- Yale Bright Star Catalogue, 5th ed. (Hoffleit & Warren 1991): stars.
- Mars24 algorithm (NASA GISS): Mars time and the Sun.
- IAU 2015 report on cartographic coordinates: the Mars sphere and rotation.
- Apollo surface-EVA records and Artemis EVA studies: walking speeds and the 20° slope limit,
  labelled as lunar assumptions.
- Open-source libraries listed under *Tools and languages*, each under its own licence (MIT,
  Apache-2.0 or MPL-2.0).

NASA media is credited as its sources ask. The NASA insignia is not used, and nothing here implies
NASA's endorsement.

## Use of AI tools

Following the Space Apps rules, AI use is declared here:

- **Code and documentation** were written with the help of AI coding assistants: Claude, by
  Anthropic, and Codex, by OpenAI. Claude-assisted commits carry a `Co-Authored-By: Claude` line
  in the git history (metadata). Codex helped prepare the GitHub publication and Netlify build.
- **Data** comes from the archives listed above and is processed by deterministic scripts. No data
  is AI-generated.
- **Images and videos** in the app are NASA's own, or scenes the app renders from NASA data.

## Try it locally

Requirements: Node ≥ 22 and npm ≥ 10. Docker is needed only to rebuild the data.

```bash
npm install
npm run dev        # http://localhost:5180
```

The app needs the built data in `data/build/`. To rebuild it, and for tests and the project
layout, see [`docs/development.md`](docs/development.md).

## Deploy to Netlify

Import this repository into Netlify with the repository root as the base directory. The included
[`netlify.toml`](netlify.toml) sets the build command to `npm run build:netlify` and the publish
directory to `apps/web/dist`. The build includes the versioned planetary data from GitHub Releases;
no API keys are required. See [`docs/deploy.md`](docs/deploy.md) for setup and data updates.

## Documentation

- [Project dossier (PDF)](docs/dossier/Jezero-Dossier.pdf): features, method and sources, with
  screenshots.
- [Method and plan](docs/PLAN.md) · [Data and validation](docs/datasets.md) ·
  [Performance](docs/performance.md) · [Decisions](docs/decisions.md)

## Limits

This is a research and education prototype. Routes express lower *estimated* risk from orbital
data, never guaranteed safety. Known limits:

- Orbital data cannot resolve rocks smaller than about 1.5 m.
- The walking limits come from the Moon.
- There is no live weather for Jezero.

Jezero is an independent project and is not affiliated with NASA or any space agency.

## License

The code is released under Apache-2.0 (see [`LICENSE`](LICENSE)). The data keeps its original
terms; see the dataset catalog.
