/// <reference lib="webworker" />
import {
  DEFAULT_EVA_PARAMS,
  detourCost,
  inspectPoint,
  type DetourCost,
  type PointInspection,
  type RouteProfile,
  eqcInverse,
  locateCell,
  planAlternatives,
  prepareTerrain,
  sampleBilinear,
  eqcForward,
  type PreparedTerrain,
  type Waypoint,
} from '@copernico/domain';
import { loadTerrainLayers, type GridHeader } from './grid';
import { renderOverlay, type OverlayKind } from './overlays';

/** Messages exchanged with the routing worker. Heavy computation never runs on the UI thread. */
export type WorkerRequest =
  | { type: 'init'; baseUrl: string }
  | { type: 'plan'; id: number; waypoints: Waypoint[]; returnToStart: boolean }
  | { type: 'overlay'; id: number; kind: OverlayKind }
  | { type: 'sample'; id: number; points: Array<{ lat: number; lon: number }> }
  | { type: 'inspect'; id: number; lat: number; lon: number }
  | { type: 'detours'; id: number; profile: RouteProfile; candidates: DetourCandidate[] };

/** A science stop to price between two consecutive waypoints of the current route. */
export interface DetourCandidate {
  id: string;
  from: Waypoint;
  to: Waypoint;
  stop: Waypoint;
}

export interface GridSummary {
  header: GridHeader;
  rectangle: { west: number; south: number; east: number; north: number };
  prepareMs: number;
}

export type WorkerResponse =
  | { type: 'ready'; summary: GridSummary }
  | { type: 'error'; id?: number; message: string }
  | { type: 'plan'; id: number; comparison: ReturnType<typeof planAlternatives>; elapsedMs: number }
  | {
      type: 'overlay';
      id: number;
      kind: OverlayKind;
      width: number;
      height: number;
      rgba: ArrayBuffer;
      range: [number, number] | null;
    }
  | { type: 'sample'; id: number; elevations: number[] }
  | { type: 'inspect'; id: number; inspection: PointInspection }
  | { type: 'detours'; id: number; detours: Array<DetourCost & { id: string }> };

const scope = self as unknown as DedicatedWorkerGlobalScope;
let terrain: PreparedTerrain | null = null;

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  try {
    if (msg.type === 'init') {
      const t0 = performance.now();
      const { header, layers } = await loadTerrainLayers(msg.baseUrl);
      terrain = prepareTerrain(layers, DEFAULT_EVA_PARAMS);
      const { spec } = layers;
      const nw = eqcInverse(spec.projection, spec.originX, spec.originY);
      const se = eqcInverse(
        spec.projection,
        spec.originX + spec.cols * spec.cellSize,
        spec.originY - spec.rows * spec.cellSize,
      );
      post({
        type: 'ready',
        summary: {
          header,
          rectangle: { west: nw.lon, north: nw.lat, east: se.lon, south: se.lat },
          prepareMs: performance.now() - t0,
        },
      });
      return;
    }
    if (!terrain) throw new Error('terrain grid not loaded');
    if (msg.type === 'plan') {
      const t0 = performance.now();
      const comparison = planAlternatives(terrain, {
        waypoints: msg.waypoints,
        returnToStart: msg.returnToStart,
      });
      post({ type: 'plan', id: msg.id, comparison, elapsedMs: performance.now() - t0 });
    } else if (msg.type === 'overlay') {
      const o = renderOverlay(terrain, msg.kind);
      const buffer = o.rgba.buffer as ArrayBuffer;
      scope.postMessage(
        {
          type: 'overlay',
          id: msg.id,
          kind: o.kind,
          width: o.width,
          height: o.height,
          rgba: buffer,
          range: o.range,
        },
        [buffer],
      );
    } else if (msg.type === 'sample') {
      const t = terrain;
      const elevations = msg.points.map((p) =>
        locateCell(t.layers.spec, p.lat, p.lon)
          ? sampleBilinear(
              t.layers.spec,
              t.layers.elevation,
              eqcForward(t.layers.spec.projection, p.lat, p.lon),
            )
          : Number.NaN,
      );
      post({ type: 'sample', id: msg.id, elevations });
    } else if (msg.type === 'inspect') {
      post({ type: 'inspect', id: msg.id, inspection: inspectPoint(terrain, msg.lat, msg.lon) });
    } else if (msg.type === 'detours') {
      const t = terrain;
      const detours = msg.candidates.map((c) => ({
        id: c.id,
        ...detourCost(t, msg.profile, c.from, c.to, c.stop),
      }));
      post({ type: 'detours', id: msg.id, detours });
    }
  } catch (err) {
    post({
      type: 'error',
      id: 'id' in msg ? msg.id : undefined,
      message: err instanceof Error ? err.message : String(err),
    } as WorkerResponse);
  }
};

function post(message: WorkerResponse): void {
  scope.postMessage(message);
}
