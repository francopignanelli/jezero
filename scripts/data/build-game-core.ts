/**
 * Rover game: the TRN HiRISE orthomosaic at its native 25 cm over the core of the game's map (a
 * 1,024 m square around the delta area's centre, one 4096² GPU texture), where the 0.5 m layer
 * of scripts/geospatial (run.sh game-world) is otherwise used.
 *
 * The 7.4 GB mosaic is an uncompressed BigTIFF with one row per strip, so only the window's bytes
 * of each row are read (HTTP range requests, ~18 MB), as in fetch-tiff-window.ts. The window is
 * resampled (bicubic) onto the area's local grid (eqc with true scale at its centre), then
 * tone-matched to the 0.5 m layer by quantile mapping over their overlap, so the two blend without
 * a seam. Image decoding and WebP encoding use headless Chromium (Playwright): no GDAL needed.
 *
 * Run: npx tsx scripts/data/build-game-core.ts
 * Needs: data/build/game/areas.json and the area's detail albedo (run.sh game-world --only delta).
 * Output: data/build/game/delta_core_albedo.webp, and the area's "core" entry in areas.json.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = join(import.meta.dirname, '..', '..');
const GAME = join(ROOT, 'data', 'build', 'game');
const WORK = join(ROOT, 'data', 'work', 'game');
const AREA = 'delta';
const SIZE_M = 1024;
const CELL_M = 0.25;
const PX = SIZE_M / CELL_M;
const R = 3_396_190;
const URL_ =
  'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/HiRISE/JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first.tif';
const UA = { 'User-Agent': 'Copernico-pipeline/0.1 (NASA Space Apps research prototype)' };
const RAD = Math.PI / 180;

async function range(start: number, end: number): Promise<Buffer> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(URL_, { headers: { ...UA, Range: `bytes=${start}-${end}` } });
      if (res.status !== 206) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length !== end - start + 1) throw new Error(`short read ${buf.length}`);
      return buf;
    } catch (e) {
      if (attempt >= 8) throw e;
      await new Promise((r) => setTimeout(r, 500 * 2 ** Math.min(attempt, 5)));
    }
  }
}

interface Area {
  id: string;
  lat: number;
  lon: number;
  detail: { albedo: { file: string; cols: number; rows: number; cellM: number }; heights: { widthM: number; heightM: number } };
  core?: unknown;
}
const manifestPath = join(GAME, 'areas.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { areas: Area[] };
const area = manifest.areas.find((a) => a.id === AREA);
if (!area) throw new Error(`no area ${AREA} in areas.json`);

// ---------- 1. the window at 25 cm, on the local grid ----------

/** Local pixel (column, row) of the core grid → source pixel (column, row), fractional. */
function toSource(geo: { x0: number; y0: number; sx: number; sy: number }) {
  const k = Math.cos(area!.lat * RAD);
  return (c: number, r: number): [number, number] => {
    const x = -SIZE_M / 2 + (c + 0.5) * CELL_M;
    const y = SIZE_M / 2 - (r + 0.5) * CELL_M;
    const lon = area!.lon + x / (R * k) / RAD;
    const lat = area!.lat + y / R / RAD;
    const X = R * lon * RAD;
    const Y = R * lat * RAD;
    return [(X - geo.x0) / geo.sx - 0.5, (geo.y0 - Y) / geo.sy - 0.5];
  };
}

async function fetchCore(): Promise<{ grey: Uint8Array; provenance: Record<string, unknown> }> {
  const cached = join(WORK, `${AREA}_core_25cm.raw`);
  if (existsSync(cached) && existsSync(`${cached}.provenance.json`)) {
    console.log(`[core] using ${cached}`);
    return {
      grey: new Uint8Array(readFileSync(cached)),
      provenance: JSON.parse(readFileSync(`${cached}.provenance.json`, 'utf8')) as Record<string, unknown>,
    };
  }
  const head = await range(0, 15);
  if (head.toString('latin1', 0, 2) !== 'II' || head.readUInt16LE(2) !== 43) throw new Error('expected a little-endian BigTIFF');
  const ifd = Number(head.readBigUInt64LE(8));
  const n = Number((await range(ifd, ifd + 7)).readBigUInt64LE(0));
  const entries = await range(ifd + 8, ifd + 8 + n * 20 - 1);
  const tags = new Map<number, { type: number; count: number; raw: Buffer }>();
  for (let i = 0; i < n; i++) {
    const o = i * 20;
    tags.set(entries.readUInt16LE(o), {
      type: entries.readUInt16LE(o + 2),
      count: Number(entries.readBigUInt64LE(o + 4)),
      raw: entries.subarray(o + 12, o + 20),
    });
  }
  const SIZE: Record<number, number> = { 3: 2, 4: 4, 12: 8, 16: 8 };
  const values = async (tag: number, first = 0, count?: number): Promise<number[]> => {
    const e = tags.get(tag);
    if (!e) throw new Error(`missing tag ${tag}`);
    const size = SIZE[e.type]!;
    const m = count ?? e.count;
    const inline = size * e.count <= 8;
    const buf = inline
      ? e.raw.subarray(first * size)
      : await range(Number(e.raw.readBigUInt64LE(0)) + first * size, Number(e.raw.readBigUInt64LE(0)) + (first + m) * size - 1);
    return Array.from({ length: m }, (_, i) =>
      size === 2
        ? buf.readUInt16LE(i * 2)
        : size === 4
          ? buf.readUInt32LE(i * 4)
          : e.type === 12
            ? buf.readDoubleLE(i * 8)
            : Number(buf.readBigUInt64LE(i * 8)),
    );
  };
  const [width] = await values(256);
  const [height] = await values(257);
  const [compression] = await values(259);
  const [rowsPerStrip] = await values(278);
  const [bps] = await values(258);
  const [spp] = await values(277);
  if (compression !== 1 || rowsPerStrip !== 1 || bps !== 8 || spp !== 1)
    throw new Error(`unexpected layout: compression ${compression}, rows/strip ${rowsPerStrip}, bits ${bps}, bands ${spp}`);
  const [sx, sy] = await values(33550);
  const [ti, tj, , tx, ty] = await values(33922);
  const geo = { sx: sx!, sy: sy!, x0: tx! - ti! * sx!, y0: ty! + tj! * sy! };
  const src = toSource(geo);
  // Source window: the core's corners, plus the bicubic kernel's reach.
  const corners = [src(0, 0), src(PX - 1, 0), src(0, PX - 1), src(PX - 1, PX - 1)];
  const c0 = Math.max(0, Math.floor(Math.min(...corners.map((p) => p[0]))) - 3);
  const c1 = Math.min(width! - 1, Math.ceil(Math.max(...corners.map((p) => p[0]))) + 3);
  const r0 = Math.max(0, Math.floor(Math.min(...corners.map((p) => p[1]))) - 3);
  const r1 = Math.min(height! - 1, Math.ceil(Math.max(...corners.map((p) => p[1]))) + 3);
  const w = c1 - c0 + 1;
  const h = r1 - r0 + 1;
  console.log(`[core] source ${width}×${height} px at ${sx!.toFixed(3)} m; window ${w}×${h} (${((w * h) / 1e6).toFixed(1)} MB)`);
  const offsets = await values(273, r0, h);
  const win = new Uint8Array(w * h);
  const jobs = Array.from({ length: h }, (_, i) => i);
  let done = 0;
  const worker = async () => {
    for (let i = jobs.shift(); i !== undefined; i = jobs.shift()) {
      const start = offsets[i]! + c0;
      (await range(start, start + w - 1)).copy(win, i * w);
      if (++done % 250 === 0) process.stdout.write(`\r[core] ${done}/${h} rows`);
    }
  };
  await Promise.all(Array.from({ length: 24 }, worker));
  process.stdout.write('\n');

  // Bicubic (Catmull-Rom) onto the local grid; nodata (0) stays 0.
  const cr = (t: number): [number, number, number, number] => {
    const t2 = t * t;
    const t3 = t2 * t;
    return [(-t3 + 2 * t2 - t) / 2, (3 * t3 - 5 * t2 + 2) / 2, (-3 * t3 + 4 * t2 + t) / 2, (t3 - t2) / 2];
  };
  const at = (c: number, r: number) => win[Math.min(h - 1, Math.max(0, r)) * w + Math.min(w - 1, Math.max(0, c))]!;
  const grey = new Uint8Array(PX * PX);
  for (let r = 0; r < PX; r++)
    for (let c = 0; c < PX; c++) {
      const [fc, fr] = src(c, r);
      const ic = Math.floor(fc) - c0;
      const ir = Math.floor(fr) - r0;
      const wc = cr(fc - Math.floor(fc));
      const wr = cr(fr - Math.floor(fr));
      let v = 0;
      let empty = false;
      for (let j = 0; j < 4; j++) {
        let row = 0;
        for (let i = 0; i < 4; i++) {
          const s = at(ic - 1 + i, ir - 1 + j);
          if (s === 0) empty = true;
          row += s * wc[i]!;
        }
        v += row * wr[j]!;
      }
      grey[r * PX + c] = empty ? 0 : Math.max(1, Math.min(255, Math.round(v)));
    }
  const provenance = {
    artifact: `${AREA}_core_25cm.raw`,
    bytes: grey.length,
    sha256: createHash('sha256').update(grey).digest('hex'),
    retrievedUtc: new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00'),
    datasetId: 'hirise-ortho-trn',
    sourceUrl: URL_,
    method: 'http-range-rows (scripts/data/build-game-core.ts), bicubic onto the area grid',
    window: { colStart: c0, colEnd: c1, rowStart: r0, rowEnd: r1 },
    grid: { area: AREA, lat: area!.lat, lon: area!.lon, sizeM: SIZE_M, cellM: CELL_M },
  };
  mkdirSync(WORK, { recursive: true });
  writeFileSync(cached, grey);
  writeFileSync(`${cached}.provenance.json`, JSON.stringify(provenance, null, 2));
  return { grey, provenance };
}

const { grey, provenance } = await fetchCore();

// ---------- 2. tone match to the 0.5 m layer, and WebP (headless Chromium) ----------

// The installed Chrome (as the e2e tests use), so no Playwright browser download is needed.
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
const files = new Map<string, Buffer>([
  ['/', Buffer.from('<!doctype html><title>core</title>')],
  ['/detail.webp', readFileSync(join(ROOT, 'data', 'build', area.detail.albedo.file))],
]);
await page.route('http://core.local/**', (route) => {
  const body = files.get(new URL(route.request().url()).pathname);
  const path = new URL(route.request().url()).pathname;
  const type = path === '/' ? 'text/html' : 'application/octet-stream';
  return body ? route.fulfill({ body, contentType: type }) : route.abort();
});
await page.goto('http://core.local/');
const detailB64 = await page.evaluate(async () => {
  const img = await createImageBitmap(await (await fetch('/detail.webp')).blob());
  const cv = new OffscreenCanvas(img.width, img.height);
  const ctx = cv.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, img.width, img.height).data;
  const g = new Uint8Array(img.width * img.height);
  for (let i = 0; i < g.length; i++) g[i] = px[i * 4]!;
  let s = '';
  for (let i = 0; i < g.length; i += 0x8000) s += String.fromCharCode(...g.subarray(i, i + 0x8000));
  return btoa(s);
});
const detail = new Uint8Array(Buffer.from(detailB64, 'base64'));
const dw = area.detail.albedo.cols;
const dCell = area.detail.albedo.cellM;
// The core's footprint in the detail image, and the core averaged to the detail's cell.
const f = Math.round(dCell / CELL_M);
const offX = Math.round((area.detail.heights.widthM - SIZE_M) / 2 / dCell);
const offY = Math.round((area.detail.heights.heightM - SIZE_M) / 2 / dCell);
const histCore = new Float64Array(256);
const histDetail = new Float64Array(256);
for (let r = 0; r < PX / f; r++)
  for (let c = 0; c < PX / f; c++) {
    let s = 0;
    let empty = false;
    for (let j = 0; j < f; j++)
      for (let i = 0; i < f; i++) {
        const v = grey[(r * f + j) * PX + c * f + i]!;
        if (!v) empty = true;
        s += v;
      }
    if (empty) continue;
    histCore[Math.round(s / (f * f))]!++;
    histDetail[detail[(offY + r) * dw + offX + c]!]!++;
  }
const cdf = (h: Float64Array) => {
  const out = new Float64Array(256);
  let acc = 0;
  const total = h.reduce((a, b) => a + b, 0);
  for (let i = 0; i < 256; i++) out[i] = (acc += h[i]!) / total;
  return out;
};
const cc = cdf(histCore);
const cd = cdf(histDetail);
const lut = new Uint8Array(256);
for (let v = 0, j = 0; v < 256; v++) {
  while (j < 255 && cd[j]! < cc[v]!) j++;
  lut[v] = j;
}
// Unimaged pixels take the mid grey, as the 0.5 m layer's do.
const mapped = new Uint8Array(PX * PX);
for (let i = 0; i < mapped.length; i++) mapped[i] = grey[i] ? lut[grey[i]!]! : 128;
files.set('/core.raw', Buffer.from(mapped));
const webpB64 = await page.evaluate(async (px: number) => {
  const g = new Uint8Array(await (await fetch('/core.raw')).arrayBuffer());
  const cv = new OffscreenCanvas(px, px);
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(px, px);
  for (let i = 0; i < g.length; i++) {
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = g[i]!;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const blob = await cv.convertToBlob({ type: 'image/webp', quality: 0.9 });
  const b = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}, PX);
await browser.close();
const webp = Buffer.from(webpB64, 'base64');
if (webp.toString('latin1', 8, 12) !== 'WEBP') throw new Error('the browser did not encode WebP');
const out = `game/${AREA}_core_albedo.webp`;
writeFileSync(join(ROOT, 'data', 'build', out), webp);
area.core = { albedo: { file: out, cols: PX, rows: PX, cellM: CELL_M, widthM: SIZE_M, heightM: SIZE_M } };
(manifest as unknown as { sources: Record<string, string> }).sources.core =
  'USGS Mars 2020 TRN HiRISE orthomosaic at its native 25 cm (scripts/data/build-game-core.ts)';
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`[core] ${out}: ${PX}×${PX} at ${CELL_M} m, ${(webp.length / 1e6).toFixed(1)} MB; source window ${JSON.stringify(provenance.window)}`);
