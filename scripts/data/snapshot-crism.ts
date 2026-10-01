/**
 * Snapshots CRISM MTRDR browse composites (MRO, PDS Geosciences Node, mrocr_4001) over the Jezero
 * operational area. Run: npx tsx scripts/data/snapshot-crism.ts
 *
 * - Observations: every MTRDR footprint that intersects the routing grid (ODE REST query below).
 * - Composites: CAR (carbonate/Fe-Mg clay: D2300, BD2500_2, BD1900_2) and MAF (mafic: OLINDEX3,
 *   LCPINDEX2, HCPINDEX2), as published (Viviano-Beck et al. 2014 stretches). PNG quicklooks are
 *   byte-identical to the IMG products in RGB and add an alpha mask for non-scene pixels.
 * - Geometry: the products are equirectangular in planetocentric latitude / east longitude (sphere
 *   R = 3394.8398 km, standard parallel 15°). Rows are lines of latitude and columns are meridians,
 *   so each image drapes on our Mars sphere as a lon/lat rectangle with no resampling. Pixel centres
 *   follow the PDS convention LINE = LINE_PROJECTION_OFFSET − lat·MAP_RESOLUTION (1-based lines),
 *   SAMPLE = SAMPLE_PROJECTION_OFFSET + lon·MAP_RESOLUTION·cos(15°); the half-pixel ambiguity of
 *   that convention is ≤ 9 m and is recorded as uncertainty.
 * Raw files go to data/raw/crism (gitignored); outputs to data/build/crism with sha256 provenance.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const RAW = join(ROOT, 'data', 'raw', 'crism');
const OUT = join(ROOT, 'data', 'build', 'crism');
const UA = { 'User-Agent': 'Copernico-pipeline/0.1 (NASA Space Apps research prototype)' };
const ODE =
  'https://oderest.rsl.wustl.edu/live2/?query=product&results=fp&target=mars&ihid=MRO&iid=CRISM&pt=MTRDR&output=JSON';
const COMPOSITES = ['CAR', 'MAF'] as const;

/** Bounding box of the routing grid (data/build/regions/jezero/grid.json), degrees, with a margin. */
const AOI = { west: 77.28, east: 77.49, south: 18.39, north: 18.53 };

async function get(url: string): Promise<Buffer> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: UA });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  throw new Error('unreachable');
}

async function cached(url: string): Promise<{ data: Buffer; sha256: string }> {
  const file = join(RAW, url.split('/').pop()!);
  const data = existsSync(file) ? readFileSync(file) : await get(url);
  if (!existsSync(file)) writeFileSync(file, data);
  return { data, sha256: createHash('sha256').update(data).digest('hex') };
}

const num = (label: string, key: string): number => {
  const m = new RegExp(`^\\s*${key}\\s*=\\s*(-?[\\d.]+(?:E[+-]?\\d+)?)`, 'm').exec(label);
  if (!m) throw new Error(`label key ${key} missing`);
  return Number(m[1]);
};
const str = (label: string, key: string): string => {
  const m = new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\r\\n]+)"?`, 'm').exec(label);
  return m ? m[1]!.trim() : '';
};
const list = (label: string, key: string): string[] => {
  const m = new RegExp(`${key}\\s*=\\s*\\(([^)]*)\\)`, 'm').exec(label);
  return m ? m[1]!.split(',').map((s) => s.replace(/"/g, '').trim()) : [];
};

interface OdeFile {
  FileName: string;
  URL: string;
}

mkdirSync(RAW, { recursive: true });
mkdirSync(OUT, { recursive: true });

const query = `${ODE}&westernlon=${AOI.west}&easternlon=${AOI.east}&minlat=${AOI.south}&maxlat=${AOI.north}`;
const ode = JSON.parse((await get(query)).toString('utf8')) as {
  ODEResults: { Products: { Product: Array<{ pdsid: string; Product_files: { Product_file: OdeFile[] } }> } };
};
const products = ode.ODEResults.Products.Product;

const observations = [];
for (const p of products) {
  const files = p.Product_files.Product_file;
  const composites: Record<string, unknown> = {};
  let geometry: Record<string, number> | null = null;
  let startTime = '';
  for (const c of COMPOSITES) {
    const find = (ext: string) => files.find((f) => f.FileName.endsWith(`_BR${c}J_MTR3.${ext}`));
    const lblFile = find('LBL');
    const pngFile = find('PNG');
    if (!lblFile || !pngFile) continue;
    const lbl = await cached(lblFile.URL);
    const png = await cached(pngFile.URL);
    const label = lbl.data.toString('latin1');
    if (str(label, 'MAP_PROJECTION_TYPE') !== 'EQUIRECTANGULAR') throw new Error(`${p.pdsid}: unexpected projection`);
    if (str(label, 'COORDINATE_SYSTEM_NAME') !== 'PLANETOCENTRIC') throw new Error(`${p.pdsid}: not planetocentric`);
    if (num(label, 'CENTER_LONGITUDE') !== 0 || num(label, 'MAP_PROJECTION_ROTATION') !== 0) {
      throw new Error(`${p.pdsid}: unsupported projection parameters`);
    }
    const lines = num(label, 'LINES');
    const samples = num(label, 'LINE_SAMPLES');
    const res = num(label, 'MAP_RESOLUTION'); // pixels per degree of latitude
    const lpo = num(label, 'LINE_PROJECTION_OFFSET');
    const spo = num(label, 'SAMPLE_PROJECTION_OFFSET');
    const k = Math.cos((num(label, 'CENTER_LATITUDE') * Math.PI) / 180);
    // Pixel edges (centres at integer lines/samples, 1-based).
    const rect = {
      north: (lpo - 0.5) / res,
      south: (lpo - (lines + 0.5)) / res,
      west: (0.5 - spo) / (res * k),
      east: (samples + 0.5 - spo) / (res * k),
    };
    // Cross-check against the label's own footprint (centre-based), within one pixel.
    const tol = 1.01 / res;
    const ok =
      Math.abs(rect.north - num(label, 'MAXIMUM_LATITUDE')) < tol &&
      Math.abs(rect.south - num(label, 'MINIMUM_LATITUDE')) < tol &&
      Math.abs(rect.west - num(label, 'WESTERNMOST_LONGITUDE')) < tol / k &&
      Math.abs(rect.east - num(label, 'EASTERNMOST_LONGITUDE')) < tol / k;
    if (!ok) throw new Error(`${p.pdsid}: footprint mismatch ${JSON.stringify(rect)}`);
    geometry = { ...rect, lines, samples, mPerPixel: num(label, 'MAP_SCALE') * 1000 };
    startTime = str(label, 'START_TIME');
    const out = `${p.pdsid.slice(0, 11)}_${c.toLowerCase()}.png`;
    copyFileSync(join(RAW, pngFile.URL.split('/').pop()!), join(OUT, out));
    composites[c.toLowerCase()] = {
      file: out,
      bands: list(label, 'BAND_NAME'),
      description: str(label, 'DESCRIPTION').replace(/\s+/g, ' '),
      sources: [
        { url: pngFile.URL, sha256: png.sha256, bytes: png.data.length },
        { url: lblFile.URL, sha256: lbl.sha256, bytes: lbl.data.length },
      ],
    };
  }
  if (!geometry) continue;
  observations.push({ id: p.pdsid.slice(0, 11).toUpperCase(), productId: p.pdsid.toUpperCase(), startTime, ...geometry, composites });
}

observations.sort((a, b) => a.startTime.localeCompare(b.startTime));
const manifest = {
  retrievedUtc: new Date().toISOString(),
  dataset: 'MRO CRISM MTRDR (mrocr_4001), PDS Geosciences Node',
  aoi: AOI,
  uncertainty:
    'Browse composites of summary parameters (indicators, not identifications). Georeferencing from MRO pointing; offsets of one to a few CRISM pixels (18–36 m) relative to the HiRISE TRN mosaic are possible. Half-pixel convention ambiguity ≤ 9 m.',
  observations,
};
writeFileSync(join(OUT, 'crism.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`CRISM: ${observations.length} observations →`, observations.map((o) => `${o.id} ${o.startTime.slice(0, 10)} ${Object.keys(o.composites).join('+')}`).join('; '));
