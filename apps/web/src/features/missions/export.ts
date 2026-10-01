import type { EvaTimeline, RouteResult } from '@copernico/domain';
import type { WaypointEntry } from '../../app/store';
import type { Versions } from './codec';

/** Coordinate reference stated in every export (GeoJSON itself assumes Earth WGS 84). */
export const MARS_CRS_NOTE =
  'Mars 2015 sphere (IAU_2015:49900), R = 3,396,190 m; planetocentric latitude, east longitude [0, 360); elevation above the MOLA areoid (m).';

export interface ExportInput {
  name: string;
  waypoints: WaypointEntry[];
  route: RouteResult;
  timeline: EvaTimeline | null;
  versions: Versions;
  names: (w: WaypointEntry, index: number) => string;
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/** GeoJSON FeatureCollection: route LineString [lon, lat, elevation] + waypoint Points. */
export function toGeoJson(x: ExportInput): string {
  const arrivals = new Map<number, string>();
  for (const e of x.timeline?.events ?? []) {
    if (e.kind === 'arrive' && !arrivals.has(e.waypointIndex))
      arrivals.set(e.waypointIndex, new Date(e.utcMs).toISOString());
  }
  const m = x.route.metrics;
  const fc = {
    type: 'FeatureCollection',
    name: x.name,
    crs_note: MARS_CRS_NOTE,
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: x.route.points.map((p) => [
            round(p.lon, 7),
            round(p.lat, 7),
            round(p.elevationM, 2),
          ]),
        },
        properties: {
          kind: 'route',
          profile: x.route.profile,
          horizontal_distance_m: m ? round(m.horizontalDistanceM, 1) : null,
          elevation_gain_m: m ? round(m.elevationGainM, 1) : null,
          elevation_loss_m: m ? round(m.elevationLossM, 1) : null,
          max_terrain_slope_deg: m ? round(m.maxTerrainSlopeDeg, 1) : null,
          walking_duration_s: m ? Math.round(m.estimatedDurationS) : null,
          eva_total_s: x.timeline ? Math.round(x.timeline.totalS) : null,
          eva_start_utc: x.timeline ? new Date(x.timeline.startUtcMs).toISOString() : null,
          dataset: x.versions.datasetVersion,
          algorithm: x.versions.algorithmVersion,
          parameters: x.versions.parameterSet,
        },
      },
      ...x.waypoints.map((w, i) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [round(w.lon, 7), round(w.lat, 7)] },
        properties: {
          kind: 'waypoint',
          order: i + 1,
          name: x.names(w, i),
          poi_id: w.poiId ?? null,
          dwell_min: i === 0 ? 0 : (w.dwellMin ?? null),
          arrival_utc: arrivals.get(i) ?? null,
        },
      })),
    ],
  };
  return JSON.stringify(fc, null, 2);
}

const csvCell = (v: string | number | null) => {
  if (v === null) return '';
  const s = String(v);
  // Quote when needed; prefix formula-like text so spreadsheets do not evaluate it.
  const safe = /^[=+\-@]/.test(s) && Number.isNaN(Number(s)) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** Itinerary CSV: one row per leg, with arrival times when a timeline is available. */
export function toCsv(x: ExportInput): string {
  const count = x.waypoints.length;
  const header = [
    'leg',
    'from',
    'to',
    'distance_m',
    'gain_m',
    'loss_m',
    'max_terrain_slope_deg',
    'walking_duration_s',
    'arrival_utc',
  ];
  const arrivals = (x.timeline?.events ?? []).filter(
    (e) => e.kind === 'arrive' || e.kind === 'end',
  );
  const rows = x.route.legs.map((leg, i) => {
    const to = leg.toWaypoint >= count ? 0 : leg.toWaypoint;
    const arrival = arrivals[i];
    return [
      i + 1,
      x.names(x.waypoints[leg.fromWaypoint]!, leg.fromWaypoint),
      x.names(x.waypoints[to]!, to),
      round(leg.horizontalDistanceM, 1),
      round(leg.elevationGainM, 1),
      round(leg.elevationLossM, 1),
      round(leg.maxTerrainSlopeDeg, 1),
      Math.round(leg.estimatedDurationS),
      arrival ? new Date(arrival.utcMs).toISOString() : null,
    ];
  });
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

/** Hands a generated file to the browser (the user clicked Export). */
export function download(filename: string, mime: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const fileSlug = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 60) || 'marswalk';
