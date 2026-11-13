# Deployment: what is ready, and what the plan needs

Status (2026-11-13): **not deployed.** Everything here is local; nothing has been uploaded and no
cloud resource exists. The deployment itself is UPDATE_PLAN step 7 (S3 + CloudFront, static only),
gated by G2: the owner's go-ahead, the AWS account and the region.

## What gets published

`npm run build -w apps/web` then `npx tsx scripts/deploy/manifest.ts` lists every file, its
Content-Type and Cache-Control in `data/work/deploy-manifest.json`. Current build:

| Part | Files | Size |
|---|---|---|
| Terrain and imagery tiles (`data/tiles`) | 26,952 | 155.5 MB |
| Game (`data/game`: maps, NASA video, story images, cards) | 71 | 104.4 MB |
| Panoramas (8K, masks, thumbnails) | 30 | 24.7 MB |
| Sky (stars, Milky Way 2K/4K/8K, loading backgrounds) | 7 | 20.6 MB |
| Routing grid (`data/regions/jezero`) | 6 | 16.0 MB |
| Cesium runtime files | 389 | 7.1 MB |
| App bundles (`assets/`) | 8 | 5.9 MB |
| CRISM, rover data, models, home-page images, environment | 85 | 16.9 MB |
| **Total** | **27,551** | **351 MB** |

Left out (the app never requests them): the old 'margin' game map, the intermediate sample-tube
model, the landing video's .srt (the player reads the .vtt), the routing grid's validation report.
The largest single file is NASA's landing video (63 MB, MP4): it streams with byte ranges, which S3
and CloudFront serve.

## Settings the deployment must have

- **Paths:** the site is three static pages (`index.html`, `planner.html`, `play.html`) with relative
  URLs; the data sits under `/data` next to them (or elsewhere with `VITE_DATA_BASE_URL`).
- **Cache:** pages `no-cache`; `assets/*` immutable (content-hashed); `cesium/*` one week; data
  immutable and requested as `?v=<VITE_DATA_VERSION>`. CloudFront's cache key must include the `v`
  query string, and each data release must set a new `VITE_DATA_VERSION`.
- **Compression:** CloudFront compresses JSON, JS, CSS and HTML. Check that `application/geo+json`
  is compressed too (the route is 0.86 MB raw, 0.18 MB gzip); if not, serve the two GeoJSON files as
  `application/json`. Terrain tiles gain only ~19 % from gzip: not worth pre-compressing.
- **Content types:** set per file from the manifest (`.terrain` application/vnd.quantized-mesh,
  `.glb` model/gltf-binary, `.webm` video/webm, `.bin.gz` application/octet-stream with **no**
  Content-Encoding: the app decodes those itself).
- **Link previews:** set `VITE_SITE_URL` to the public origin at build time, so the Open Graph
  image links are absolute.
- **Headers:** CSP and HSTS through a response-headers policy (PLAN §6). The policy must allow
  same-origin Web Workers (routing, Cesium) and WebAssembly: run the e2e suite against the deployed
  headers before announcing the URL. No external host is contacted (the e2e network guard checks it).
- **The assistant** stays in the interface as "not connected yet"; its backend (API, Lambda, Gemini
  key in SSM) is a later, separate deployment.

## Cost order of magnitude

351 MB in S3 Standard is under $0.01 a month; the one-time upload is ~27,600 PUT requests (~$0.14).
CloudFront's always-free tier (1 TB, 10 M requests a month) covers judging traffic; a full planner
session moves ~5–10 MB, a game mission ~10–15 MB more. Budget alert as in PLAN §9.

## Before the go-ahead

1. G2: the AWS account (Free plan or paid), the region, the alert email.
2. A domain or the CloudFront URL; then `VITE_SITE_URL` and `VITE_DATA_VERSION`.
3. After upload: the throttled cold-load runs against the public URL (`docs/performance.md`), and the
   reference devices (an integrated-GPU laptop, a mid-range phone).
