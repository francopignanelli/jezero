/**
 * Builds per-sol summaries of Mars 2020 MEDA measurements from the NASA PDS Atmospheres Node.
 * Run: npx tsx scripts/data/snapshot-meda.ts [firstSol] [lastSol]   (default: latest release 1740–1859)
 *
 * - Air temperature: median of the three mast (RSM) ATS sensors per sample, then per-sol min/max.
 *   These are LOCAL temperatures near the rover mast (~1.5 m), not standardized weather-station data.
 * - Pressure: derived PS product (Pa), per-sol min/mean/max.
 * - Ls: first sample of the ancillary product (read with an HTTP range request).
 * - Rover position: latest published MMGIS waypoint on or before that sol (from data/build/rover).
 * Raw CSVs are streamed and checksummed, not stored; the output records every source URL + sha256.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { m2020SolStartUtcMs } from '../../packages/domain/src/index';

const BASE = 'https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda';
const RELEASE = { name: 'MEDA PDS Release 16', published: '2026-08-11', firstSol: 1740, lastSol: 1859, bundle: 'sol_1740_1859' };
const ROOT = join(import.meta.dirname, '..', '..');
const OUT = join(ROOT, 'data', 'build', 'environment');
const UA = { 'User-Agent': 'Copernico-pipeline/0.1 (NASA Space Apps research prototype)' };

const first = Number(process.argv[2] ?? RELEASE.firstSol);
const last = Number(process.argv[3] ?? RELEASE.lastSol);

interface Source {
  url: string;
  sha256: string;
  bytes: number;
}

async function text(url: string, range?: string): Promise<{ body: string; source: Source } | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: range ? { ...UA, Range: range } : UA });
      if (res.status === 404) return null;
      if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);
      const body = await res.text();
      return { body, source: { url, sha256: createHash('sha256').update(body).digest('hex'), bytes: body.length } };
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  return null;
}

async function listing(dir: string): Promise<string[]> {
  const r = await text(`${BASE}/${dir}/`);
  return r ? [...r.body.matchAll(/href="([^"?/]+\.CSV)"/g)].map((m) => m[1]!) : [];
}

function columns(csv: string): { header: string[]; rows: string[][] } {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  return { header: lines[0]!.split(','), rows: lines.slice(1).map((l) => l.split(',')) };
}

const median3 = (a: number, b: number, c: number) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));

const rover = JSON.parse(readFileSync(join(ROOT, 'data', 'build', 'rover', 'rover.json'), 'utf8')) as {
  waypoints: Array<[number, number, number, number, number]>;
};
function roverOnSol(sol: number) {
  let best: [number, number, number, number, number] | null = null;
  for (const w of rover.waypoints) if (w[0] <= sol) best = w;
  return best ? { fromWaypointSol: best[0], lat: best[1], lon: best[2], elevationM: best[3] } : null;
}

async function summarizeSol(sol: number) {
  const s = String(sol).padStart(4, '0');
  const cal = `data_calibrated_env/${RELEASE.bundle}/sol_${s}`;
  const der = `data_derived_env/${RELEASE.bundle}/sol_${s}`;
  const [calFiles, derFiles] = await Promise.all([listing(cal), listing(der)]);
  const atsName = calFiles.find((f) => f.includes('CAL_ATS'));
  const psName = derFiles.find((f) => f.includes('DER_PS'));
  const ancName = derFiles.find((f) => f.includes('DER_ANCILLARY'));
  if (!atsName && !psName) return null;
  const sources: Source[] = [];

  let airTempK: { min: number; max: number; samples: number } | null = null;
  if (atsName) {
    const r = await text(`${BASE}/${cal}/${atsName}`);
    if (r) {
      sources.push(r.source);
      const { header, rows } = columns(r.body);
      const i1 = header.indexOf('ATS_LOCAL_TEMP1');
      const i2 = header.indexOf('ATS_LOCAL_TEMP2');
      const i3 = header.indexOf('ATS_LOCAL_TEMP3');
      let min = Infinity;
      let max = -Infinity;
      let n = 0;
      for (const row of rows) {
        const [a, b, c] = [Number(row[i1]), Number(row[i2]), Number(row[i3])];
        if (!row[i1] || !row[i2] || !row[i3] || !Number.isFinite(a + b + c)) continue;
        const m = median3(a, b, c);
        min = Math.min(min, m);
        max = Math.max(max, m);
        n++;
      }
      if (n > 0) airTempK = { min: +min.toFixed(1), max: +max.toFixed(1), samples: n };
    }
  }

  let pressurePa: { min: number; mean: number; max: number; samples: number } | null = null;
  if (psName) {
    const r = await text(`${BASE}/${der}/${psName}`);
    if (r) {
      sources.push(r.source);
      const { header, rows } = columns(r.body);
      const ip = header.indexOf('PRESSURE');
      let min = Infinity;
      let max = -Infinity;
      let sum = 0;
      let n = 0;
      for (const row of rows) {
        const p = Number(row[ip]);
        if (!row[ip] || !Number.isFinite(p)) continue;
        min = Math.min(min, p);
        max = Math.max(max, p);
        sum += p;
        n++;
      }
      if (n > 0) pressurePa = { min: +min.toFixed(1), mean: +(sum / n).toFixed(1), max: +max.toFixed(1), samples: n };
    }
  }

  let lsDeg: number | null = null;
  if (ancName) {
    const r = await text(`${BASE}/${der}/${ancName}`, 'bytes=0-600');
    if (r) {
      const lines = r.body.split(/\r?\n/);
      const header = lines[0]!.split(',');
      const v = Number(lines[1]?.split(',')[header.indexOf('SOLAR_LONGITUDE_ANGLE')]);
      if (Number.isFinite(v)) lsDeg = +v.toFixed(2);
    }
  }

  return {
    sol,
    solStartUtc: new Date(m2020SolStartUtcMs(sol)).toISOString(),
    lsDeg,
    airTempK,
    pressurePa,
    rover: roverOnSol(sol),
    sources,
  };
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const sols: number[] = [];
  for (let s = first; s <= last; s++) sols.push(s);
  const results: Array<NonNullable<Awaited<ReturnType<typeof summarizeSol>>>> = [];
  const queue = [...sols];
  const workers = Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const sol = queue.shift()!;
      try {
        const r = await summarizeSol(sol);
        if (r) results.push(r);
        process.stdout.write(`sol ${sol}: ${r ? 'ok' : 'no data'}\n`);
      } catch (e) {
        process.stdout.write(`sol ${sol}: ERROR ${(e as Error).message}\n`);
      }
    }
  });
  await Promise.all(workers);
  results.sort((a, b) => a.sol - b.sol);
  const out = {
    generatedUtc: new Date().toISOString(),
    kind: 'observed',
    release: RELEASE,
    instrument: 'Mars 2020 MEDA (ATS air temperature sensors 1–3 on the mast; PS pressure sensor)',
    methodology: [
      'Air temperature: per sample, median of ATS_LOCAL_TEMP1–3 (RSM mast booms at 50°, 155°, 290°); per sol min and max. Local temperature near the rover mast, possibly affected by rover thermal influence.',
      'Pressure: derived PS product, per sol min/mean/max (Pa). Pressure depends strongly on elevation; the rover elevation is given for each sol.',
      'Ls: first sample of the derived ANCILLARY product.',
      'Rover position: latest published MMGIS waypoint on or before the sol.',
    ],
    license: 'NASA PDS public data; cite the MEDA archive (Rodriguez-Manfredi et al., PDS Atmospheres Node).',
    landingPage: 'https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/meda.html',
    sols: results,
  };
  writeFileSync(join(OUT, 'meda.json'), JSON.stringify(out));
  console.log(`MEDA summaries: ${results.length} sols (${first}–${last})`);
}

await main();
