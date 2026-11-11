/**
 * Slides for the rover game's Ingenuity deployment: NASA's real images of each stage, shown in a
 * panel while the deployment runs (the game does not animate it).
 * - shield: PIA24448, the debris shield on the ground, sol 30 (NASA Image and Video Library).
 * - stowed … down: the frames of PIA24548, "Ingenuity's Complete Deployment" (WATSON on the
 *   rover's arm, sols 35–39, and Ingenuity on the ground after the rover drove off, sol 43),
 *   an animated GIF on science.nasa.gov; its last frame repeats, so six of its seven are kept.
 * Frames are decoded in headless Chrome (ImageDecoder), trimmed of the mosaic's dark border and
 * saved as 960 px WebP in data/build/game/deploy/; sources and SHA-256 in
 * data/catalog/deploy-slides.json. NASA images are generally not copyrighted (credit NASA/JPL-Caltech/MSSS).
 *
 * Run: npx tsx scripts/data/fetch-deploy-slides.ts
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = join(import.meta.dirname, '..', '..');
const RAW = join(ROOT, 'data', 'raw', 'mission-cards');
const OUT = join(ROOT, 'data', 'build', 'game', 'deploy');
const CATALOG = join(ROOT, 'data', 'catalog', 'deploy-slides.json');
const UA = { 'User-Agent': 'Copernico-pipeline/0.1 (NASA Space Apps research prototype)' };
const GIF_URL =
  'https://assets.science.nasa.gov/content/dam/science/psd/mars/resources/detail_files/2/5/25792_PIA24548-1200.gif';
const SHIELD = 'PIA24448';
const W = 960;

/** Slide → source: the shield image, then the GIF's frames by index. Crop: fractions kept (x, y, w, h). */
const SLIDES: Array<{ key: string; from: 'shield' | number; crop: [number, number, number, number] }> = [
  { key: 'shield', from: 'shield', crop: [0.07, 0.05, 0.9, 0.9] },
  { key: 'stowed', from: 0, crop: [0.035, 0.02, 0.94, 0.92] },
  { key: 'lock', from: 1, crop: [0.035, 0.02, 0.94, 0.92] },
  { key: 'swing', from: 2, crop: [0.035, 0.02, 0.94, 0.92] },
  { key: 'upright', from: 3, crop: [0.035, 0.02, 0.94, 0.92] },
  { key: 'legs', from: 4, crop: [0.035, 0.02, 0.94, 0.92] },
  { key: 'down', from: 5, crop: [0, 0, 1, 1] },
];

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
mkdirSync(RAW, { recursive: true });
mkdirSync(OUT, { recursive: true });

async function cached(url: string, file: string): Promise<Buffer> {
  const path = join(RAW, file);
  if (!existsSync(path)) {
    const res = await fetch(url, { headers: UA });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  }
  return readFileSync(path);
}
const gif = await cached(GIF_URL, 'PIA24548.gif');
const shieldFiles = (await (await fetch(`https://images-assets.nasa.gov/image/${SHIELD}/collection.json`, { headers: UA })).json()) as string[];
const shieldUrl = (shieldFiles.find((u) => u.endsWith('~medium.jpg')) ?? shieldFiles.find((u) => u.endsWith('~large.jpg')))!
  .replace(/^http:/, 'https:')
  .replace(/ /g, '%20');
const shield = await cached(shieldUrl, `${SHIELD}.jpg`);

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
// A localhost origin: ImageDecoder needs a secure context.
const ORIGIN = 'http://localhost:5998';
await page.route(`${ORIGIN}/**`, (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<body></body>' });
  if (path === '/deploy.gif') return route.fulfill({ contentType: 'image/gif', body: gif });
  return route.fulfill({ contentType: 'image/jpeg', body: shield });
});
await page.goto(`${ORIGIN}/`);
const images = await page.evaluate(
  async ({ slides, W }) => {
    const dec = new ImageDecoder({ data: await (await fetch('/deploy.gif')).arrayBuffer(), type: 'image/gif' });
    await dec.tracks.ready;
    const still = new Image();
    still.src = '/shield.jpg';
    await still.decode();
    const out: string[] = [];
    for (const s of slides) {
      const src = s.from === 'shield' ? still : (await dec.decode({ frameIndex: s.from })).image;
      const sw = 'naturalWidth' in src ? src.naturalWidth : src.displayWidth;
      const sh = 'naturalHeight' in src ? src.naturalHeight : src.displayHeight;
      const [x, y, w, h] = s.crop;
      const c = document.createElement('canvas');
      c.width = W;
      c.height = Math.round((W * h * sh) / (w * sw));
      c.getContext('2d')!.drawImage(src, x * sw, y * sh, w * sw, h * sh, 0, 0, c.width, c.height);
      out.push(c.toDataURL('image/webp', 0.82));
    }
    return out;
  },
  { slides: SLIDES, W },
);
await browser.close();

const files = SLIDES.map((s, i) => {
  const buf = Buffer.from(images[i]!.split(',')[1]!, 'base64');
  writeFileSync(join(OUT, `${s.key}.webp`), buf);
  return {
    key: s.key,
    file: `game/deploy/${s.key}.webp`,
    source: s.from === 'shield' ? `${SHIELD} (${shieldUrl})` : `PIA24548 frame ${s.from}`,
    crop: s.crop,
    bytes: buf.length,
    sha256: sha256(buf),
  };
});
writeFileSync(
  CATALOG,
  JSON.stringify(
    {
      description:
        'Slides shown while the rover game deploys Ingenuity: NASA’s own images of each stage, in order (the game does not animate the deployment).',
      credit: 'NASA/JPL-Caltech/MSSS (WATSON); NASA/JPL-Caltech/ASU/MSSS (Mastcam-Z)',
      sources: {
        PIA24548: { title: 'Ingenuity’s Complete Deployment', url: GIF_URL, sha256: sha256(gif), page: 'https://images.nasa.gov/details/PIA24548' },
        [SHIELD]: { title: 'Perseverance Rover Drops its Debris Shield', url: shieldUrl, sha256: sha256(shield), page: `https://images.nasa.gov/details/${SHIELD}` },
      },
      slides: files,
    },
    null,
    2,
  ) + '\n',
);
console.log(files.map((f) => `${f.key}: ${Math.round(f.bytes / 1024)} KB`).join('\n'));
