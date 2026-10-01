/**
 * Builds the scientifically positioned sky background (data/build/sky/):
 *  - stars.json: Yale Bright Star Catalog (BSC5, J2000, Hoffleit & Warren 1991), V ≤ 6.5, positions
 *    propagated by proper motion to EPOCH. Colours from spectral class (approximate).
 *  - milkyway_4k.png: NASA SVS "Deep Star Maps 2020" Milky Way background (no bright stars),
 *    ICRF plate carrée, RA 0h at the centre increasing to the LEFT. Display stretch (asinh) only.
 * Inputs (download once, see docs/datasets.md): data/raw/sky/BSC5, data/raw/sky/milkyway_2020_4k.exr
 * Run: npx tsx scripts/data/build-sky.ts && scripts/geospatial/run.sh sky   (PNG → WebP)
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { FloatType } from 'three';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';

const ROOT = join(import.meta.dirname, '..', '..');
const RAW = join(ROOT, 'data', 'raw', 'sky');
const OUT = join(ROOT, 'data', 'build', 'sky');
const EPOCH = 2026.75;
const MAG_LIMIT = 6.5;

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

// ---------- stars ----------

/** Approximate star colours by spectral class (after M. Charity, "What color are the stars?"). */
const CLASS_RGB: Record<string, [number, number, number]> = {
  O: [155, 176, 255],
  B: [170, 191, 255],
  A: [202, 215, 255],
  F: [248, 247, 255],
  G: [255, 244, 234],
  K: [255, 210, 161],
  M: [255, 204, 111],
};

function buildStars() {
  const buf = readFileSync(join(RAW, 'BSC5'));
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let le = true;
  const hdr = (i: number) => dv.getInt32(i * 4, le);
  if (!(hdr(0) === 0 && hdr(1) === 1)) le = false;
  if (!(hdr(0) === 0 && hdr(1) === 1)) throw new Error('BSC5: unrecognized header');
  const starn = hdr(2);
  const nbent = hdr(6);
  if (starn > 0) throw new Error('BSC5: expected J2000 coordinates (negative STARN)');
  const count = Math.abs(starn);
  const stars: Array<[number, number, number, string]> = [];
  for (let i = 0; i < count; i++) {
    const o = 28 + i * nbent;
    const ra = dv.getFloat64(o + 4, le);
    const dec = dv.getFloat64(o + 12, le);
    const cls = String.fromCharCode(dv.getUint8(o + 20)).toUpperCase();
    const mag = dv.getInt16(o + 22, le) / 100;
    const pmRa = dv.getFloat32(o + 24, le);
    const pmDec = dv.getFloat32(o + 28, le);
    if ((ra === 0 && dec === 0) || mag > MAG_LIMIT) continue; // deleted entries / fainter than limit
    const dt = EPOCH - 2000;
    stars.push([+(ra + pmRa * dt).toFixed(6), +(dec + pmDec * dt).toFixed(6), mag, CLASS_RGB[cls] ? cls : 'G']);
  }
  stars.sort((a, b) => a[2] - b[2]);
  return {
    source: 'Yale Bright Star Catalog, 5th Revised Ed. (Hoffleit & Warren 1991), BSC5 J2000 binary from SAO/TDC',
    url: 'http://tdc-www.harvard.edu/catalogs/BSC5',
    sha256: sha(buf),
    frame: 'ICRF/J2000 right ascension and declination (radians)',
    epoch: EPOCH,
    magnitudeLimit: MAG_LIMIT,
    fields: ['raRad', 'decRad', 'vMag', 'spectralClass'],
    classColours: CLASS_RGB,
    stars,
  };
}

// ---------- Milky Way ----------

function crc32(buf: Buffer): number {
  let c: number;
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function png(width: number, height: number, rgb: Uint8Array): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0; // filter: none
    Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function buildMilkyWay(input: string, output: string) {
  const file = readFileSync(join(RAW, input));
  const loader = new EXRLoader();
  loader.setDataType(FloatType);
  const ab = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  const img = loader.parse(ab as ArrayBuffer) as unknown as { width: number; height: number; data: Float32Array };
  const { width, height, data } = img;
  const channels = data.length / (width * height);
  const lum = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * channels]!;
    const g = data[i * channels + 1]!;
    const b = data[i * channels + 2]!;
    lum[i] = Math.max(0, 0.2126 * r + 0.7152 * g + 0.0722 * b);
  }
  const sorted = Float32Array.from(lum).sort();
  const median = Math.max(1e-12, sorted[Math.floor(sorted.length * 0.5)]!);
  const black = 1.35 * median; // black point just above the median sky: faint-star "grain" goes dark
  const sigma = median; // asinh softening scale
  const white = sorted[Math.floor(sorted.length * 0.9995)]! - black;
  const norm = Math.asinh(white / sigma);
  const rgb = new Uint8Array(width * height * 3);
  // EXR rows are stored bottom-up in three's loader output; flip so row 0 is Dec +90°.
  for (let y = 0; y < height; y++) {
    const srcRow = height - 1 - y;
    for (let x = 0; x < width; x++) {
      const i = srcRow * width + x;
      const l = lum[i]!;
      const lb = Math.max(0, l - black);
      const scale = l > 0 ? (Math.asinh(lb / sigma) / norm / l) * 0.8 : 0;
      for (let c = 0; c < 3; c++) {
        const v = Math.max(0, data[i * channels + c]!) * scale;
        rgb[(y * width + x) * 3 + c] = Math.min(255, Math.round(255 * Math.pow(Math.min(1, v), 1 / 1.6)));
      }
    }
  }
  writeFileSync(join(OUT, output), png(width, height, rgb));
  return {
    file: output.replace('.png', '.webp'),
    source: `NASA/Goddard Space Flight Center Scientific Visualization Studio, Deep Star Maps 2020 (${input}). Gaia DR2: ESA/Gaia/DPAC.`,
    url: 'https://svs.gsfc.nasa.gov/4851',
    sha256: sha(file),
    width,
    height,
    projection: 'ICRF plate carrée; u = 0.5 − RA/(2π) (RA 0h at centre, increasing leftward); v = 0.5 − Dec/π',
    stretch: `asinh((L − 1.35·median)/median)/asinh(W/median), W = 99.95th percentile; gamma 1/1.6; display only, not photometric`,
  };
}

mkdirSync(OUT, { recursive: true });
const stars = buildStars();
writeFileSync(join(OUT, 'stars.json'), JSON.stringify(stars));
// 4K fallback (devices limited to 4096-px textures) and 8K HD (default where supported).
const milkyWay = [buildMilkyWay('milkyway_2020_4k.exr', 'milkyway_4k.png'), buildMilkyWay('milkyway_2020_8k.exr', 'milkyway_8k.png')];
writeFileSync(
  join(OUT, 'sky.json'),
  JSON.stringify(
    {
      generatedUtc: new Date().toISOString(),
      stars: { ...stars, stars: undefined, count: stars.stars.length },
      milkyWay,
      notes: [
        'Positions are exact to catalog precision; brightness is enhanced relative to what a camera exposed for sunlit Mars would record.',
        'Planets and the Sun are computed at runtime (astronomy-engine, IAU 2015 Mars rotation).',
      ],
    },
    null,
    2,
  ),
);
console.log(`stars: ${stars.stars.length} (V ≤ ${MAG_LIMIT}); Milky Way ${milkyWay.map((m) => `${m.width}×${m.height}`).join(', ')}`);
