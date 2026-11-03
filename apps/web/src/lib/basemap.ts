import { DEG_TO_RAD } from '@copernico/domain';
import { DATA_VERSION, dataUrl } from '../config';
import { M_PER_DEG } from './math';

/** A small north-up map centred on (lat0, lon0) at `mPerPx` ground metres per CSS pixel. */
export interface LocalMap {
  lat0: number;
  lon0: number;
  widthPx: number;
  heightPx: number;
  mPerPx: number;
}

/** Map pixel of a position (local flat projection, adequate over a few km). */
export function mapPx(m: LocalMap, lat: number, lon: number): [number, number] {
  return [
    m.widthPx / 2 + ((lon - m.lon0) * Math.cos(m.lat0 * DEG_TO_RAD) * M_PER_DEG) / m.mPerPx,
    m.heightPx / 2 - ((lat - m.lat0) * M_PER_DEG) / m.mPerPx,
  ];
}

/**
 * Loads the CTX tiles covering the map at zoom `z` (z12 ≈ 10 m/px, z13 ≈ 5 m/px) and returns a
 * function that draws them, tinted with the Mastcam-Z ground colour and dimmed for overlays. The
 * caller draws once its component is still mounted.
 */
export async function loadGroundBasemap(
  m: LocalMap,
  z = 12,
): Promise<(ctx: CanvasRenderingContext2D) => void> {
  const tw = 180 / 2 ** z;
  const cos0 = Math.cos(m.lat0 * DEG_TO_RAD);
  const halfLon = ((m.widthPx / 2) * m.mPerPx) / (M_PER_DEG * cos0);
  const halfLat = ((m.heightPx / 2) * m.mPerPx) / M_PER_DEG;
  const tiles: Array<{ x: number; y: number }> = [];
  const x0 = Math.floor((m.lon0 - halfLon + 180) / tw);
  const x1 = Math.floor((m.lon0 + halfLon + 180) / tw);
  const y0 = Math.floor((90 - m.lat0 - halfLat) / tw);
  const y1 = Math.floor((90 - m.lat0 + halfLat) / tw);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) tiles.push({ x, y });
  const loaded = await Promise.all(
    tiles.map(({ x, y }) => {
      const img = new Image();
      img.src = dataUrl(`tiles/imagery/ctx/${z}/${x}/${y}.webp?v=${DATA_VERSION}`);
      return img.decode().then(
        () => ({ img, x, y }),
        () => null,
      );
    }),
  );
  return (ctx) => {
    ctx.fillStyle = '#2a1a12';
    ctx.fillRect(0, 0, m.widthPx, m.heightPx);
    for (const tile of loaded) {
      if (!tile) continue;
      const [ax, ay] = mapPx(m, 90 - tile.y * tw, tile.x * tw - 180);
      const [bx, by] = mapPx(m, 90 - (tile.y + 1) * tw, (tile.x + 1) * tw - 180);
      ctx.drawImage(tile.img, ax, ay, bx - ax, by - ay);
    }
    // Greyscale CTX tinted with the Mastcam-Z ground colour, then dimmed for the overlay.
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = 'rgb(255, 176, 118)';
    ctx.fillRect(0, 0, m.widthPx, m.heightPx);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(12, 9, 7, 0.28)';
    ctx.fillRect(0, 0, m.widthPx, m.heightPx);
  };
}
