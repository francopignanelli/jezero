# Demo: 30-second video and 7-slide deck

The Space Apps submission takes one of two demos: a video of at most 30 s (it must have English
subtitles) or a deck of at most 7 slides. Both are scripted below. Every claim in them maps to a
feature listed in `docs/acceptance.md`.

## Recording setup

- Chrome at 1920 × 1080, DPR 1, real GPU. The browser pane in the Claude desktop app throttles
  frames, so don't record there.
- `npm run dev`. Before recording, load the page once so the tiles are in the GPU cache.
- English UI, the prototype notice dismissed, and the panel open on the left.
- Record the screen at 60 fps and cut to 30 s. Subtitles are burned in, at the bottom centre.

## 30-second video

| Time | Screen | Subtitle (EN) |
|---|---|---|
| 0–3 s | Mars globe under the real sky from Jezero (stars, planets, Milky Way at their true positions) | "The first astronauts on Mars will need the best map possible." |
| 3–7 s | **Explore Jezero**: the camera flies from orbit into the crater | "Copernico layers data from five NASA missions over Jezero Crater." |
| 7–11 s | **Load guided Marswalk** → **Calculate routes**: the route draws and the camera frames it | "It plans a Marswalk of lower estimated risk on a 1 m HiRISE terrain model…" |
| 11–14 s | Layers → **Slope classes**, then back to "Why this route" | "…and explains why: 200 m of 15–20° slopes avoided for 30 m extra." |
| 14–18 s | Science → **Science stops near your route** → **Add stop** (Enchanted Lake) | "Science stops along the way are priced as detours: +25 minutes." |
| 18–22 s | EVA timeline: walk and stop blocks, Sun curve, "Back 3 h before the Sun drops below 10°" | "The timeline checks daylight and the walk-back limit." |
| 22–27 s | **▶ Play mission** follow-cam fly-through | "Then the crew can rehearse the walk." |
| 27–30 s | Map with the reach overlay; end card "Copernico · open NASA data · lower estimated risk, never guaranteed safety" | "Plan it. Understand it. Walk it." |

## 7-slide deck (backup)

1. **The challenge.** Astronauts need an integrated map for a Marswalk: routes, conditions,
   science. Today that data is spread across missions, frames and formats.
2. **Copernico.** One screenshot: globe → Jezero → route. It covers plan, understand, carry out
   and science along the way, works without an account, in English and Spanish.
3. **NASA data integration.** A table of 5 missions:
   - MGS/MOLA: global relief.
   - MRO/HiRISE + CTX: 1 m terrain and imagery.
   - Odyssey/THEMIS: thermal inertia.
   - Viking: global colour.
   - Mars 2020: traverse, samples, Ingenuity, MEDA.

   Each layer has provenance, date and limitations.
4. **Science method.**
   - Mars 2015 sphere and the PDS PLACES frame (match ≤ 0.5 mm).
   - The 5.4 % lat_ts = 0 pitfall, caught and corrected.
   - Slope over a 10 m baseline; 20° limit (lunar source, labelled as an assumption).
   - A* planning with lower-risk vs shortest alternatives.
   - Mars24 time, cross-checked to < 0.1° against the Sun direction.
5. **Plan and carry out.**
   - Elevation profile linked to the 3D route.
   - EVA timeline with time at each stop and a daylight check.
   - Walk-back margin.
   - Round-trip reach map.
   - Detour-priced science stops.
   - Saved missions, share links, GeoJSON/CSV and a printable briefing.
6. **Evidence.**
   - 141 unit and property tests, plus end-to-end tests.
   - An automated WCAG 2.2 AA audit that passes.
   - Deterministic share links (the same route to the millimetre).
   - Scene reveal in ~2 s and route compute P95 under 0.4 s (`docs/performance.md`).
7. **Limits and next steps.**
   - Orbital data cannot resolve rocks under ~1.5 m.
   - Walking limits are lunar-derived.
   - There is no live weather; MEDA data is dated.
   - Next: the western rim region (the rover's current area), a CRISM mineralogy layer, and the
     optional assistant.

## Numbers used (from the current build)

| Claim | Value | Source |
|---|---|---|
| Guided route | 5.64 km, 3 h 45 min walking, max slope 15°, shortest 5.60 km / 18° | Plan results; `docs/datasets.md` |
| Detour avoided | 200 m of 15–20° slopes and 260 m of 10–15° slopes, for +30 m | "Why this route" |
| Enchanted Lake stop | +600 m / +25 min (recomputed route: +590 m) | Science → stops |
| Timeline (10:00 LTST start, 20 min per stop) | Back 14:19 LTST; 3 h 05 min before the Sun drops below 10° | EVA timeline |
| Reach | 13.3 km² within a 3 h round trip from the landing site | Reach legend |
