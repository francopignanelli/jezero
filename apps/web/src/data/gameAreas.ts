import { DATA_VERSION, dataUrl } from '../config';

/**
 * The rover game's maps (data/build/game/areas.json: each area's centre and its 1 m detail
 * extent), shared by the planner and the game: whether a place can be driven to in the game, and
 * the link that opens it there (free exploration, the rover set down at that point).
 */
export type GameArea = 'landing' | 'floor' | 'delta' | 'neretva' | 'rim';
const AREAS: readonly string[] = ['landing', 'floor', 'delta', 'neretva', 'rim'];
interface AreaBox {
  id: GameArea;
  west: number;
  east: number;
  south: number;
  north: number;
}

/** Mars's radius in the areas' equirectangular projections (m). */
const R = 3_396_190;
/** Kept off the edge of the detailed terrain, where the rover would be stopped at once (m). */
const MARGIN_M = 40;

let boxes: Promise<AreaBox[]> | null = null;

/** The game's maps as latitude/longitude boxes (fetched once). */
export function loadGameAreas(): Promise<AreaBox[]> {
  boxes ??= fetch(dataUrl(`game/areas.json?v=${DATA_VERSION}`))
    .then((r) => (r.ok ? r.json() : { areas: [] }))
    .then((j: { areas: Array<{ id: string; lat: number; lon: number; detail: { heights: { widthM: number; heightM: number } } }> }) =>
      j.areas
        .filter((a): a is typeof a & { id: GameArea } => AREAS.includes(a.id))
        .map((a) => {
          const dLat = ((a.detail.heights.heightM / 2 - MARGIN_M) / R) * (180 / Math.PI);
          const dLon = ((a.detail.heights.widthM / 2 - MARGIN_M) / (R * Math.cos((a.lat * Math.PI) / 180))) * (180 / Math.PI);
          return { id: a.id, west: a.lon - dLon, east: a.lon + dLon, south: a.lat - dLat, north: a.lat + dLat };
        }),
    )
    .catch(() => []);
  return boxes;
}

/** The game map a point is on, if any. */
export async function gameAreaAt(lat: number, lon: number): Promise<GameArea | null> {
  const list = await loadGameAreas();
  return list.find((b) => lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east)?.id ?? null;
}

/** The link that opens a point in the game (free exploration there). */
export const exploreLink = (lat: number, lon: number): string =>
  `./play.html#explore=${lat.toFixed(6)},${lon.toFixed(6)}`;

/** A point asked for by a link (play.html#explore=lat,lon), or null. */
export function exploreFromHash(hash: string): { lat: number; lon: number } | null {
  const m = /^#explore=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(hash);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}
