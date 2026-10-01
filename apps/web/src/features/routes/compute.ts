import { useApp } from '../../app/store';
import { ensureGrid } from './ensureGrid';
import { routingClient } from './routingClient';

/**
 * Plans both alternatives for the current waypoints (in the worker) and stores the result.
 * Returns an error message, or null on success. Shared by the Plan panel and "Add stop" actions.
 */
export async function computeRoutes(messages: {
  needTwo: string;
  gridUnavailable: string;
}): Promise<string | null> {
  const s = useApp.getState();
  if (s.waypoints.length < 2) return messages.needTwo;
  if (s.mode !== 'jezero') s.setMode('jezero');
  s.setComputing(true);
  try {
    if (!(await ensureGrid())) return messages.gridUnavailable;
    const { waypoints, returnToStart } = useApp.getState();
    const { comparison, elapsedMs } = await routingClient.plan(
      waypoints.map((w) => ({ lat: w.lat, lon: w.lon })),
      returnToStart,
    );
    useApp.getState().setResult(comparison);
    useApp.getState().setComputeMs(elapsedMs);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  } finally {
    useApp.getState().setComputing(false);
  }
}
