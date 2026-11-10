/**
 * NASA's video of Ingenuity's first flight ("First Video of NASA's Ingenuity Mars Helicopter in
 * Flight, Including Takeoff and Landing", NASA/JPL-Caltech/ASU/MSSS, 19 April 2021: Mastcam-Z on
 * Perseverance, parked at Van Zyl Overlook 64.3 m away), for the end of the rover game's
 * Ingenuity mission. Only the flight is kept: from 13.0 s (2.7 s before takeoff) to 43.0 s
 * (3.5 s after touchdown) of the 57 s original, which ends on the NASA insignia (not to be used,
 * per NASA's media guidelines). The picture is cropped 1.5× around the helicopter (it is about
 * 40 px across in the 1280 × 720 frame) and re-encoded in headless Chrome (MediaRecorder, VP9).
 * The video is silent (its captions file says "[silent]").
 *
 * Output: data/build/game/media/first-flight.webm and first-flight.webp (poster); size, SHA-256,
 * cut and crop in data/catalog/first-flight-video.json. The original is kept in data/raw/media/.
 *
 * Run: npx tsx scripts/data/fetch-first-flight-video.ts
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { chromium } from '@playwright/test';

const ROOT = join(import.meta.dirname, '..', '..');
const RAW = join(ROOT, 'data', 'raw', 'media');
const OUT = join(ROOT, 'data', 'build', 'game', 'media');
const CATALOG = join(ROOT, 'data', 'catalog', 'first-flight-video.json');
const UA = { 'User-Agent': 'Copernico-pipeline/0.1 (NASA Space Apps research prototype)' };

const NASA_ID = 'JPL-20210419-TECHf-0001-First Video of NASA’s Ingenuity Mars Helicopter in Flight';
const BASE = `https://images-assets.nasa.gov/video/${encodeURIComponent(NASA_ID)}/${encodeURIComponent(NASA_ID)}`;
// The original (1280 × 720 at the highest bitrate: the crop is enlarged, so the cleanest source).
const SOURCE = `${BASE}~orig.mp4`;
const ORIG = join(RAW, 'first-flight.orig.mp4');

/**
 * The cut (s of the original) and the crop (x, y, width, height in its 1280 × 720 frame): the
 * helicopter stands at x ≈ 640, its feet at y ≈ 650 on the ground and its rotors at y ≈ 395 at
 * the top of the hover. Takeoff at about 15.7 s, touchdown at about 39.5 s (frames checked).
 */
const CLIP = { from: 13, to: 43, crop: [213, 240, 853, 480] as const, w: 1280, h: 720, fps: 30 };

/**
 * MediaRecorder's WebM has no Duration (players show ∞ and cannot draw a seek bar): writes one
 * into the Segment's Info element (EBML; IDs 0x18538067 Segment, 0x1549A966 Info, 0x2AD7B1
 * TimecodeScale, 0x4489 Duration as a float in TimecodeScale units).
 */
function withDuration(webm: Buffer, seconds: number): Buffer {
  const vint = (at: number): { len: number; value: number; unknown: boolean } => {
    const first = webm[at]!;
    let len = 1;
    while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
    let value = first & (0xff >> len);
    let ones = value === 0xff >> len;
    for (let i = 1; i < len; i++) {
      value = value * 256 + webm[at + i]!;
      ones &&= webm[at + i] === 0xff;
    }
    return { len, value, unknown: ones };
  };
  const idLen = (at: number) => vint(at).len;
  const idAt = (at: number) => webm.subarray(at, at + idLen(at)).toString('hex');
  // EBML header, then the Segment.
  let p = 0;
  const head = vint(p + idLen(p));
  p += idLen(p) + head.len + head.value;
  if (idAt(p) !== '18538067') throw new Error('WebM: no Segment');
  p += idLen(p) + vint(p + idLen(p)).len;
  while (p < webm.length) {
    const id = idAt(p);
    const size = vint(p + idLen(p));
    const body = p + idLen(p) + size.len;
    if (id === '1549a966') {
      // Info: its TimecodeScale (ns per unit, 1 ms by default), and no Duration yet.
      let scale = 1e6;
      for (let q = body; q < body + size.value; ) {
        const s = vint(q + idLen(q));
        const b = q + idLen(q) + s.len;
        if (idAt(q) === '4489') return webm; // already there
        if (idAt(q) === '2ad7b1') scale = webm.readUIntBE(b, s.value);
        q = b + s.value;
      }
      const duration = Buffer.alloc(11);
      duration.set([0x44, 0x89, 0x88]);
      duration.writeDoubleBE((seconds * 1e9) / scale, 3);
      // The new Info size as an 8-byte vint (0x01 then 7 bytes).
      const n = size.value + duration.length;
      const sizeField = Buffer.alloc(8);
      sizeField[0] = 0x01;
      sizeField.writeUIntBE(n, 2, 6);
      return Buffer.concat([
        webm.subarray(0, p + idLen(p)),
        sizeField,
        webm.subarray(body, body + size.value),
        duration,
        webm.subarray(body + size.value),
      ]);
    }
    if (size.unknown) break;
    p = body + size.value;
  }
  throw new Error('WebM: no Info element');
}

async function sha256(path: string): Promise<string> {
  const h = createHash('sha256');
  await pipeline(createReadStream(path), h);
  return h.digest('hex');
}

mkdirSync(RAW, { recursive: true });
mkdirSync(OUT, { recursive: true });
if (!existsSync(ORIG)) {
  console.log(`downloading ${SOURCE}`);
  const res = await fetch(SOURCE, { headers: UA });
  if (!res.ok || !res.body) throw new Error(`${SOURCE}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(ORIG));
}

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=d3d11', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
// tsx keeps function names with a helper (__name) that the page does not have.
await page.addInitScript('window.__name = (f) => f;');
const ORIGIN = 'http://media.local';
const all = readFileSync(ORIG);
await page.route(`${ORIGIN}/**`, async (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<body></body>' });
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
});
await page.goto(`${ORIGIN}/`);
const { webm, poster, size, seconds } = await page.evaluate(async ({ from, to, crop, w, h, fps }) => {
  const v = document.createElement('video');
  v.src = '/first-flight.mp4';
  v.muted = true;
  await new Promise((r) => (v.onloadeddata = r));
  v.currentTime = from;
  await new Promise((r) => (v.onseeked = r));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  const draw = () => g.drawImage(v, crop[0], crop[1], crop[2], crop[3], 0, 0, w, h);
  draw();
  const poster = c.toDataURL('image/webp', 0.82);
  const rec = new MediaRecorder(c.captureStream(fps), {
    mimeType: 'video/webm;codecs=vp9',
    videoBitsPerSecond: 2_500_000,
  });
  const parts: Blob[] = [];
  rec.ondataavailable = (e) => parts.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));
  rec.start(1000);
  const t0 = performance.now();
  await v.play();
  // Every decoded frame of the source, drawn as it is shown.
  await new Promise<void>((done) => {
    const frame = () => {
      draw();
      if (v.currentTime >= to || v.ended) return done();
      v.requestVideoFrameCallback(frame);
    };
    v.requestVideoFrameCallback(frame);
  });
  v.pause();
  rec.stop();
  await stopped;
  const seconds = (performance.now() - t0) / 1000;
  const blob = new Blob(parts, { type: 'video/webm' });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { webm: btoa(bin), poster, size: [v.videoWidth, v.videoHeight], seconds };
}, CLIP);
await browser.close();
if (size[0] !== 1280 || size[1] !== 720) throw new Error(`unexpected source size ${size.join('×')}: check the crop`);

const webmPath = join(OUT, 'first-flight.webm');
const posterPath = join(OUT, 'first-flight.webp');
writeFileSync(webmPath, withDuration(Buffer.from(webm, 'base64'), seconds));
writeFileSync(posterPath, Buffer.from(poster.split(',')[1]!, 'base64'));
writeFileSync(
  CATALOG,
  JSON.stringify(
    {
      title: 'First Video of NASA’s Ingenuity Mars Helicopter in Flight, Including Takeoff and Landing (High-Res)',
      nasaId: NASA_ID,
      credit: 'NASA/JPL-Caltech/ASU/MSSS',
      released: '2021-04-19',
      page: 'https://images.nasa.gov/details/' + encodeURIComponent(NASA_ID),
      camera: 'Mastcam-Z, Perseverance at Van Zyl Overlook, 64.3 m from Wright Brothers Field',
      usage:
        'NASA still images, audio and video are generally not copyrighted. Credit NASA/JPL-Caltech/ASU/MSSS; ' +
        'do not use the NASA insignia or logotype, or imply endorsement (nasa.gov/nasa-brand-center/images-and-media). ' +
        'The cut leaves out the insignia that ends the original.',
      source: { url: SOURCE, file: 'data/raw/media/first-flight.orig.mp4', bytes: statSync(ORIG).size, sha256: await sha256(ORIG) },
      edit: {
        cutS: [CLIP.from, CLIP.to],
        takeoffS: 15.7,
        touchdownS: 39.5,
        cropPx: CLIP.crop,
        durationS: Math.round(seconds * 100) / 100,
        output: `${CLIP.w} × ${CLIP.h}, VP9 WebM, silent`,
      },
      files: [
        { file: 'game/media/first-flight.webm', bytes: statSync(webmPath).size, sha256: await sha256(webmPath) },
        { file: 'game/media/first-flight.webp', bytes: statSync(posterPath).size, sha256: await sha256(posterPath) },
      ],
    },
    null,
    2,
  ) + '\n',
);
console.log(`first flight → ${webmPath} (${(statSync(webmPath).size / 1e6).toFixed(1)} MB)`);
