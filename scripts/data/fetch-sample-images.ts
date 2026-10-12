/**
 * Downloads one NASA image per Perseverance sample, listed in data/catalog/sample-images.json (from
 * NASA's "Mars Rock Samples" page): mostly the drill hole and abraded patch where the core was
 * taken. Originals stay in data/raw/sample-images (gitignored); size and SHA-256 go back into the
 * catalog. Anything that is not an image is refused (a page summary may have garbled a URL).
 *
 * Run: npx tsx scripts/data/fetch-sample-images.ts   then   scripts/geospatial/run.sh sample-images
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const CATALOG = join(ROOT, 'data', 'catalog', 'sample-images.json');
const RAW = join(ROOT, 'data', 'raw', 'sample-images');
const UA = { 'User-Agent': 'Copernico-pipeline/0.1 (NASA Space Apps research prototype)' };

interface Entry {
  number: number;
  name: string;
  sourceUrl: string;
  sourceFile?: string;
  sourceBytes?: number;
  sourceSha256?: string;
  retrievedUtc?: string;
}

const catalog = JSON.parse(readFileSync(CATALOG, 'utf8')) as { images: Entry[] };
mkdirSync(RAW, { recursive: true });
const failed: string[] = [];
for (const e of catalog.images) {
  const ext = new URL(e.sourceUrl).pathname.split('.').pop()!.toLowerCase();
  const name = `${e.number}.${ext}`;
  const dest = join(RAW, name);
  if (!existsSync(dest) || (e.sourceBytes && statSync(dest).size !== e.sourceBytes)) {
    const res = await fetch(e.sourceUrl, { headers: UA });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.startsWith('image/')) {
      failed.push(`#${e.number} ${e.name}: HTTP ${res.status} ${type}`);
      continue;
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length < 10_000) {
      failed.push(`#${e.number} ${e.name}: only ${bytes.length} bytes`);
      continue;
    }
    writeFileSync(dest, bytes);
    e.retrievedUtc = new Date().toISOString();
  }
  const data = readFileSync(dest);
  e.sourceFile = name;
  e.sourceBytes = data.length;
  e.sourceSha256 = createHash('sha256').update(data).digest('hex');
  console.log(`#${e.number} ${e.name}: ${(data.length / 1e3).toFixed(0)} kB`);
}
writeFileSync(CATALOG, JSON.stringify(catalog, null, 2) + '\n');
if (failed.length) {
  console.error(`\nNot downloaded (${failed.length}):\n${failed.join('\n')}`);
  process.exitCode = 1;
}
