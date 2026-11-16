/**
 * What a static deployment of Copernico publishes, and how: every file of the production build
 * (apps/web/dist) and of the data (data/build, served under /data), with its Content-Type and
 * Cache-Control, minus the build leftovers the app never requests. Writes the list to
 * data/work/deploy-manifest.json and prints the totals, the largest files and any warning, so the
 * deployment (S3 + CloudFront, docs/deploy.md) can be planned and later checked against it.
 * Creates no cloud resources and uploads nothing.
 *
 * Run: npm run build -w apps/web && npx tsx scripts/deploy/manifest.ts
 */
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const DIST = join(ROOT, 'apps', 'web', 'dist');
const DATA = join(ROOT, 'data', 'build');
const OUT = join(ROOT, 'data', 'work', 'deploy-manifest.json');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.geojson': 'application/geo+json',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
  '.bin': 'application/octet-stream',
  '.gz': 'application/octet-stream', // height grids, gzip-coded by us: decoded by the app, not the browser
  '.terrain': 'application/vnd.quantized-mesh',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.vtt': 'text/vtt',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.gif': 'image/gif',
};

/** Build leftovers in data/build the app never requests (paths relative to data/build). */
const EXCLUDE: Array<[RegExp, string]> = [
  [/^game\/margin_/, 'old game map (the margin area is no longer a mission map)'],
  [/\.raw\.glb$/, 'intermediate model (the optimised .glb is served)'],
  [/\.srt$/, 'subtitles kept for reference (the player reads the .vtt)'],
  [
    /^regions\/jezero\/validation\.json$/,
    'pipeline validation report (docs/datasets.md), not loaded',
  ],
  [/\.aux\.xml$/, 'GDAL sidecar'],
];

/**
 * Cache policy: pages revalidate on every visit; bundles have content hashes; Cesium's files change
 * only with its version; data is requested with ?v=<data version>, so CloudFront must key its cache
 * on that query string (then a new data release is a new URL).
 */
function cacheControl(path: string): string {
  if (path.endsWith('.html')) return 'no-cache';
  if (path.startsWith('assets/')) return 'public, max-age=31536000, immutable';
  if (path.startsWith('cesium/')) return 'public, max-age=604800';
  return 'public, max-age=31536000, immutable';
}

interface Entry {
  path: string;
  bytes: number;
  contentType: string;
  cacheControl: string;
}

function walk(
  dir: string,
  base: string,
  prefix: string,
  out: Entry[],
  skipped: Array<[string, string]>,
): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      walk(full, base, prefix, out, skipped);
      continue;
    }
    const rel = relative(base, full).split(sep).join('/');
    const why = prefix === 'data/' ? EXCLUDE.find(([re]) => re.test(rel))?.[1] : undefined;
    if (why) {
      skipped.push([prefix + rel, why]);
      continue;
    }
    const path = prefix + rel;
    out.push({
      path,
      bytes: statSync(full).size,
      contentType: TYPES[extname(full).toLowerCase()] ?? '',
      cacheControl: cacheControl(path),
    });
  }
}

const files: Entry[] = [];
const skipped: Array<[string, string]> = [];
walk(DIST, DIST, '', files, skipped);
walk(DATA, DATA, 'data/', files, skipped);

const mb = (b: number) => `${(b / 1e6).toFixed(1)} MB`;
const total = files.reduce((s, f) => s + f.bytes, 0);
const groups = new Map<string, { n: number; bytes: number }>();
for (const f of files) {
  const parts = f.path.split('/');
  const key = parts[0] === 'data' ? `data/${parts[1]}` : parts.length > 1 ? parts[0]! : '(pages)';
  const g = groups.get(key) ?? { n: 0, bytes: 0 };
  g.n++;
  g.bytes += f.bytes;
  groups.set(key, g);
}
const warnings: string[] = [];
for (const f of files) {
  if (!f.contentType) warnings.push(`no Content-Type for ${f.path}`);
  if (f.bytes > 20e6) warnings.push(`large file (${mb(f.bytes)}): ${f.path}`);
}

mkdirSync(join(ROOT, 'data', 'work'), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify(
    {
      generatedUtc: new Date().toISOString(),
      files: files.length,
      bytes: total,
      groups: Object.fromEntries([...groups].sort((a, b) => b[1].bytes - a[1].bytes)),
      skipped: skipped.map(([path, why]) => ({ path, why })),
      warnings,
      entries: files,
    },
    null,
    1,
  ) + '\n',
);

console.log(`${files.length} files, ${mb(total)} (skipped ${skipped.length})`);
for (const [k, g] of [...groups].sort((a, b) => b[1].bytes - a[1].bytes))
  console.log(`  ${k.padEnd(22)} ${String(g.n).padStart(6)} files  ${mb(g.bytes).padStart(9)}`);
console.log('largest:');
for (const f of [...files].sort((a, b) => b.bytes - a.bytes).slice(0, 8))
  console.log(`  ${mb(f.bytes).padStart(9)}  ${f.path}`);
if (warnings.length) console.log(`warnings:\n  ${warnings.join('\n  ')}`);
console.log(`→ ${relative(ROOT, OUT)}`);
