# Deployment

Target selected by the owner (2026-11-15): source in the public GitHub repository
[`francopignanelli/jezero`](https://github.com/francopignanelli/jezero), hosted with Netlify.
The checked-in `netlify.toml` defines the build and publication settings; Netlify's deployment
result is the source of truth for publication status. The earlier S3 + CloudFront design remains
an alternative below.

## Netlify

The app is three static pages (`index.html`, `planner.html`, `play.html`) and needs no server.
Vite uses relative asset paths, so the app can run at a Netlify production or preview URL.
The planetary data remains outside Git history: `data/raw/`, `data/work/` and `data/build/` stay
gitignored. The deployment downloads a versioned data archive from this repository's Releases.

### Initial publication

Requirements for preparing the data release: Node 22 or newer, npm, `tar` (included with current
Windows, macOS and Linux), GitHub CLI authenticated as the owner, and the complete local
`data/build/`.

1. Push the source to the public repository's `main` branch.
2. Before importing the repository into Netlify, package the existing data and upload it once:

   ```bash
   npm run deploy:data:archive
   gh release create data-v1 data/work/jezero-data.tar.gz --repo francopignanelli/jezero --target main --title "Jezero planetary data v1" --notes "Prebuilt planetary data for Netlify; NASA source credits are in data/catalog and docs/datasets.md." --latest=false
   ```

3. In Netlify, import the existing GitHub repository `francopignanelli/jezero`, branch `main`.
   Leave the base directory at the repository root. Netlify reads these settings from
   `netlify.toml`: build command **`npm run build:netlify`**, publish directory
   **`apps/web/dist`**, Node **22**. Do not select `apps/web` as the base directory: npm workspaces
   and the data packaging scripts live at the repository root.
4. Deploy and open the resulting Netlify URL. The source remains on GitHub; GitHub Pages is not
   part of this deployment.

The archive contains the entire `data/build/` with paths relative to that directory. It includes
the small pipeline leftovers listed in the S3 manifest section below. Locally the data is about
348 MB, and the complete published site is about 361 MB before archive compression. The release
archive is about 327 MB. It is a build-time input: visitors load the static files from Netlify,
and do not download the archive from GitHub.

### Automatic updates

After connecting the repository, Netlify builds and deploys pushes to `main`, and can create
Deploy Previews for pull requests. Netlify installs the npm workspace dependencies from the root.
`npm run build:netlify` builds the app, downloads `jezero-data.tar.gz` from the pinned public
`data-v1` release with Node's streaming `fetch`, and extracts/copies it into
`apps/web/dist/data`. No GitHub token or other deployment secret is required to read the public
release. A missing release causes the build to fail with its download URL.

The build sets `VITE_DATA_BASE_URL=./data` and `VITE_DATA_VERSION=data-v1`. For link previews,
`VITE_SITE_URL` comes from Netlify's `DEPLOY_PRIME_URL`, falling back to `URL` and then an explicitly
provided `VITE_SITE_URL`. This gives preview builds their own URL.
[Netlify documents these build variables](https://docs.netlify.com/build/configure-builds/environment-variables/).

Code changes reuse the same data release. For new planetary data, generate a new archive and
create a new release tag (for example `data-v2`), then change `VITE_DATA_VERSION` in
`netlify.toml` to that tag. The download URL is derived from this version. Keep existing releases
unchanged so older deployments remain reproducible.

For a local smoke test, run `npm run build:netlify`. If `data/build/` exists, the script checks and
copies it instead of downloading the release; an incomplete local data directory fails the
build. `JEZERO_DATA_DIR` can point to another local data directory. Clean Netlify clones have no
built data, so they always use the versioned public release. Downloads use a fresh temporary
directory under ignored `data/work/` and are removed after copying, not reused across versions.

### Hosting checks and limitations

`netlify.toml` sets revalidation for HTML, a one-year immutable cache for hashed app assets, one
day for Cesium runtime files, and one hour with revalidation for data. Data filenames are stable
between releases, so their browser cache is deliberately bounded. It also sets
`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, terrain MIME
types, and `application/octet-stream` for the game's `.bin.gz` files. There is no SPA fallback:
home, planner and game are separate HTML pages.

Netlify controls transport headers including `Content-Encoding` and byte-range responses;
custom overrides for these headers are ignored.
[Netlify custom-header documentation](https://docs.netlify.com/manage/routing/headers/).
No `Content-Encoding` header is configured for `.bin.gz`: the game must receive the raw gzip bytes
and decompresses them itself. A CSP is not enabled until it has been checked with Cesium workers
and WebAssembly on the actual host. The earlier CloudFront policy below is an alternative, not a
claim about the current response headers.

After deployment, open the home page, planner and rover game; confirm the terrain, routing grid,
NASA media and a game map load under `/data/`. Check Web Workers and WebAssembly, video
seeking/byte ranges, and that `.bin.gz` responses have no `Content-Encoding: gzip` header: the
game decompresses those files itself. Run the deployed browser and cold-load checks before
claiming the original CloudFront performance targets. The optional assistant remains disabled.

## Alternative: S3 + CloudFront

The original plan uses a private S3 bucket and CloudFront with OAC, with explicit MIME types,
cache controls and security headers. It requires separate AWS authorization, account/region and
budget-alert details (G2 in `PLAN.md`); the Netlify build creates no AWS resources.

### Optimized S3 manifest

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

### S3 and CloudFront settings

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

### Original AWS cost estimate

351 MB in S3 Standard is under $0.01 a month; the one-time upload is ~27,600 PUT requests (~$0.14).
CloudFront's always-free tier (1 TB, 10 M requests a month) covers judging traffic; a full planner
session moves ~5–10 MB, a game mission ~10–15 MB more. Budget alert as in PLAN §9.

### Before an AWS deployment

1. G2: the AWS account (Free plan or paid), the region, the alert email.
2. A domain or the CloudFront URL; then `VITE_SITE_URL` and `VITE_DATA_VERSION`.
3. After upload: the throttled cold-load runs against the public URL (`docs/performance.md`), and the
   reference devices (an integrated-GPU laptop, a mid-range phone).
