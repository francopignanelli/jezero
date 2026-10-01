/**
 * Snapshots Mars 2020 rover, sample and Ingenuity data from NASA's public MMGIS layers, validates
 * every coordinate against its own easting/northing in the Mars 2020 frame, and writes normalized
 * files to data/build/rover/. Run: npx tsx scripts/data/snapshot-rover.ts
 *
 * Positions are published tactical localizations; each file records its source Last-Modified date,
 * so the UI can always say "as of sol N (date)". This is never presented as live tracking.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eqcInverse, greatCircleDistance, M2020_EQC } from '../../packages/domain/src/index';

const BASE = 'https://mars.nasa.gov/mmgis-maps/M20/Layers/json/';
const OUT = join(import.meta.dirname, '..', '..', 'data', 'build', 'rover');
/** Max accepted disagreement between published lat/lon and lat/lon recomputed from easting/northing. */
const POSITION_TOLERANCE_M = 5;

interface Source {
  url: string;
  lastModified: string | null;
  sha256: string;
  bytes: number;
}

type Feature = { type: 'Feature'; properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } };
type FeatureCollection = { type: 'FeatureCollection'; features: Feature[] };

async function get(name: string): Promise<{ json: FeatureCollection; source: Source }> {
  const url = BASE + name;
  const res = await fetch(url, { headers: { 'User-Agent': 'Copernico-pipeline/0.1 (NASA Space Apps research prototype)' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const text = await res.text();
  return {
    json: JSON.parse(text) as FeatureCollection,
    source: {
      url,
      lastModified: res.headers.get('last-modified'),
      sha256: createHash('sha256').update(text).digest('hex'),
      bytes: text.length,
    },
  };
}

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v));
const round = (v: number, d = 6): number => Number(v.toFixed(d));

/** Chooses the easting/northing-derived position when the published lat/lon disagree with it. */
function checkedPosition(p: Record<string, unknown>, label: string, issues: string[]) {
  const lat = num(p.lat ?? p.Lat);
  const lon = num(p.lon ?? p.Lon);
  const e = num(p.easting ?? p.Easting);
  const n = num(p.northing ?? p.Northing);
  if (!Number.isFinite(e) || !Number.isFinite(n)) return { lat, lon, corrected: false };
  const fromEN = eqcInverse(M2020_EQC, e, n);
  const d = greatCircleDistance({ lat, lon }, fromEN);
  if (d > POSITION_TOLERANCE_M) {
    issues.push(`${label}: published lat/lon differ by ${d.toFixed(0)} m from easting/northing; using easting/northing`);
    return { lat: fromEN.lat, lon: fromEN.lon, corrected: true };
  }
  return { lat, lon, corrected: false };
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const retrievedUtc = new Date().toISOString();
  const issues: string[] = [];

  const [waypoints, traverse, samples, depot, heli] = await Promise.all([
    get('M20_waypoints.json'),
    get('M20_traverse.json'),
    get('M20_SAMPLE_v3.json'),
    get('M20_TF_Sample_Depot.json'),
    get('m20_heli_waypoints.json'),
  ]);

  const wp = waypoints.json.features
    .map((f) => {
      const p = f.properties;
      const pos = checkedPosition(p, `waypoint sol ${String(p.sol)}`, issues);
      return {
        sol: num(p.sol),
        site: num(p.site),
        drive: num(p.drive),
        lat: round(pos.lat),
        lon: round(pos.lon),
        elevationM: round(num(p.elev_geoid), 1),
        distTotalM: round(num(p.dist_total_m), 1),
      };
    })
    .filter((w) => Number.isFinite(w.sol) && Number.isFinite(w.lat))
    .sort((a, b) => a.sol - b.sol || a.site - b.site || a.drive - b.drive);
  const latest = wp[wp.length - 1]!;

  const traverseOut = {
    type: 'FeatureCollection',
    features: traverse.json.features.map((f) => ({
      type: 'Feature',
      properties: { sol: num(f.properties.sol), lengthM: round(num(f.properties.length), 1) },
      geometry: {
        type: 'LineString',
        coordinates: (f.geometry.coordinates as number[][]).map(([lon, lat]) => [round(lon!), round(lat!)]),
      },
    })),
  };

  const samplesOut = samples.json.features.map((f) => {
    const p = f.properties;
    const pos = checkedPosition(p, `sample ${String(p.sample_name)}`, issues);
    return {
      sampleNumber: String(p.sample_num),
      sol: String(p.sol),
      earthDate: String(p.date),
      name: String(p.sample_name).replace(/_/g, ' '),
      outcrop: String(p.outcrop_name),
      location: String(p.sample_location),
      sampleType: String(p.sample_type),
      rockType: String(p.rock_type),
      lat: round(pos.lat),
      lon: round(pos.lon),
      elevationM: round(num(p.elev), 1),
      positionCorrectedFromEastingNorthing: pos.corrected,
    };
  });

  const flights = heli.json.features
    .map((f) => {
      const p = f.properties;
      const pos = checkedPosition(p, `Ingenuity flight ${String(p.Flight)}`, issues);
      return {
        flight: num(p.Flight),
        sol: num(p.Sol),
        earthDate: String(p.Earth_Date ?? ''),
        lat: round(pos.lat),
        lon: round(pos.lon),
        elevationM: round(num(p.Elev_Geoid), 1),
      };
    })
    .sort((a, b) => a.flight - b.flight);

  const meta = {
    retrievedUtc,
    provenance: 'NASA/JPL-Caltech Mars 2020 location map (MMGIS). Tactical localizations; not live tracking.',
    frame: 'planetocentric °N, east longitude °E; elevation above the areoid (m)',
    validation: `lat/lon checked against easting/northing in the Mars 2020 frame (tolerance ${POSITION_TOLERANCE_M} m)`,
    issues,
  };
  const write = (name: string, body: unknown) =>
    writeFileSync(join(OUT, name), JSON.stringify(body), 'utf8');

  write('rover.json', {
    ...meta,
    sources: [waypoints.source, traverse.source],
    latest,
    waypoints: wp.map((w) => [w.sol, w.lat, w.lon, w.elevationM, w.distTotalM]),
    waypointFields: ['sol', 'lat', 'lon', 'elevationM', 'distTotalM'],
  });
  write('traverse.geojson', traverseOut);
  write('samples.json', { ...meta, sources: [samples.source, depot.source], samples: samplesOut, depot: depot.json.features[0]?.geometry ?? null });
  write('ingenuity.json', { ...meta, sources: [heli.source], flights });

  console.log(`rover: latest sol ${latest.sol} at ${latest.lat}, ${latest.lon} (${wp.length} waypoints)`);
  console.log(`samples: ${samplesOut.length}; Ingenuity flights: ${flights.length}`);
  for (const issue of issues) console.warn(`issue: ${issue}`);
}

await main();
