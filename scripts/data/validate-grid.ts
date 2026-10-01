/**
 * Validates the Jezero operational grid against independent Mars 2020 PDS PLACES localizations and
 * exercises the routing engine on real terrain. Writes data/build/regions/jezero/validation.json.
 * Run: npx tsx scripts/data/validate-grid.ts   (after scripts/geospatial/run.sh operational)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  decodeGridBand,
  DEFAULT_EVA_PARAMS,
  eqcForward,
  locateCell,
  M2020_EQC,
  planAlternatives,
  prepareTerrain,
  sampleBilinear,
  terrainLayersFromBands,
  type GridBandName,
  type GridFileHeader,
} from '../../packages/domain/src/index';

const ROOT = join(import.meta.dirname, '..', '..');
const GRID_DIR = join(ROOT, 'data', 'build', 'regions', 'jezero');
const PLACES = join(ROOT, 'data', 'raw', 'm2020-places', 'best_tactical.csv');
const POIS = JSON.parse(readFileSync(join(ROOT, 'data', 'catalog', 'pois.json'), 'utf8')) as {
  pois: Array<{ id: string; lat: number; lon: number }>;
  guidedMission: { waypoints: string[]; returnToStart: boolean };
};

const header = JSON.parse(readFileSync(join(GRID_DIR, 'grid.json'), 'utf8')) as GridFileHeader;
const n = header.cols * header.rows;
const bands: Partial<Record<GridBandName, Float32Array>> = {};
for (const band of header.bands) {
  const buf = readFileSync(join(GRID_DIR, band.file));
  bands[band.name] = decodeGridBand(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), band, n);
}
const layers = terrainLayersFromBands(header, bands);
const t0 = performance.now();
const terrain = prepareTerrain(layers, DEFAULT_EVA_PARAMS);
const prepareMs = performance.now() - t0;

// 1. Elevation vs PLACES (rover frame origin elevations, relative to the areoid).
const rows = readFileSync(PLACES, 'utf8').trim().split('\n');
const cols = rows[0]!.split(',');
const idx = (name: string) => cols.indexOf(name);
const diffs: number[] = [];
let frameErrMax = 0;
for (const line of rows.slice(1)) {
  const f = line.split(',');
  const lat = Number(f[idx('planetocentric_latitude')]);
  const lon = Number(f[idx('longitude')]);
  const elev = Number(f[idx('elevation')]);
  const p = eqcForward(M2020_EQC, lat, lon);
  frameErrMax = Math.max(
    frameErrMax,
    Math.abs(p.x - Number(f[idx('easting')])),
    Math.abs(p.y - Number(f[idx('northing')])),
  );
  if (!locateCell(layers.spec, lat, lon)) continue;
  const z = sampleBilinear(layers.spec, layers.elevation, p);
  if (Number.isFinite(z)) diffs.push(elev - z);
}
diffs.sort((a, b) => a - b);
const mean = diffs.reduce((s, d) => s + d, 0) / diffs.length;
const rms = Math.sqrt(diffs.reduce((s, d) => s + d * d, 0) / diffs.length);
const pct = (q: number) => diffs[Math.min(diffs.length - 1, Math.floor(q * diffs.length))]!;

// 2. Guided Marswalk on real terrain.
const byId = new Map(POIS.pois.map((p) => [p.id, p]));
const waypoints = POIS.guidedMission.waypoints.map((id) => byId.get(id)!);
const t1 = performance.now();
const cmp = planAlternatives(terrain, { waypoints, returnToStart: POIS.guidedMission.returnToStart });
const routeMs = performance.now() - t1;
const summary = (r: typeof cmp.lowerRisk) =>
  r.metrics
    ? {
        status: r.status,
        horizontalKm: +(r.metrics.horizontalDistanceM / 1000).toFixed(2),
        gainM: Math.round(r.metrics.elevationGainM),
        lossM: Math.round(r.metrics.elevationLossM),
        maxSlopeDeg: Math.round(r.metrics.maxTerrainSlopeDeg),
        durationH: +(r.metrics.estimatedDurationS / 3600).toFixed(2),
        walkbackOk: r.metrics.walkback.ok,
        vertices: r.points.length,
        expandedNodes: r.expandedNodes,
      }
    : { status: r.status, explanation: r.explanation };

const report = {
  generatedUtc: new Date().toISOString(),
  grid: { cols: header.cols, rows: header.rows, cellSize: header.cellSize, prepareMs: Math.round(prepareMs) },
  placesFrameCheck: { maxEastingNorthingErrorM: +frameErrMax.toFixed(4), rows: rows.length - 1 },
  placesElevation: {
    note: 'PLACES elevation (rover frame origin, areoid) minus 5 m grid elevation (bilinear) at the same point.',
    samples: diffs.length,
    meanM: +mean.toFixed(2),
    rmsM: +rms.toFixed(2),
    p05M: +pct(0.05).toFixed(2),
    medianM: +pct(0.5).toFixed(2),
    p95M: +pct(0.95).toFixed(2),
  },
  guidedMission: {
    waypoints: POIS.guidedMission.waypoints,
    computeMs: Math.round(routeMs),
    lowerRisk: summary(cmp.lowerRisk),
    shortest: summary(cmp.shortest),
    comparison: cmp.comparison,
  },
};
writeFileSync(join(GRID_DIR, 'validation.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
