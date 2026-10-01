import { useApp } from '../../app/store';
import { absoluteDataUrl } from '../../config';
import { routingClient } from './routingClient';
import type { GridSummary } from './routing.worker';

/** Loads the Jezero routing grid once (idempotent) and mirrors its status in the store. */
export async function ensureGrid(): Promise<GridSummary | null> {
  const { gridStatus, setGridStatus } = useApp.getState();
  if (gridStatus === 'unavailable') return null;
  if (gridStatus === 'idle') setGridStatus('loading');
  try {
    const summary = await routingClient.init(absoluteDataUrl('regions/jezero'));
    useApp.getState().setGridStatus('ready');
    return summary;
  } catch {
    useApp.getState().setGridStatus('unavailable');
    return null;
  }
}
