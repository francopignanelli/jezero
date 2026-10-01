import { MissionInput } from '@copernico/contracts';
import type { RouteResult } from '@copernico/domain';
import type { WaypointEntry } from '../../app/store';

/** The app state a mission captures (everything needed to recompute it deterministically). */
export interface MissionState {
  waypoints: WaypointEntry[];
  profile: 'lower-risk' | 'shortest';
  returnToStart: boolean;
  evaStartUtcMs: number;
}

export interface Versions {
  datasetVersion: string;
  algorithmVersion: string;
  parameterSet: string;
}

const MAX_GEOMETRY = 5000;

/** Builds a validated MissionInput; the route (if any) is stored as a summary plus geometry. */
export function toMissionInput(
  name: string,
  state: MissionState,
  versions: Versions,
  route: RouteResult | null,
): MissionInput {
  const stride = route ? Math.max(1, Math.ceil(route.points.length / MAX_GEOMETRY)) : 1;
  const geometry = route?.points.filter((_, i, a) => i % stride === 0 || i === a.length - 1) ?? [];
  const candidate = {
    name,
    region: 'jezero' as const,
    waypoints: state.waypoints.map((w) => ({
      lat: w.lat,
      lon: w.lon,
      ...(w.label ? { label: w.label } : {}),
      ...(w.poiId ? { poiId: w.poiId } : {}),
      ...(w.dwellMin !== undefined ? { dwellMin: Math.round(w.dwellMin) } : {}),
    })),
    parameters: { profile: state.profile, returnToStart: state.returnToStart },
    evaStartUtc: new Date(state.evaStartUtcMs).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    route:
      route?.status === 'ok' && route.metrics && geometry.length >= 2
        ? {
            metrics: {
              horizontalDistanceM: route.metrics.horizontalDistanceM,
              distance3dM: route.metrics.distance3dM,
              elevationGainM: route.metrics.elevationGainM,
              elevationLossM: route.metrics.elevationLossM,
              maxTerrainSlopeDeg: route.metrics.maxTerrainSlopeDeg,
              estimatedDurationS: route.metrics.estimatedDurationS,
              walkbackOk: route.metrics.walkback.ok,
            },
            explanation: [],
            geometry: geometry.map((p) => [p.lat, p.lon, p.elevationM] as [number, number, number]),
          }
        : null,
    ...versions,
  };
  return MissionInput.parse(candidate);
}

/** Restores app state from a validated mission. */
export function fromMissionInput(m: MissionInput): MissionState {
  return {
    waypoints: m.waypoints.map((w, i) => ({
      id: `m${i}-${Math.round(w.lat * 1e6)}-${Math.round(w.lon * 1e6)}`,
      lat: w.lat,
      lon: w.lon,
      ...(w.label ? { label: w.label } : {}),
      ...(w.poiId ? { poiId: w.poiId } : {}),
      ...(w.dwellMin !== undefined ? { dwellMin: w.dwellMin } : {}),
    })),
    profile: m.parameters.profile,
    returnToStart: m.parameters.returnToStart,
    evaStartUtcMs: Date.parse(m.evaStartUtc),
  };
}

// ---------- share links (#m=<base64url JSON>) ----------

/** Upper bound for a decoded share payload; anything larger is rejected before parsing. */
export const MAX_SHARE_BYTES = 8 * 1024;

const toBase64Url = (bytes: Uint8Array) => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (s: string): Uint8Array | null => {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    const bin = atob(
      s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4),
    );
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
};

/** Share links carry inputs only (no route geometry): the receiver recomputes deterministically. */
export function encodeShare(m: MissionInput): string {
  const json = JSON.stringify({ ...m, route: null });
  return `#m=${toBase64Url(new TextEncoder().encode(json))}`;
}

export type ShareDecode =
  { ok: true; mission: MissionInput } | { ok: false; reason: 'absent' | 'invalid' };

/** Decodes and validates a share fragment. Untrusted input: size-capped, schema-validated. */
export function decodeShare(hash: string): ShareDecode {
  const m = /^#m=([A-Za-z0-9_-]+)$/.exec(hash);
  if (!m) return { ok: false, reason: hash.startsWith('#m=') ? 'invalid' : 'absent' };
  if (m[1]!.length > Math.ceil((MAX_SHARE_BYTES * 4) / 3)) return { ok: false, reason: 'invalid' };
  const bytes = fromBase64Url(m[1]!);
  if (!bytes || bytes.length > MAX_SHARE_BYTES) return { ok: false, reason: 'invalid' };
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  const parsed = MissionInput.safeParse(data);
  return parsed.success ? { ok: true, mission: parsed.data } : { ok: false, reason: 'invalid' };
}
