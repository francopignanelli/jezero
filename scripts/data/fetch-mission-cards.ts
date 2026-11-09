/**
 * Pictures for the game's mission cards: one real NASA image per mission (NASA Image and Video
 * Library), and for the landing a frame of NASA's landing video (fetch-landing-video.ts first).
 * Each is cropped to 16:9 and saved as a 640 × 360 WebP in data/build/game/cards/, encoded in
 * headless Chrome; sources, credits and SHA-256 in data/catalog/mission-cards.json.
 *
 * Run: npx tsx scripts/data/fetch-mission-cards.ts
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = join(import.meta.dirname, '..', '..');
const OUT = join(ROOT, 'data', 'build', 'game', 'cards');
const RAW = join(ROOT, 'data', 'raw', 'mission-cards');
const CATALOG = join(ROOT, 'data', 'catalog', 'mission-cards.json');
const VIDEO = join(ROOT, 'data', 'build', 'game', 'media', 'landing.mp4');
const UA = { 'User-Agent': 'Copernico-pipeline/0.1 (NASA Space Apps research prototype)' };
const W = 640;
const H = 360;

/** Card key (GameApp's SLATE) → NASA image, and the part of it to keep (centre, 0–1). */
const IMAGES: Array<{ key: string; id: string; title: string; focus?: [number, number]; zoom?: number }> = [
  { key: 'ingenuity', id: 'PIA24542', title: 'Perseverance’s Selfie with Ingenuity', focus: [0.5, 0.55] },
  { key: 'moxie', id: 'PIA24203', title: 'MOXIE All Tucked In' },
  { key: 'firstSample', id: 'PIA24832', title: 'Confirmation of Montdenier Sample in Perseverance’s Drill' },
  { key: 'chute', id: 'PIA25219', title: 'Rover’s Backshell Seen From the Air' },
  // A mosaic: zoomed in past its black, unimaged corners.
  { key: 'delta', id: 'PIA24928', title: 'Sample Collection and Rock Analysis at Wildcat Ridge', zoom: 1.65, focus: [0.46, 0.46] },
  { key: 'lastFlight', id: 'PIA26243', title: 'Ingenuity Spots the Shadow of Its Damaged Rotor Blade' },
  { key: 'leopard', id: 'PIA26344', title: 'Perseverance’s Selfie With ‘Cheyava Falls’', focus: [0.5, 0.5] },
  { key: 'rim', id: 'PIA26573', title: 'Perseverance Rover Says Goodbye to ‘Witch Hazel Hill’' },
  { key: 'sparks', id: 'PIA25290', title: 'Perseverance Views Dust Devils Swirling Across Jezero Crater' },
  { key: 'aiDrive', id: 'PIA26073', title: 'Perseverance AutoNav Avoids a Boulder' },
  { key: 'record', id: 'PIA26071', title: 'Perseverance’s AutoNav Leads the Way' },
];
/** The landing card: the left (30 % speed) half of the split frame at 18 s, the parachute open. */
const LANDING_FRAME = { t: 18, crop: [40, 140, 560, 315] as [number, number, number, number] };

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

mkdirSync(OUT, { recursive: true });
mkdirSync(RAW, { recursive: true });
const sources: Array<{ key: string; buf: Buffer; type: string }> = [];
const entries: Array<Record<string, unknown>> = [];
for (const im of IMAGES) {
  // The medium rendition (about 640–1000 px), or the large one where there is none.
  const files = (await (await fetch(`https://images-assets.nasa.gov/image/${im.id}/collection.json`, { headers: UA })).json()) as string[];
  const pick = files.find((u) => u.endsWith('~medium.jpg')) ?? files.find((u) => u.endsWith('~large.jpg'));
  if (!pick) throw new Error(`${im.id}: no medium or large rendition`);
  const url = pick.replace(/^http:/, 'https:').replace(/ /g, '%20');
  const raw = join(RAW, `${im.id}.jpg`);
  if (!existsSync(raw)) {
    const res = await fetch(url, { headers: UA });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
  }
  const buf = readFileSync(raw);
  sources.push({ key: im.key, buf, type: 'image/jpeg' });
  entries.push({
    key: im.key,
    file: `game/cards/${im.key}.webp`,
    nasaId: im.id,
    title: im.title,
    page: `https://images.nasa.gov/details/${im.id}`,
    sourceUrl: url,
    sourceSha256: sha256(buf),
    credit: 'NASA/JPL-Caltech',
  });
}

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
// Everything is served from one made-up origin, so the canvas stays readable (not tainted).
const ORIGIN = 'http://cards.local';
let video: Buffer | null = null;
await page.route(`${ORIGIN}/**`, async (route) => {
  const path = new URL(route.request().url()).pathname.slice(1);
  if (path === '') return route.fulfill({ contentType: 'text/html', body: '<body></body>' });
  if (path === 'landing.mp4') {
    // Byte ranges, or the video cannot be sought.
    const all = video ?? (video = readFileSync(VIDEO));
    const m = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range ?? '');
    if (!m) return route.fulfill({ contentType: 'video/mp4', body: all, headers: { 'Accept-Ranges': 'bytes' } });
    const start = Number(m[1]);
    const end = m[2] ? Math.min(Number(m[2]), all.length - 1) : all.length - 1;
    return route.fulfill({
      status: 206,
      contentType: 'video/mp4',
      body: all.subarray(start, end + 1),
      headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${all.length}` },
    });
  }
  const s = sources.find((x) => `${x.key}.jpg` === path);
  return s ? route.fulfill({ contentType: s.type, body: s.buf }) : route.fulfill({ status: 404 });
});
await page.goto(`${ORIGIN}/`);

const encode = (key: string, focus: [number, number] = [0.5, 0.5], zoom = 1) =>
  page.evaluate(
    async ({ key, W, H, focus, zoom }) => {
      const img = new Image();
      img.src = `/${key}.jpg`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      // Cover: the largest 16:9 region of the image, centred on the focus.
      const s = Math.min(img.width / W, img.height / H) / zoom;
      const w = W * s;
      const h = H * s;
      const x = Math.min(img.width - w, Math.max(0, img.width * focus[0] - w / 2));
      const y = Math.min(img.height - h, Math.max(0, img.height * focus[1] - h / 2));
      c.getContext('2d')!.drawImage(img, x, y, w, h, 0, 0, W, H);
      return c.toDataURL('image/webp', 0.82);
    },
    { key, W, H, focus, zoom },
  );

const save = (key: string, dataUrl: string) => {
  const buf = Buffer.from(dataUrl.split(',')[1]!, 'base64');
  writeFileSync(join(OUT, `${key}.webp`), buf);
  return buf;
};

for (const im of IMAGES) {
  const buf = save(im.key, await encode(im.key, im.focus, im.zoom));
  const e = entries.find((x) => x.key === im.key)!;
  e.bytes = buf.length;
  e.sha256 = sha256(buf);
}

const frame = await page.evaluate(
  async ({ t, crop, W, H }) => {
    const v = document.createElement('video');
    v.src = '/landing.mp4';
    v.muted = true;
    await new Promise((r) => (v.onloadeddata = r));
    v.currentTime = t;
    await new Promise((r) => (v.onseeked = r));
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    c.getContext('2d')!.drawImage(v, crop[0], crop[1], crop[2], crop[3], 0, 0, W, H);
    return c.toDataURL('image/webp', 0.82);
  },
  { ...LANDING_FRAME, W, H },
);
const lbuf = save('landing', frame);
entries.unshift({
  key: 'landing',
  file: 'game/cards/landing.webp',
  title: 'Frame of “Perseverance Rover’s Descent and Touchdown on Mars” (the parachute opening)',
  source: `data/build/game/media/landing.mp4 at ${LANDING_FRAME.t} s, crop ${LANDING_FRAME.crop.join(' ')}`,
  credit: 'NASA/JPL-Caltech',
  bytes: lbuf.length,
  sha256: sha256(lbuf),
});
await browser.close();

writeFileSync(
  CATALOG,
  JSON.stringify(
    {
      description:
        'Pictures of the rover game’s mission cards (640 × 360 WebP, cropped to 16:9). NASA images are generally not copyrighted; credit NASA/JPL-Caltech.',
      cards: entries,
    },
    null,
    2,
  ) + '\n',
);
console.log(entries.map((e) => `${e.key}: ${Math.round(Number(e.bytes) / 1024)} KB`).join('\n'));
