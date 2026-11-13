/**
 * A 2K Milky Way (2048 × 1024) for the planner's first view: 0.7 MB instead of the 4K's 2.8 MB on
 * the loading screen's critical path. The 4K (or, on large screens, the 8K) replaces it once the
 * scene is shown. Downsampled from milkyway_4k.webp in headless Chrome (same projection).
 *
 * Run (after build-sky.ts and run.sh sky): npx tsx scripts/data/build-sky-2k.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const SKY = join(import.meta.dirname, '..', '..', 'data', 'build', 'sky');
const src = readFileSync(join(SKY, 'milkyway_4k.webp'));
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.setContent('<body></body>');
const webp = await page.evaluate(async (b64) => {
  const img = new Image();
  img.src = `data:image/webp;base64,${b64}`;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth / 2;
  c.height = img.naturalHeight / 2;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return [c.toDataURL('image/webp', 0.86), c.width, c.height] as const;
}, src.toString('base64'));
await browser.close();
const out = Buffer.from(webp[0].split(',')[1]!, 'base64');
writeFileSync(join(SKY, 'milkyway_2k.webp'), out);
console.log(`milkyway_2k.webp: ${webp[1]}×${webp[2]}, ${Math.round(out.length / 1024)} KB`);
