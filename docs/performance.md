# Performance

Measured with `npm run test:perf` (Playwright probe `e2e/perf.spec.ts`): Chrome with its real GPU
(ANGLE/D3D11), the dev server on localhost, a cold page load (the dev server sends `no-store`), and a
1366 × 820 viewport at DPR 1. Three runs, 2026-10-01.

**Machine:** desktop, NVIDIA GeForce RTX 5060, 28 logical cores, 32 GB RAM, Windows 11.
This is far above the PLAN §8.3 reference devices (integrated GPU laptop, Pixel 6a, iPhone 12), so the
numbers below are **upper bounds**. The reference-device runs are still to do (they need the public
deployment, UPDATE_PLAN step 7).

## Results

| Measure | Run 1 | Run 2 | Run 3 | PLAN §8.3 target (desktop) |
|---|---|---|---|---|
| Scene revealed (4K sky, terrain, imagery, first-view tiles, mission data) | 2.05 s | 1.86 s | 1.85 s | ≤ 5 s cold on Fast 4G (**not yet measured**) |
| 8K Milky Way faded in | 3.04 s | 2.93 s | 3.00 s | — |
| Frame cost on the globe, mean / P95 | 0.9 / 1.4 ms | 0.8 / 1.3 ms | 0.7 / 1.4 ms | ≥ 50 fps (≤ 20 ms) |
| Frame cost in Jezero with a route, mean / P95 | 1.4 / 3.5 ms | 1.9 / 4.3 ms | 1.7 / 3.5 ms | ≥ 40 fps (≤ 25 ms) |
| Route compute (guided 5.6 km loop, both alternatives), median / P95 | 263 / 284 ms | 326 / 349 ms | 283 / 380 ms | P95 ≤ 1.5 s |
| Requests / transferred during the probe | 250 / 55 MB | 250 / 55 MB | 250 / 55 MB | — |

Loading order (run 3, ms after navigation): terrain and mission data 1,048 → stars and 4K sky 1,300 →
imagery 1,470 → first view complete 1,850 (reveal) → 8K sky 2,996.

## Method notes

- **Frame cost** is measured as a synchronous `CesiumWidget.render()` followed by `gl.finish()` while
  the camera moves: CPU and GPU time for one frame, including the sky layer. This gives an upper
  bound on frame rate that does not depend on display refresh or `requestAnimationFrame` throttling.
- **Route compute** is the worker's own timing (`computeMs`) for planning both the lower-risk and the
  shortest alternative over three legs on the 5 m grid (3.2 M cells).
- The 55 MB includes the 16.5 MB 8K sky texture, the 16 MB routing grid (loaded on entering Jezero)
  and the terrain and imagery tiles for the views visited. The scene does not wait for the 8K sky or
  the routing grid.
- Readings taken inside the Claude desktop browser pane were much slower (reveal 9–16 s, ~1 frame per
  second). That pane throttles animation frames when it is not in focus, so those readings are not
  used here.

## Still to measure

1. Cold load over a throttled "Fast 4G" profile against the public deployment (CloudFront caching,
   compressed transfer), on desktop and mobile.
2. Frame rate on the reference devices: an Intel Iris Xe-class laptop at 1920 × 1080, a Pixel 6a, and
   an iPhone 12.
3. Memory on mobile (target ≤ 500 MB). The 8K sky alone uses about 180 MB of GPU memory with its mip
   chain. If a device is over budget, the plan is to cap mobile at the 4K sky (about 45 MB).

## Cold loads of the production build, throttled (2026-11-13)

`npm run build`, served by `vite preview` with the data (JSON gzip-compressed, as CloudFront will),
cache disabled, Chrome with its real GPU at 1366 × 768. Throttling: "Fast 4G" = 9 Mb/s down, 1.5 Mb/s
up, 60 ms; "Slow 4G" = 1.6 Mb/s, 0.75 Mb/s, 150 ms. Script: the scratch `loadtime.mjs` (bytes from
the DevTools protocol, time to the page's own ready signal).

| Page (ready when) | Fast 4G before → after | Slow 4G before → after | MB before ready (after) |
|---|---|---|---|
| Home page (title shown) | 0.7 s | 3.6 s | 0.6 |
| Planner (loading screen gone, globe interactive) | 10.2 s → **7.1 s** | 41.9 s → **28.1 s** | 8.2 → 4.9 |
| Rover game (missions menu shown) | 13.0 s → **1.5 s** | 56.7 s → **4.6 s** | 11.0 → 0.7 |

What changed:
- **Game:** the menu no longer waits for the 3D world. The models and the last mission's map
  (~11 MB) load behind it, over the home page's Jezero photo; a mission chosen before they arrive
  waits for them behind its loading veil.
- **Planner:** the first view takes a 2K Milky Way (0.55 MB, `scripts/data/build-sky-2k.ts`)
  instead of the 4K (2.8 MB); the sharper one loads after the reveal: the 4K, or the 8K (16.5 MB)
  only on screens of ≥ 2,800 device pixels. The rover's route (0.86 MB of GeoJSON) is now measured
  compressed (0.18 MB), as it will be served.

The planner meets the PLAN §8.3 desktop target (≤ 8 s on Fast 4G); on Slow 4G the rest is its
1.1 MB of JavaScript (Cesium) and the first ~350 terrain and imagery tiles.
