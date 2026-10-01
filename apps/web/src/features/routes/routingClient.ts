import type { PointInspection, RouteComparison, RouteProfile, Waypoint } from '@copernico/domain';
import type { OverlayKind } from './overlays';
import type { DetourCandidate, GridSummary, WorkerRequest, WorkerResponse } from './routing.worker';

type Pending = { resolve: (v: WorkerResponse) => void; reject: (e: Error) => void };

/** Promise wrapper around the routing Web Worker. One worker per page; grid loaded once. */
class RoutingClient {
  private worker: Worker | null = null;
  private ready: Promise<GridSummary> | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;

  init(baseUrl: string): Promise<GridSummary> {
    if (this.ready) return this.ready;
    this.worker = new Worker(new URL('./routing.worker.ts', import.meta.url), { type: 'module' });
    this.ready = new Promise<GridSummary>((resolve, reject) => {
      this.worker!.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const msg = e.data;
        if (msg.type === 'ready') resolve(msg.summary);
        else if (msg.type === 'error' && msg.id === undefined) reject(new Error(msg.message));
        else if ('id' in msg && msg.id !== undefined) {
          const p = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (!p) return;
          if (msg.type === 'error') p.reject(new Error(msg.message));
          else p.resolve(msg);
        }
      };
      this.worker!.onerror = (e) => reject(new Error(e.message));
    });
    this.post({ type: 'init', baseUrl });
    this.ready.catch(() => {
      this.ready = null;
      this.worker?.terminate();
      this.worker = null;
    });
    return this.ready;
  }

  async plan(
    waypoints: Waypoint[],
    returnToStart: boolean,
  ): Promise<{ comparison: RouteComparison; elapsedMs: number }> {
    const msg = await this.request({ type: 'plan', id: 0, waypoints, returnToStart });
    if (msg.type !== 'plan') throw new Error('unexpected worker response');
    return { comparison: msg.comparison, elapsedMs: msg.elapsedMs };
  }

  async overlay(kind: OverlayKind) {
    const msg = await this.request({ type: 'overlay', id: 0, kind });
    if (msg.type !== 'overlay') throw new Error('unexpected worker response');
    return msg;
  }

  async sample(points: Array<{ lat: number; lon: number }>): Promise<number[]> {
    const msg = await this.request({ type: 'sample', id: 0, points });
    if (msg.type !== 'sample') throw new Error('unexpected worker response');
    return msg.elevations;
  }

  async inspect(lat: number, lon: number): Promise<PointInspection> {
    const msg = await this.request({ type: 'inspect', id: 0, lat, lon });
    if (msg.type !== 'inspect') throw new Error('unexpected worker response');
    return msg.inspection;
  }

  async detours(profile: RouteProfile, candidates: DetourCandidate[]) {
    const msg = await this.request({ type: 'detours', id: 0, profile, candidates });
    if (msg.type !== 'detours') throw new Error('unexpected worker response');
    return msg.detours;
  }

  /** True once the grid is loaded (inspection and detours need it). */
  get isReady(): boolean {
    return this.ready !== null;
  }

  private async request(req: Extract<WorkerRequest, { id: number }>): Promise<WorkerResponse> {
    if (!this.ready) throw new Error('routing grid not initialised');
    await this.ready;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.post({ ...req, id });
    });
  }

  private post(msg: WorkerRequest): void {
    this.worker?.postMessage(msg);
  }
}

export const routingClient = new RoutingClient();
