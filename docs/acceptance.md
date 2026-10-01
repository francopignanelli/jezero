# Acceptance traceability

Each requirement in `PLAN.md` §2 is mapped to the feature that meets it and the evidence for it.
**Status:** ✅ done and verified · ⚠️ partial · ❌ not done.
This is provisional until gate G1 (2026-10-28), when the full challenge statement is published.

## Challenge (summary text)

| ID | Requirement | Status | Feature | Evidence |
|---|---|---|---|---|
| C1 | Layered, integrated view of a location or route | ✅ | 3D Jezero terrain with imagery tiers (Viking → CTX → HiRISE), slope/elevation/thermal-inertia/reach overlays with map legends, point inspector | `e2e/marswalk.spec.ts`; `features/inspector`, `features/layers` |
| C2 | Data from multiple NASA science missions | ✅ | 5 missions (MGS, MRO, Mars Odyssey, Viking, Mars 2020), each with a provenance card | `data/catalog/datasets.json`; Layers popover ⓘ |
| C3 | Help plan a Marswalk | ✅ | A* routing on the 5 m grid; lower-risk vs shortest; waypoints from the map, lists or coordinates | `packages/domain/src/routing/*.test.ts`; e2e keyboard-only route |
| C4 | Help carry out the walk: route and destination details | ✅ | Itinerary; elevation profile linked to the 3D route; EVA timeline with stop time; GeoJSON/CSV export and a printable briefing; Play mission fly-through | `routing/timeline.test.ts`, `missions.test.ts`, e2e Play mission |
| C5 | Conduct science along the way | ✅ | CRISM mineral indicators (carbonate/clay, mafic) from 6 MRO observations; 14 sourced POIs with "why" and "what to investigate"; stops near the route priced as detours; Perseverance samples | `routing/inspect.test.ts` (detour cost); browser check +600 m / +25 min |
| C6 | Updates on current conditions | ⚠️ (data limit) | Latest released MEDA measurements (dated, sol 1859) plus a calculated season, time and Sun; never labelled live | `features/environment`; PLAN F6 (no live source exists) |
| C7 | Complete the mission quickly and safely | ✅ | Duration estimates and model spread, lower-risk profile, hazard explanation, walk-back margin, daylight check, round-trip reach | `routing/metrics.test.ts`, `routing/timeline.test.ts`, `routing/isochrone.test.ts` |

## Agreed scope

| ID | Requirement | Status | Evidence / note |
|---|---|---|---|
| A1 | Globe oriented to Jezero, Explore Jezero, back to orbit | ✅ | Explore panel; camera funnel tests (`render/render.test.ts`) |
| A2 | Progressive level of detail and a visible coverage boundary | ✅ | Quantized-mesh terrain, imagery tiers, coverage outline and mask |
| A3 | Per-layer source, date, resolution, units, limitations; legend | ✅ | Provenance dialog; on-map legends (slope, elevation, thermal inertia, reach) |
| A4 | Start, stops, destination; metrics; explanation; no-route result | ✅ | Plan panel; `routing.test.ts` (no-route diagnostics) |
| A5 | Compare shortest and lower-risk routes | ✅ | Segmented toggle; comparison explanation |
| A6 | Environment categories with dates; LTST/Ls | ✅ (measured and calculated); modelled = P3 | Conditions panel; Mars24 worked examples (`time/time.test.ts`) |
| A7 | Sourced POIs addable as stops | ✅ | Science panel; detour pricing |
| A8 | Rover's latest position and traverse, with dates | ✅ | Science → Perseverance (sol, source date, outside-coverage tag) |
| A9 | Public exploration without an account | ✅ | No sign-in anywhere |
| A10 | Accounts; create, rename, reopen and delete missions; stored versions | ⚠️ replaced | Browser-local missions with versions, share links and exports (`missions.test.ts`). AWS accounts deferred (decision 2026-10-01). |
| A11–A12 | Assistant with guardrails and quotas | ❌ optional | UPDATE_PLAN step 11; hidden behind a flag; network guard proves zero live calls in tests |
| A13 | Keyboard, reduced motion, text equivalents, no colour-only meaning | ✅ | axe WCAG 2.2 AA e2e passes; keyboard-only e2e; profile slider; reduced motion disables flights and playback |
| A14 | English/Spanish | ✅ | e2e Spanish interface |
| A15 | Measured performance on desktop and mobile | ⚠️ | Desktop measured (`docs/performance.md`); mobile and reference devices after deployment |
| A16 | Documentation: setup, methodology, sources, cost, limitations, demo | ✅ | README, PLAN, datasets, decisions, performance, demo |
| X1 | Walk-back check and EVA limits | ✅ | Includes stop time (conservative bound) |
| X2 | Daylight window (Mars24) | ✅ | Timeline daylight check, to the minute |
| X3 | Guided demo mission | ✅ | Explore → Load guided Marswalk |
| X4 | Reachability overlay | ✅ | Round-trip reach layer |
| X5 | 2D fallback without WebGL2 | ❌ deferred | A WebGL error message is shown instead |
| O1 | Mission export (GeoJSON, CSV) | ✅ | Export menu |
| O2 | Shareable read-only links | ✅ | `#m=` share links (deterministic recompute) |

## Open before submission

1. Public deployment (UPDATE_PLAN step 7, needs owner approval).
2. Re-read the full challenge statement on 2026-10-28 (G1) and update this file.
3. Record the 30-second video (`docs/demo.md`).
4. Measure on mobile and the reference devices.
