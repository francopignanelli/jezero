/** Linear RGB multipliers in 0..1. */
export type Tint = readonly [number, number, number];

/**
 * Multiplies a greyscale imagery tile by a colour, keeping its alpha (feathered edges stay soft).
 * Detail and contrast are untouched; only the hue is approximate.
 */
export function tintImage(
  img: HTMLImageElement | HTMLCanvasElement | ImageBitmap | OffscreenCanvas,
  tint: Tint,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const g = canvas.getContext('2d')!;
  // Cesium decodes tiles to ImageBitmaps already flipped vertically (WebGL ignores the upload flip
  // for bitmaps) but flips canvases on upload, so a bitmap is drawn upright here.
  const bitmap = typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap;
  if (bitmap) g.setTransform(1, 0, 0, -1, 0, canvas.height);
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = `rgb(${tint.map((v) => Math.round(v * 255)).join(' ')})`;
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(img, 0, 0);
  if (bitmap) img.close();
  return canvas;
}
