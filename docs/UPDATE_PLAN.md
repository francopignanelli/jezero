# Copernico — Update Plan v2 (polish, focus, judging readiness)

**Date:** 2026-10-01 · **Supersedes:** the order of milestones M7–M9 in `PLAN.md` §8.2 (the methodology in `PLAN.md` stays valid).
**Basis:** the in-depth review on 2026-10-01 (live walkthrough plus code audit) and the Space Apps judging criteria:
Impact, Creativity, Feasibility (scientifically sound, usable), NASA Data Integration, and Communication/Storytelling.
Submission needs a 30 s video (English subtitles) **or** ≤ 7 slides, plus a project link.

**Rules for every step**
- `npm run verify` stays green, and new logic gets unit tests.
- EN and ES strings are updated together.
- Verify in the browser (screenshot proof).
- Record decisions in `docs/decisions.md`.
- Each step is independently shippable and runs as its own update.
- 🔒 marks steps that need the owner's explicit approval before acting.

Effort scale: **S** ≈ ½ session · **M** ≈ 1 session · **L** ≈ 2+ sessions.

---

## Step 0 — Safety baseline 🔒 · S

**Objective:** stop risking total loss. There are zero commits today.

**Details**
- First commit of the current tree. `data/raw`, `data/work` and `data/build` stay gitignored; the secret scan runs before committing.
- The owner creates a **private** GitHub repo; I push only after approval.
- Tag `v0.1-review` as the reference point for this plan.

**Acceptance:** `git log` shows the commit, the secret scan is clean, and the remote has the commit.

---

## Step 1 — Bug fixes and dead-UI removal · M

**Objective:** nothing on screen is broken, contradictory, or non-functional.

| # | Item | Details |
|---|---|---|
| 1.1 | One time source | The top bar shows the **planned EVA** (sol · LTST · Ls), labelled "Planned EVA", instead of "now". It is the same time the scene lighting and Conditions panel use. Clicking it opens Conditions. "Now" appears only inside Conditions, labelled. |
| 1.2 | Notice overlap | The prototype notice moves to a small dismissible chip, bottom-left of the canvas, that never overlaps controls. The full disclaimer stays in Explore and in the route results. |
| 1.3 | Hide placeholders | Feature flags `features.assistant` and `features.missions` (default off). The disabled assistant dock and the "coming soon" Missions tab disappear until they work (Step 6 brings missions back). |
| 1.4 | Walk-back label | Show the basis: "3 h 45 min to spare · 8 h EVA limit · 30 min ingress". A tooltip explains the rule. |
| 1.5 | Milky Way grain | Root cause: the 8K sky texture uses `LINEAR` minification without mipmaps (`render/sky.ts:267`), so it aliases at normal screen sizes. Fix: `generateMipmap` + `LINEAR_MIPMAP_LINEAR` + anisotropic filtering where available. |
| 1.6 | Progressive sky load 🔒 | Reveal the scene with the 4K sky (2.7 MB) and swap in 8K in the background without a visible pop. This reverses the 2026-09-25 "HD before reveal" decision, so it needs the owner's OK. Target: reveal ≤ 5 s on localhost. |
| 1.7 | Mobile pass | Real 375 px check: top bar truncation, bottom tab bar (fixed by Step 2's 4 tabs), the panel sheet, and no horizontal scroll. |

**Acceptance:** screenshots before and after each item; no overlapping elements at 1280, 1024 and 375 px; reveal time measured and recorded.

**Judging:** Feasibility (usability) and Storytelling (first impression).

---

## Step 2 — Interface restructure · M

**Objective:** only what's necessary. Every tab has a clear job.

**Details**
- Six tabs become **four**:

  | New tab | Contents | Replaces |
  |---|---|---|
  | **Explore** | Globe ↔ Jezero, guided Marswalk, coverage, missions used | Explore |
  | **Plan** | Waypoints, profile, results, alternatives, timeline (Step 5), save/export (Step 6) | Route (+ Missions later) |
  | **Science** | POIs, Perseverance, stops near the route (Step 4) | Science |
  | **Conditions** | Planned EVA time, daylight, MEDA measurements | Environment |

- **Layers** becomes a map control: a button at the top-right of the canvas that opens a compact popover with the legend and provenance (ⓘ). This is the standard map pattern and frees a tab.
- An active-layer legend chip sits on the canvas while an overlay (slope, elevation, thermal inertia) is on.
- Tighter panel typography and spacing; consistent card styles.

**Acceptance:** keyboard order is preserved and the popover traps focus correctly; the bottom bar on mobile fits all 4 tabs; EN/ES both fit without truncation.

**Judging:** Feasibility (user-friendly).

---

## Step 3 — The route as centrepiece · M

**Objective:** after "Calculate", the route is the most visible thing on screen, and the 3D view and the numbers tell the same story.

**Details**
- **Auto-frame:** after computing, fly to the route's bounding sphere at about −55° pitch with the start in front. Reduced motion cuts instead of flying.
- **Line styling:**
  - Primary route: dark casing plus a bright core, about 2× the current width.
  - Direction chevrons every ~250 m.
  - Alternative route: dashed and muted.
  - Optional "colour by slope band", using the same bands as the results table.
- **De-emphasis:** while a route is shown, the Perseverance traverse and unrelated POI labels fade (traverse at ~35 % opacity, low-priority labels hidden). Toggling them back stays possible.
- **Linked profile:** hovering or dragging on the elevation profile moves a marker along the 3D route and shows distance, elevation, slope and elapsed time. Keyboard: arrow keys step along the profile.

**Acceptance:** at the default framing the route is visible in a screenshot without zooming; the profile marker matches the route position (unit test on distance → point interpolation); the reduced-motion path works.

**Judging:** Storytelling and Feasibility.

---

## Step 4 — Point inspector and science stops near the route · M–L

**Objective:** make "layered, integrated view" and "science along the way" concrete and interactive.

**4a. Point inspector**
- Hover or click on terrain inside coverage to see a compact readout:
  - Latitude/longitude.
  - Elevation above the areoid.
  - Slope (10 m baseline) with its band.
  - Thermal inertia (with units).
  - The imagery source at that location.
  - Distance to the planned route.
- Values come from the routing grid already loaded in the worker (a new `sampleAt` message). Outside coverage the readout shows the rendered terrain height only, labelled "outside route-planning coverage".
- Clicking a POI or sample marker on the map opens its Science card (today markers are display-only).
- "Add by coordinates" shows the same readout before adding the point.

**4b. Stops near the route**
- For each POI within a configurable corridor (default 1 km) the panel shows its **detour cost**: Δdistance and Δtime for the cheapest insertion position, computed with the same planner.
- A list ranked by science interest per detour minute, each with a one-click "Add stop".
- Explanation text names the slope band of any detour.

**Acceptance:**
- Inspector values equal the grid cell values (unit test).
- Detour = route with the stop − route without it (unit test with synthetic terrain).
- Corridor queries for 14 POIs finish in ≤ 2 s.

**Judging:** NASA Data Integration and Creativity.

---

## Step 5 — EVA timeline · M

**Objective:** help *carry out* the walk, not just plan its geometry.

**Details**
- **Dwell time per stop:** default 20 min (labelled assumption), editable. It is included in the duration, the walk-back check, and EVA cap checks (`metrics.ts`).
- **Timeline bar in Plan:**
  - Departure → arrival at each stop → dwell → return.
  - Clock times in LTST and UTC.
  - A Sun-elevation curve over the EVA (from `solarPosition`), with the sunset / 10° threshold marked.
- **Checks:** "back X min before the Sun drops below 10°", or a warning naming the leg where daylight runs out.
- Hovering a timeline moment moves the profile/route marker (shared with Step 3).

**Acceptance:**
- A unit test pins arrival times for a fixed EVA start.
- The daylight-violation fixture triggers the warning.
- Dwell time changes the walk-back margin exactly as expected.

**Judging:** Impact and Feasibility.

---

## Step 6 — Missions without a backend · M

**Objective:** save, reopen, share and export missions with zero infrastructure cost. This replaces AWS accounts (M7) for the submission.

**Details**
- **Saved missions in browser storage:** create, rename, reopen, delete. Each entry stores its inputs plus the route, parameter and data versions; reopening warns when the versions differ. All reads are wrapped in try/catch, and the app works without storage.
- **Share link:** mission inputs encoded in the URL hash and validated with the existing Zod `MissionInput` schema on load. No personal data in the URL.
- **Export:**
  - GeoJSON (route, waypoints, stops, metrics as properties).
  - CSV itinerary.
  - A printable **mission briefing** (print stylesheet: map snapshot, timeline, itinerary, hazards, sources).
- The Plan header gets Save · Share · Export.
- The decision is recorded: PLAN M7 (Cognito/DynamoDB) is deferred.

**Acceptance:**
- Reopen gives an identical route (deterministic planner, golden test).
- Share-link round-trip test.
- Invalid or malicious hash input is rejected cleanly (fuzz test).
- The GeoJSON validates.

**Judging:** Feasibility ("ready for real-world use").

---

## Step 7 — Public deployment 🔒 · M

**Objective:** judges can open a public URL that loads fast.

**Details**
- CDK stack, static only: S3 (private) + CloudFront with OAC, plus a response-headers policy (CSP, HSTS).
- Caching:
  - Immutable cache headers for versioned tiles.
  - `index.html` no-cache.
- Upload `data/build` (~110 MB, about $0.30 one-time PUT cost) with the correct content types (quantized-mesh, WebP).
- An AWS Budgets alert to the owner's email. No API, Cognito or Lambda.
- Needs: the `copernico` AWS CLI profile, the region, and an explicit go-ahead (gate G2).

**Acceptance:**
- The public URL works.
- Zero requests to Cesium ion or Earth services.
- Cold load measured on a throttled "Fast 4G" profile and recorded (target ≤ 8 s to an interactive globe).

**Judging:** all criteria (judges must be able to open the app).

---

## Step 8 — Quality evidence · M

**Objective:** proof that it works, not just a claim.

**Details**
- **Playwright end-to-end tests:**
  - The guided Marswalk flow end to end.
  - A keyboard-only route by coordinates.
  - The ES locale.
  - Share-link reopen.
  - The network guard still blocks external hosts.
- **Accessibility:** axe on every panel, plus a manual keyboard pass (WCAG 2.2 AA target).
- **CI:** GitHub Actions running `verify` + e2e. No secrets in CI.
- **Performance:** fps on the globe and terrain, route compute P95, and load times, recorded in `docs/performance.md` with the device used.

**Acceptance:** CI green; `docs/performance.md` against the PLAN §8.3 targets, with any gaps documented.

**Judging:** Feasibility.

---

## Step 9 — Science depth · L

**Objective:** stronger NASA data integration and a more memorable visual.

**9a. Reachability isochrone**
- "Where can I go and return within N hours?"
- A new domain function: time-budgeted Dijkstra from the start over the same cost grid, return-aware (outbound ≤ budget − return). Today's `reachability.ts` only checks connectivity.
- Rendered as a draped overlay with contour bands (1 h, 2 h, 3 h…).

**9b. CRISM mineralogy layer (MRO)**
- MTRDR summary-parameter browse products over the delta, reprojected from CRISM's local-radius frame to the Mars sphere and the local equirectangular frame by the Docker pipeline.
- Provenance card, legend, and caveat ("summary parameters indicate, they don't identify, minerals").

**9c. Data QA**
- Flag the TRN "CR" crater-rim stereo models in coverage (pending from M1).
- Pin the GDAL Docker image.

**Acceptance:**
- Isochrone unit test on synthetic terrain (analytic travel times).
- CRISM placement checked against known delta features (screenshot checklist).
- Provenance complete.

**Judging:** NASA Data Integration and Creativity.

---

## Step 10 — Storytelling and submission · M

**Objective:** a compelling, rule-compliant demo.

**Details**
- **Cinematic fly-through:** the camera follows the planned route at a low oblique angle while the timeline runs (a "Play mission" button; disabled with reduced motion). This doubles as the video footage.
- **Gate G1 (2026-10-28):**
  - Re-read the full challenge statement.
  - Update the PLAN §2 requirement matrix.
  - Add any datasets listed in the official resources.
- **30 s video script** with English subtitles, plus a backup 7-slide deck. Structure: problem → globe → plan → why this route → science stop → timeline → NASA missions.
- **`docs/acceptance.md`:** every requirement traced to evidence.

**Acceptance:** the video is ≤ 30 s with subtitles; every challenge sentence maps to a visible feature.

**Judging:** Communication/Storytelling.

---

## Step 11 — Optional: Gemini assistant 🔒 · L

**Objective:** only if Steps 0–10 are done. It must meet every guardrail in `PLAN.md` §7.3–7.6.

**Preconditions:**
- The pasted key is rotated.
- The owner authorizes gate G3 (paid tier, spend cap, key into SSM via a command the owner runs).
- Mock-first; zero live calls in tests.

If time is short, this step is cut. The product is complete without it.

---

## Order and dependencies

```
0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → (11)
            └─ 3 and 5 share the route/profile/timeline marker
     2 must precede 6 (Plan header) and Step 1.3 hides Missions until 6
     7 can run any time after 6 once G2 is approved; 10 waits for G1 (Oct 28)
```

## Explicitly deferred

- AWS accounts (Cognito, DynamoDB, API): PLAN M7, replaced by Step 6.
- 2D fallback (X5).
- Offline mode (O3).
- More regions (O4).
- Modelled climate (O5).
