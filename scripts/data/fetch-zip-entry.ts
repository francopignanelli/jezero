/**
 * Downloads ONE file from inside a large remote ZIP (HTTP range requests on the central directory,
 * the entry's local header and its compressed bytes) and inflates it to disk, so a 676 MB DTM can be
 * taken from the 5.47 GB USGS MSR HiRISE archive without downloading the rest.
 *
 * Run: npx tsx scripts/data/fetch-zip-entry.ts            (the MSR 1 m DTM, from the mosaics ZIP)
 *      npx tsx scripts/data/fetch-zip-entry.ts images <path inside the ZIP> <dataset id>
 *        (one file of the individual-images ZIP, e.g. the HiRISE orthoimage over the crater rim)
 * Output: data/raw/msr-hirise/<entry name> + .provenance.json (sha256 of the inflated file).
 */
import { createHash } from 'node:crypto';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw } from 'node:zlib';

const ROOT = join(import.meta.dirname, '..', '..');
const [which, entryPath, datasetArg] = process.argv.slice(2);
const ZIP = `https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/MSR_TRN_HiRISE_soc_003_USGS_release_aug2024/MSR_TRN_HiRISE_soc_003_USGS_release_aug2024_${which === 'images' ? 'images' : 'mosaics'}.zip`;
/** The entry's path inside the ZIP (after the release folder), and its file name. */
const ENTRY_PATH = entryPath ?? 'mosaics/MSR_hirise_soc_003_DTM_MOLATopography_DeltaGeoid_1m_Eqc_latTs0_lon0_Blend40.tif';
const ENTRY = ENTRY_PATH.split('/').pop()!;
const DATASET = datasetArg ?? 'msr-hirise-dtm';
const OUT = join(ROOT, 'data', 'raw', 'msr-hirise');
const UA = { 'User-Agent': 'Copernico-pipeline/0.1 (NASA Space Apps research prototype)' };

async function range(start: number, end: number): Promise<Buffer> {
  const res = await fetch(ZIP, { headers: { ...UA, Range: `bytes=${start}-${end}` } });
  if (res.status !== 206) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const size = Number((await fetch(ZIP, { method: 'HEAD', headers: UA })).headers.get('content-length'));
const tail = await range(size - 70_000, size - 1);
const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
let cdSize = tail.readUInt32LE(eocd + 12);
let cdOff = tail.readUInt32LE(eocd + 16);
const loc64 = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x07]));
if (loc64 >= 0) {
  const z = await range(Number(tail.readBigUInt64LE(loc64 + 8)), Number(tail.readBigUInt64LE(loc64 + 8)) + 55);
  cdSize = Number(z.readBigUInt64LE(40));
  cdOff = Number(z.readBigUInt64LE(48));
}
const cd = await range(cdOff, cdOff + cdSize - 1);

let entry: { method: number; csize: number; usize: number; offset: number; crc: number } | null = null;
for (let p = 0; p < cd.length && cd.readUInt32LE(p) === 0x02014b50; ) {
  const method = cd.readUInt16LE(p + 10);
  const crc = cd.readUInt32LE(p + 16);
  let csize = cd.readUInt32LE(p + 20);
  let usize = cd.readUInt32LE(p + 24);
  const nlen = cd.readUInt16LE(p + 28);
  const xlen = cd.readUInt16LE(p + 30);
  const clen = cd.readUInt16LE(p + 32);
  let offset = cd.readUInt32LE(p + 42);
  const name = cd.toString('utf8', p + 46, p + 46 + nlen);
  for (let x = p + 46 + nlen; x < p + 46 + nlen + xlen; ) {
    const id = cd.readUInt16LE(x);
    const len = cd.readUInt16LE(x + 2);
    if (id === 1) {
      let q = x + 4;
      if (usize === 0xffffffff) {
        usize = Number(cd.readBigUInt64LE(q));
        q += 8;
      }
      if (csize === 0xffffffff) {
        csize = Number(cd.readBigUInt64LE(q));
        q += 8;
      }
      if (offset === 0xffffffff) offset = Number(cd.readBigUInt64LE(q));
    }
    x += 4 + len;
  }
  if (name.endsWith(`/${ENTRY_PATH}`)) entry = { method, csize, usize, offset, crc };
  p += 46 + nlen + xlen + clen;
}
if (!entry || entry.method !== 8) throw new Error('entry not found or not deflated');

const local = await range(entry.offset, entry.offset + 29);
const dataStart = entry.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
console.log(`${ENTRY}: ${(entry.csize / 1e6).toFixed(0)} MB compressed → ${(entry.usize / 1e6).toFixed(0)} MB`);

mkdirSync(OUT, { recursive: true });
const dest = join(OUT, ENTRY);
const res = await fetch(ZIP, { headers: { ...UA, Range: `bytes=${dataStart}-${dataStart + entry.csize - 1}` } });
if (res.status !== 206 || !res.body) throw new Error(`HTTP ${res.status}`);
const hash = createHash('sha256');
let written = 0;
const inflate = createInflateRaw();
inflate.on('data', (chunk: Buffer) => {
  hash.update(chunk);
  written += chunk.length;
  if (written % (64 << 20) < chunk.length) process.stdout.write(`\r${(written / 1e6).toFixed(0)} MB`);
});
await pipeline(Readable.fromWeb(res.body as never), inflate, createWriteStream(dest));
process.stdout.write('\n');
if (written !== entry.usize) throw new Error(`size mismatch ${written} vs ${entry.usize}`);
writeFileSync(
  `${dest}.provenance.json`,
  JSON.stringify(
    {
      artifact: ENTRY,
      bytes: written,
      sha256: hash.digest('hex'),
      zipCrc32: entry.crc.toString(16),
      retrievedUtc: new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00'),
      datasetId: DATASET,
      sourceUrl: ZIP,
      method: 'zip-entry-range (scripts/data/fetch-zip-entry.ts)',
    },
    null,
    2,
  ),
);
console.log(`wrote ${dest}`);
