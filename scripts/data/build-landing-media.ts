/**
 * Media for the home page (apps/web/index.html), into data/build/landing/:
 * - mars-3840.webp and mars-1920.webp: the background, a still of Jezero's floor with the delta
 *   beyond ("Perseverance's Office on Mars", PIA24765, Mastcam-Z, NASA/JPL-Caltech/ASU/MSSS,
 *   14072 × 7021), cropped inside the mosaic's edges to 16:9 and encoded in headless Chrome.
 * - planner.webp, game.webp: screenshots of the two modes, from the running dev server.
 *
 * Run (with `npm run dev` up): npx tsx scripts/data/build-landing-media.ts [http://localhost:5180]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';

const ROOT = join(import.meta.dirname, '..', '..');
const OUT = join(ROOT, 'data', 'build', 'landing');
const RAW = join(ROOT, 'data', 'raw', 'mission-cards');
const BASE = process.argv[2] ?? 'http://localhost:5180';
const UA = { 'User-Agent': 'Copernico-pipeline/0.1 (NASA Space Apps research prototype)' };

/** The background: NASA's original, and the part kept (fractions x, y, width; 16:9). */
const BACKGROUND = {
  id: 'PIA24765',
  url: 'https://images-assets.nasa.gov/image/PIA24765/PIA24765~orig.jpg',
  crop: [0.11, 0.06, 0.77] as const,
  sizes: [3840, 1920],
};

mkdirSync(OUT, { recursive: true });
mkdirSync(RAW, { recursive: true });
// tsx keeps function names with a helper (__name) that the page does not have.
const NAME_SHIM = 'window.__name = (f) => f;';
const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'],
});

// ---- the background ----
{
  const raw = join(RAW, `${BACKGROUND.id}-orig.jpg`);
  if (!existsSync(raw)) {
    const res = await fetch(BACKGROUND.url, { headers: UA });
    if (!res.ok) throw new Error(`${BACKGROUND.url}: HTTP ${res.status}`);
    writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
  }
  const jpg = readFileSync(raw);
  const page = await browser.newPage();
  await page.addInitScript(NAME_SHIM);
  const ORIGIN = 'http://media.local';
  await page.route(`${ORIGIN}/**`, (route) =>
    new URL(route.request().url()).pathname === '/'
      ? route.fulfill({ contentType: 'text/html', body: '<body></body>' })
      : route.fulfill({ contentType: 'image/jpeg', body: jpg }),
  );
  await page.goto(`${ORIGIN}/`);
  const out = await page.evaluate(
    async ({ crop, sizes }) => {
      const img = new Image();
      img.src = '/bg.jpg';
      await img.decode();
      const [x, y, w] = crop;
      const sw = w * img.naturalWidth;
      const sh = (sw * 9) / 16;
      return sizes.map((W) => {
        const c = document.createElement('canvas');
        c.width = W;
        c.height = Math.round((W * 9) / 16);
        const g = c.getContext('2d')!;
        g.imageSmoothingQuality = 'high';
        g.drawImage(img, x * img.naturalWidth, y * img.naturalHeight, sw, sh, 0, 0, c.width, c.height);
        return c.toDataURL('image/webp', W > 2000 ? 0.78 : 0.8);
      });
    },
    { crop: BACKGROUND.crop, sizes: BACKGROUND.sizes },
  );
  BACKGROUND.sizes.forEach((W, i) => writeFileSync(join(OUT, `mars-${W}.webp`), Buffer.from(out[i]!.split(',')[1]!, 'base64')));
  await page.close();
}

// ---- the two modes, as they look ----
const shot = async (url: string, prepare: (p: Page) => Promise<void>, file: string) => {
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
