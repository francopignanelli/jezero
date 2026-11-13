/**
 * NASA's own pictures of the moments the rover game's missions 3, 4, 6 and 7 stop on (MOXIE at
 * work, Ingenuity's photos from its flight 26, the leopard spots of Cheyava Falls, the helicopter at
 * its last airfield, Lookout Hill…), shown in the game's story cards (GameApp's StoryCard).
 * From the NASA Image and Video Library: the large rendition (or medium), scaled to at most 1200 px
 * wide and saved as WebP in data/build/game/story/, encoded in headless Chrome; titles, credits
 * (from each image's own description), sources and SHA-256 in data/catalog/story-images.json.
 *
 * Run: npx tsx scripts/data/fetch-story-images.ts
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = join(import.meta.dirname, '..', '..');
const RAW = join(ROOT, 'data', 'raw', 'story-images');
const OUT = join(ROOT, 'data', 'build', 'game', 'story');
const CATALOG = join(ROOT, 'data', 'catalog', 'story-images.json');
const UA = { 'User-Agent': 'Copernico-pipeline/0.1 (NASA Space Apps research prototype)' };
const W = 1200;

/** Story key (game.story.<key> in the i18n files) → NASA image. */
const IMAGES: Array<{ key: string; id: string }> = [
  // Mission 3: the empty tube, MOXIE, Rochette.
  { key: 'roubion', id: 'PIA24749' },
  { key: 'moxie', id: 'PIA24176' },
  { key: 'rochette', id: 'PIA24831' },
  // Mission 4: Ingenuity's flight 26 over the landing gear, and its last flight.
  { key: 'backshell', id: 'PIA25219' },
  { key: 'parachute', id: 'PIA25217' },
  { key: 'debris', id: 'PIA25218' },
  { key: 'lastFlight', id: 'PIA26243' },
  // Mission 6: Cheyava Falls, and Ingenuity at Valinor Hills seen by the rover.
  { key: 'leopard', id: 'PIA26368' },
  { key: 'valinor', id: 'PIA26236' },
  // Mission 7: the rim.
  { key: 'lookout', id: 'PIA26511' },
  { key: 'devil', id: 'PIA26528' },
];

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
mkdirSync(RAW, { recursive: true });
mkdirSync(OUT, { recursive: true });

interface Meta {
  title: string;
  credit: string;
  url: string;
}
async function meta(id: string): Promise<Meta> {
  const files = (await (await fetch(`https://images-assets.nasa.gov/image/${id}/collection.json`, { headers: UA })).json()) as string[];
  const pick =
    files.find((u) => u.endsWith('~large.jpg')) ??
    files.find((u) => u.endsWith('~medium.jpg')) ??
    files.find((u) => u.endsWith('~orig.jpg'));
  if (!pick) throw new Error(`${id}: no large, medium or original rendition`);
  const search = (await (await fetch(`https://images-api.nasa.gov/search?nasa_id=${id}`, { headers: UA })).json()) as {
    collection: { items: Array<{ data: Array<{ title: string; description?: string }> }> };
  };
  const d = search.collection.items[0]?.data[0];
  if (!d) throw new Error(`${id}: no metadata`);
  // "Credit: NASA/JPL-Caltech/ASU/MSSS" (or "Image credit: …") in the description.
  const credit = /credit:\s*([^\n<]+?)(?:\.\s|\s*<|\s*$)/i.exec(d.description ?? '')?.[1]?.trim() ?? 'NASA/JPL-Caltech';
  return { title: d.title.trim(), credit, url: pick.replace(/^http:/, 'https:').replace(/ /g, '%20') };
}

const sources: Array<{ key: string; buf: Buffer }> = [];
const entries: Array<Record<string, unknown>> = [];
for (const im of IMAGES) {
  const m = await meta(im.id);
  const raw = join(RAW, `${im.id}.jpg`);
  if (!existsSync(raw)) {
    const res = await fetch(m.url, { headers: UA });
    if (!res.ok) throw new Error(`${m.url}: HTTP ${res.status}`);
    writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
  }
  const buf = readFileSync(raw);
  sources.push({ key: im.key, buf });
  entries.push({
    key: im.key,
    file: `game/story/${im.key}.webp`,
    nasaId: im.id,
    title: m.title,
    credit: m.credit,
    page: `https://images.nasa.gov/details/${im.id}`,
    sourceUrl: m.url,
    sourceSha256: sha256(buf),
  });
}

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.setContent('<body></body>');
for (const [i, s] of sources.entries()) {
  const webp = await page.evaluate(
    async ({ b64, W }) => {
      const img = new Image();
      img.src = `data:image/jpeg;base64,${b64}`;
      await img.decode();
      const k = Math.min(1, W / img.naturalWidth);
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k);
      c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      return [c.toDataURL('image/webp', 0.84), c.width, c.height] as const;
    },
    { b64: s.buf.toString('base64'), W },
  );
  const out = Buffer.from(webp[0].split(',')[1]!, 'base64');
  writeFileSync(join(OUT, `${s.key}.webp`), out);
  Object.assign(entries[i]!, { width: webp[1], height: webp[2], bytes: out.length, sha256: sha256(out) });
}
await browser.close();

writeFileSync(
  CATALOG,
  JSON.stringify(
    {
      description: 'NASA images shown in the rover game’s story cards (missions 3, 4, 6 and 7).',
      retrievedUtc: new Date().toISOString(),
      images: entries,
    },
    null,
    2,
  ) + '\n',
);
console.log(entries.map((e) => `${e.key}: ${e.nasaId} · ${e.credit} · ${Math.round((e.bytes as number) / 1024)} KB · ${e.title}`).join('\n'));
