/**
 * Downloads NASA's official landing video ("Perseverance Rover's Descent and Touchdown on Mars",
 * NASA/JPL-Caltech, 22 Feb 2021) from the NASA Image and Video Library, with its captions, into
 * data/build/game/media/ for the game's landing intro. Records size and SHA-256 in
 * data/catalog/landing-video.json. NASA video is generally not copyrighted; credit NASA/JPL-Caltech.
 *
 * Run: npx tsx scripts/data/fetch-landing-video.ts
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const ROOT = join(import.meta.dirname, '..', '..');
const OUT = join(ROOT, 'data', 'build', 'game', 'media');
const CATALOG = join(ROOT, 'data', 'catalog', 'landing-video.json');
const UA = { 'User-Agent': 'Copernico-pipeline/0.1 (NASA Space Apps research prototype)' };

const NASA_ID = 'JPL-20210222-M2020f-0001-Perseverance Rover’s Descent and Touchdown on Mars';
const BASE = `https://images-assets.nasa.gov/video/${encodeURIComponent(NASA_ID)}/${encodeURIComponent(NASA_ID)}`;
// The "medium" rendition: the size for the web (the original is about 260 MB).
const FILES = [
  { url: `${BASE}~medium.mp4`, file: 'landing.mp4' },
  { url: `${BASE}.srt`, file: 'landing.en.srt' },
];

async function download(url: string, path: string): Promise<void> {
  const res = await fetch(url, { headers: UA });
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(path));
}

async function sha256(path: string): Promise<string> {
  const h = createHash('sha256');
  await pipeline(createReadStream(path), h);
  return h.digest('hex');
}

mkdirSync(OUT, { recursive: true });
const entries = [];
for (const f of FILES) {
  const path = join(OUT, f.file);
  if (!existsSync(path)) {
    console.log(`downloading ${f.url}`);
    await download(f.url, path);
  }
  entries.push({ file: `game/media/${f.file}`, sourceUrl: f.url, bytes: statSync(path).size, sha256: await sha256(path) });
}
// The captions as WebVTT, the format browsers read for <track>.
const srt = readFileSync(join(OUT, 'landing.en.srt'), 'utf8')
  .replace(/^\uFEFF/, '')
  .replace(/\r/g, '');
const vtt = 'WEBVTT\n\n' + srt.replace(/(\d\d:\d\d:\d\d),(\d\d\d)/g, '$1.$2');
const vttPath = join(OUT, 'landing.en.vtt');
writeFileSync(vttPath, vtt);
entries.push({
  file: 'game/media/landing.en.vtt',
  sourceUrl: 'landing.en.srt, converted to WebVTT',
  bytes: statSync(vttPath).size,
  sha256: await sha256(vttPath),
});
writeFileSync(
  CATALOG,
  JSON.stringify(
    {
      title: 'Perseverance Rover’s Descent and Touchdown on Mars: Onboard Camera Views',
      nasaId: NASA_ID,
      credit: 'NASA/JPL-Caltech',
      released: '2021-02-22',
      page: 'https://images.nasa.gov/details/' + encodeURIComponent(NASA_ID),
      usage:
        'NASA still images, audio and video are generally not copyrighted. Credit NASA/JPL-Caltech; ' +
        'do not use the NASA insignia or logotype, or imply endorsement (nasa.gov/nasa-brand-center/images-and-media).',
      files: entries,
    },
    null,
    2,
  ) + '\n',
);
console.log(entries.map((e) => `${e.file}: ${(e.bytes / 1e6).toFixed(1)} MB`).join('\n'));
