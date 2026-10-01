/**
 * Reads a lon/lat window from a huge remote *uncompressed, stripped* GeoTIFF with HTTP range
 * requests (only the needed bytes of each row), and writes it as raw band-sequential data plus a
 * GDAL VRT that carries the source georeferencing. Used for the 12.7 GB Viking MDIM 2.1 colour
 * mosaic, where GDAL's /vsicurl/ reads fail with dropped connections from inside Docker.
 *
 * Run: npx tsx scripts/data/fetch-tiff-window.ts
 * Output: data/raw/viking-mdim21-232/{viking_hd_window.bsq, viking_hd_window.vrt, *.provenance.json}
 * The geospatial pipeline (run.sh imagery-hd) then tiles the VRT.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const DATASET = 'viking-mdim21-232';
const URL_ = 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars_Viking_MDIM21_ClrMosaic_global_232m.tif';
/** Same box as VIKING_HD in scripts/geospatial/copernico_geo/imagery.py (+ ~0.05° margin). */
const BOX = { west: 69.95, east: 85.05, south: 11.95, north: 25.05 };
const R = 3_396_190;
const OUT = join(ROOT, 'data', 'raw', DATASET);
const UA = { 'User-Agent': 'Copernico-pipeline/0.1 (NASA Space Apps research prototype)' };

async function range(start: number, end: number): Promise<Buffer> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(URL_, { headers: { ...UA, Range: `bytes=${start}-${end}` } });
      if (res.status !== 206) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length !== end - start + 1) throw new Error(`short read ${buf.length}`);
      return buf;
    } catch (e) {
      if (attempt >= 8) throw e;
      await new Promise((r) => setTimeout(r, 500 * 2 ** Math.min(attempt, 5)));
    }
  }
}

// ---- TIFF / BigTIFF structure ----
const head = await range(0, 15);
if (head.toString('latin1', 0, 2) !== 'II') throw new Error('expected little-endian TIFF');
const big = head.readUInt16LE(2) === 43;
if (!big && head.readUInt16LE(2) !== 42) throw new Error('not a TIFF');
const ifdOffset = big ? Number(head.readBigUInt64LE(8)) : head.readUInt32LE(4);
const countBuf = await range(ifdOffset, ifdOffset + (big ? 7 : 1));
const nEntries = big ? Number(countBuf.readBigUInt64LE(0)) : countBuf.readUInt16LE(0);
const entrySize = big ? 20 : 12;
const entriesStart = ifdOffset + (big ? 8 : 2);
const entries = await range(entriesStart, entriesStart + nEntries * entrySize - 1);

interface Entry {
  type: number;
  count: number;
  valueOffset: Buffer;
}
const tags = new Map<number, Entry>();
for (let i = 0; i < nEntries; i++) {
  const o = i * entrySize;
  tags.set(entries.readUInt16LE(o), {
    type: entries.readUInt16LE(o + 2),
    count: big ? Number(entries.readBigUInt64LE(o + 4)) : entries.readUInt32LE(o + 4),
    valueOffset: entries.subarray(o + (big ? 12 : 8), o + entrySize),
  });
}
const TYPE_SIZE: Record<number, number> = { 3: 2, 4: 4, 16: 8 };
async function values(tag: number): Promise<number[]> {
  const e = tags.get(tag);
  if (!e) throw new Error(`missing tag ${tag}`);
  const size = TYPE_SIZE[e.type];
  if (!size) throw new Error(`unsupported type ${e.type} for tag ${tag}`);
  const bytes = size * e.count;
  const inline = bytes <= (big ? 8 : 4);
  const buf = inline
    ? e.valueOffset
    : await range(
        big ? Number(e.valueOffset.readBigUInt64LE(0)) : e.valueOffset.readUInt32LE(0),
        (big ? Number(e.valueOffset.readBigUInt64LE(0)) : e.valueOffset.readUInt32LE(0)) + bytes - 1,
      );
  const out: number[] = [];
  for (let i = 0; i < e.count; i++) {
    out.push(size === 2 ? buf.readUInt16LE(i * 2) : size === 4 ? buf.readUInt32LE(i * 4) : Number(buf.readBigUInt64LE(i * 8)));
  }
  return out;
}

const [width] = await values(256);
const [height] = await values(257);
const [compression] = await values(259);
const [planar] = await values(284);
const [rowsPerStrip] = await values(278);
const bps = await values(258);
if (compression !== 1 || planar !== 2 || rowsPerStrip !== 1 || bps.some((b) => b !== 8)) {
  throw new Error(`unexpected layout: compression ${compression}, planar ${planar}, rows/strip ${rowsPerStrip}`);
}
const offsets = await values(273); // band-separate strips: band 0 rows, then band 1, then band 2
const bands = offsets.length / height!;

// ---- window in the source grid (eqc, lat_ts 0, lon_0 0, origin at −180°, +90°) ----
const px = (2 * Math.PI * R) / width!; // 231.5418 m
const degPx = 360 / width!;
const c0 = Math.floor((BOX.west + 180) / degPx);
const c1 = Math.ceil((BOX.east + 180) / degPx);
const r0 = Math.floor((90 - BOX.north) / degPx);
const r1 = Math.ceil((90 - BOX.south) / degPx);
const w = c1 - c0;
const h = r1 - r0;
console.log(`window ${w}×${h} px × ${bands} bands (${((w * h * bands) / 1e6).toFixed(1)} MB), pixel ${px.toFixed(4)} m`);

const data = Buffer.alloc(w * h * bands);
const jobs: Array<[number, number]> = [];
for (let b = 0; b < bands; b++) for (let r = r0; r < r1; r++) jobs.push([b, r]);
let done = 0;
async function worker() {
  for (let job = jobs.shift(); job; job = jobs.shift()) {
    const [b, r] = job;
    const start = offsets[b * height! + r]! + c0;
    const row = await range(start, start + w - 1);
    row.copy(data, (b * h + (r - r0)) * w);
    if (++done % 500 === 0) process.stdout.write(`\r${done}/${bands * h} rows`);
  }
}
await Promise.all(Array.from({ length: 8 }, worker));
process.stdout.write('\n');

mkdirSync(OUT, { recursive: true });
const raw = join(OUT, 'viking_hd_window.bsq');
writeFileSync(raw, data);
const ulx = -Math.PI * R + c0 * px;
const uly = (Math.PI / 2) * R - r0 * px;
const srs = '+proj=eqc +lat_ts=0 +lat_0=0 +lon_0=0 +x_0=0 +y_0=0 +R=3396190 +units=m +no_defs';
const vrt = `<VRTDataset rasterXSize="${w}" rasterYSize="${h}">
  <SRS>${srs}</SRS>
  <GeoTransform>${ulx}, ${px}, 0, ${uly}, 0, ${-px}</GeoTransform>
${['Red', 'Green', 'Blue']
  .map(
    (ci, b) => `  <VRTRasterBand dataType="Byte" band="${b + 1}" subClass="VRTRawRasterBand">
    <ColorInterp>${ci}</ColorInterp>
    <NoDataValue>0</NoDataValue>
    <SourceFilename relativetoVRT="1">viking_hd_window.bsq</SourceFilename>
    <ImageOffset>${b * w * h}</ImageOffset>
    <PixelOffset>1</PixelOffset>
    <LineOffset>${w}</LineOffset>
  </VRTRasterBand>`,
  )
  .join('\n')}
</VRTDataset>
`;
const vrtPath = join(OUT, 'viking_hd_window.vrt');
writeFileSync(vrtPath, vrt);
writeFileSync(
  `${vrtPath}.provenance.json`,
  JSON.stringify(
    {
      artifact: 'viking_hd_window.vrt',
      bytes: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
      retrievedUtc: new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00'),
      datasetId: DATASET,
      sourceUrl: URL_,
      method: 'http-range-rows (scripts/data/fetch-tiff-window.ts)',
      window: { colStart: c0, colEnd: c1, rowStart: r0, rowEnd: r1, box: BOX },
    },
    null,
    2,
  ),
);
console.log(`wrote ${vrtPath}`);
