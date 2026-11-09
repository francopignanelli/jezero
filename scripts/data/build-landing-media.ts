/**
 * Media for the home page (apps/web/index.html), into data/build/landing/:
 * - hero.webm: a muted loop for the background, cut from NASA's landing video (fetch-landing-video.ts):
 *   the descent-stage camera looking down at Jezero as the ground comes up, cropped to 16:9 and
 *   re-encoded in headless Chrome (MediaRecorder, VP9); hero.webp, its first frame (the poster).
 * - planner.webp, game.webp: screenshots of the two modes, from the running dev server.
 *
 * Run (with `npm run dev` up): npx tsx scripts/data/build-landing-media.ts [http://localhost:5180]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = join(import.meta.dirname, '..', '..');
const OUT = join(ROOT, 'data', 'build', 'landing');
const VIDEO = join(ROOT, 'data', 'build', 'game', 'media', 'landing.mp4');
const BASE = process.argv[2] ?? 'http://localhost:5180';

/** The clip: seconds of the NASA video, and the descent camera's picture in its 1280 × 720 frame. */
const CLIP = { from: 96, seconds: 24, crop: [290, 92, 732, 412] as const, w: 1280, h: 720 };

mkdirSync(OUT, { recursive: true });
// tsx keeps function names with a helper (__name) that the page does not have.
const NAME_SHIM = 'window.__name = (f) => f;';
const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=d3d11', '--ignore-gpu-blocklist'],
});

// ---- the hero loop ----
{
  const page = await browser.newPage();
  await page.addInitScript(NAME_SHIM);
  const ORIGIN = 'http://media.local';
  let video: Buffer | null = null;
  await page.route(`${ORIGIN}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<body></body>' });
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
  });
  await page.goto(`${ORIGIN}/`);
  const { webm, poster } = await page.evaluate(async ({ from, seconds, crop, w, h }) => {
    const v = document.createElement('video');
    v.src = '/landing.mp4';
    v.muted = true;
    await new Promise((r) => (v.onloadeddata = r));
    v.currentTime = from;
    await new Promise((r) => (v.onseeked = r));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    const draw = () => g.drawImage(v, crop[0], crop[1], crop[2], crop[3], 0, 0, w, h);
    draw();
    const poster = c.toDataURL('image/webp', 0.8);
    const rec = new MediaRecorder(c.captureStream(30), {
      mimeType: 'video/webm;codecs=vp9',
      videoBitsPerSecond: 1_800_000,
    });
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => parts.push(e.data);
    const stopped = new Promise((r) => (rec.onstop = r));
    rec.start(1000);
    await v.play();
    await new Promise<void>((done) => {
      const tick = () => {
        draw();
        if (v.currentTime >= from + seconds || v.ended) return done();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    v.pause();
    rec.stop();
    await stopped;
    const buf = await new Blob(parts, { type: 'video/webm' }).arrayBuffer();
    let bin = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { webm: btoa(bin), poster };
  }, CLIP);
  writeFileSync(join(OUT, 'hero.webm'), Buffer.from(webm, 'base64'));
  writeFileSync(join(OUT, 'hero.webp'), Buffer.from(poster.split(',')[1]!, 'base64'));
  await page.close();
}

// ---- the two modes, as they look ----
const shot = async (url: string, prepare: (p: import('@playwright/test').Page) => Promise<void>, file: string) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  await page.addInitScript(NAME_SHIM);
  await page.addInitScript(() => {
    try {
      localStorage.setItem('copernico.welcomed', '1');
      localStorage.setItem('copernico.game.tips.v1', JSON.stringify(['drive', 'look', 'map', 'inventory', 'warp', 'photo', 'pause']));
    } catch {
      // ignore
    }
  });
  await page.goto(url);
  await prepare(page);
  const png = await page.screenshot();
  // WebP through the browser's own encoder.
  const webp = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 960;
    c.height = Math.round((img.height / img.width) * 960);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/webp', 0.82);
  }, png.toString('base64'));
  writeFileSync(join(OUT, file), Buffer.from(webp.split(',')[1]!, 'base64'));
  await page.close();
};

await shot(
  `${BASE}/planner.html`,
  async (p) => {
    await p.locator('.loading-screen').waitFor({ state: 'detached', timeout: 120_000 });
    await p.getByRole('button', { name: 'Explore Jezero' }).click();
    await p.waitForTimeout(9000);
  },
  'planner.webp',
);
await shot(
  `${BASE}/play.html`,
  async (p) => {
    await p.getByRole('button', { name: 'Start: The delta front' }).click({ timeout: 120_000 });
    await p.getByRole('button', { name: 'Start driving' }).click({ timeout: 60_000 });
    await p.waitForTimeout(1500);
    await p.evaluate(() => {
      const g = (window as unknown as { __copernicoGame: { teleport(a: number, b: number): void; rover: { headingRad: number }; world: { rig: { snap(h: number): void } } } }).__copernicoGame;
      g.rover = { ...g.rover, headingRad: (200 * Math.PI) / 180 };
      g.teleport(18.458647, 77.405925 + 6 / 56230);
      g.world.rig.snap((200 * Math.PI) / 180);
    });
    await p.waitForTimeout(3500);
  },
  'game.webp',
);
await browser.close();
console.log(`landing media → ${OUT}`);
