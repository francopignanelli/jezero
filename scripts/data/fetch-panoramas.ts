/**
 * Downloads the real Mastcam-Z 360° mosaics listed in data/catalog/panoramas.json (originals stay in
 * data/raw/panoramas, gitignored) and places each one at the rover position on its first sol, from the
 * MMGIS traverse snapshot (data/build/rover/rover.json, produced by snapshot-rover.ts).
 *
 * Run: npx tsx scripts/data/fetch-panoramas.ts   then   scripts/geospatial/run.sh panoramas
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const ROOT = join(import.meta.dirname, '..', '..');
const CATALOG = join(ROOT, 'data', 'catalog', 'panoramas.json');
const RAW = join(ROOT, 'data', 'raw', 'panoramas');
const UA = { 'User-Agent': 'Copernico-pipeline/0.1 (NASA Space Apps research prototype)' };

interface Entry {
  id: string;
  sourceUrl: string;
  sourceFile: string;
  sols: [number, number];
  sourceSha256?: string;
  sourceBytes?: number;
  position?: { lat: number; lon: number; basis: string };
}
type Waypoint = [number, number, number, number, number]; // sol, lat, lon, elevation, distance

const catalog = JSON.parse(readFileSync(CATALOG, 'utf8')) as { panoramas: Entry[] };
const rover = JSON.parse(readFileSync(join(ROOT, 'data', 'build', 'rover', 'rover.json'), 'utf8')) as {
  waypoints: Waypoint[];
};

/** Rover position for a mosaic taken over sols [first, last]: the last drive ending on or before `first`. */
function positionFor([first, last]: [number, number]): Entry['position'] {
  const before = rover.waypoints.filter((w) => w[0] <= first);
  const next = rover.waypoints.find((w) => w[0] > first);
  if (next && next[0] <= last && next[4] - (before.at(-1)?.[4] ?? 0) > 1) {
    console.warn(`  the rover drove on sol ${next[0]}, inside sols ${first}–${last}: position is for sol ${first}`);
  }
  if (before.length === 0) {
    const start = rover.waypoints[0]!; // before the first logged drive: the start of that drive
    return {
      lat: start[1],
      lon: start[2],
      basis: `MMGIS start of the first logged drive (sol ${start[0]}); the rover had not driven before it.`,
    };
  }
  const w = before.at(-1)!;
  return {
    lat: w[1],
    lon: w[2],
    basis: `MMGIS waypoint at the end of the sol ${w[0]} drive${next ? `; the next drive is on sol ${next[0]}` : ''}.`,
  };
}

mkdirSync(RAW, { recursive: true });
for (const p of catalog.panoramas) {
  p.position = positionFor(p.sols);
  const dest = join(RAW, p.sourceFile);
  if (!existsSync(dest) || (p.sourceBytes && statSync(dest).size !== p.sourceBytes)) {
    const res = await fetch(p.sourceUrl, { headers: UA });
    if (!res.ok || !res.body) throw new Error(`${p.id}: HTTP ${res.status}`);
    process.stdout.write(`${p.id}: downloading ${(Number(res.headers.get('content-length')) / 1e6).toFixed(0)} MB… `);
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest));
    console.log('done');
  }
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(dest)) hash.update(chunk as Buffer);
  p.sourceSha256 = hash.digest('hex');
  p.sourceBytes = statSync(dest).size;
  console.log(`${p.id}: ${p.position!.lat.toFixed(5)}, ${p.position!.lon.toFixed(5)} · ${(p.sourceBytes / 1e6).toFixed(0)} MB`);
}
writeFileSync(CATALOG, JSON.stringify(catalog, null, 2) + '\n');
