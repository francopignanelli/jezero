import {
  Color,
  DataArrayTexture,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RedFormat,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three';
import { DATA_VERSION, dataUrl } from '../../config';
import type { GroundTextureMeta, ImageMeta } from './heights';
import type { GroundTextures } from './terrain';

/** Decodes an image file to RGBA pixels (off the main thread where the browser can). */
export async function loadPixels(file: string): Promise<ImageData> {
  const res = await fetch(dataUrl(`${file}?v=${DATA_VERSION}`));
  if (!res.ok) throw new Error(`${file}: ${res.status}`);
  const bitmap = await createImageBitmap(await res.blob());
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** Box blur with wrap-around (tileable images), separable sliding window. */
function blurWrap(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const k = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[y * w + ((i + w) % w)]!;
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / k;
      acc += src[y * w + ((x + r + 1) % w)]! - src[y * w + ((x - r + w) % w)]!;
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += tmp[((i + h) % h) * w + x]!;
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / k;
      acc += tmp[((y + r + 1) % h) * w + x]! - tmp[((y - r + h) % h) * w + x]!;
    }
  }
  return out;
}

/**
 * Tangent-space normal map (x east, y north, z up) from a photo's fine relief: luminance minus its
 * local mean is taken as height (shadowed pits low, lit pebble tops high), a common approximation
 * for natural ground under side light.
 */
export function normalFromPhoto(
  px: Uint8ClampedArray,
  w: number,
  h: number,
  strength: number,
): Uint8Array {
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++)
    lum[i] = (px[i * 4]! * 0.3 + px[i * 4 + 1]! * 0.59 + px[i * 4 + 2]! * 0.11) / 255;
  const base = blurWrap(lum, w, h, 12);
  const height = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) height[i] = lum[i]! - base[i]!;
  const hs = blurWrap(height, w, h, 1);
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const at = (xx: number, yy: number) => hs[((yy + h) % h) * w + ((xx + w) % w)]!;
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dyDown = (at(x, y + 1) - at(x, y - 1)) * strength;
      // Image rows go south, the normal map's y goes north.
      const nx = -dx;
      const ny = dyDown;
      const len = Math.hypot(nx, ny, 1);
      const o = (y * w + x) * 4;
      out[o] = Math.round((nx / len) * 127.5 + 127.5);
      out[o + 1] = Math.round((ny / len) * 127.5 + 127.5);
      out[o + 2] = Math.round((1 / len) * 127.5 + 127.5);
      out[o + 3] = 255;
    }
  return out;
}

const ORDER: GroundTextureMeta['id'][] = ['regolith', 'gravel', 'sand', 'bedrock'];

export async function loadGroundTextures(meta: GroundTextureMeta[]): Promise<GroundTextures> {
  const list = ORDER.map((id) => meta.find((m) => m.id === id)!);
  const images = await Promise.all(list.map((m) => loadPixels(m.file)));
  const size = images[0]!.width;
  const albedo = new Uint8Array(size * size * 4 * list.length);
  const normal = new Uint8Array(size * size * 4 * list.length);
  images.forEach((img, i) => {
    albedo.set(img.data, i * size * size * 4);
    // Sand ripples are smooth: softer relief; gravel and bedrock are rougher.
    const strength = [5, 7, 4, 8][i]!;
    normal.set(normalFromPhoto(img.data, size, size, strength * 10), i * size * size * 4);
  });
  const array = (data: Uint8Array, srgb: boolean) => {
    const t = new DataArrayTexture(data, size, size, list.length);
    t.format = RGBAFormat;
    t.type = UnsignedByteType;
    t.wrapS = t.wrapT = RepeatWrapping;
    t.minFilter = LinearMipmapLinearFilter;
    t.magFilter = LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  return {
    albedo: array(albedo, true),
    normal: array(normal, false),
    scale: list.map((m) => 1 / m.sizeM) as [number, number, number, number],
    mean: list.map((m) => new Color().setRGB(...m.meanRgb, SRGBColorSpace)),
  };
}

/** Greyscale image as a single-channel texture (and its pixels, for rock placement). */
export async function loadGrey(
  meta: ImageMeta,
): Promise<{ texture: DataTexture; grey: Uint8Array; width: number; height: number }> {
  const img = await loadPixels(meta.file);
  const n = img.width * img.height;
  const grey = new Uint8Array(n);
  for (let i = 0; i < n; i++) grey[i] = img.data[i * 4]!;
  const t = new DataTexture(grey, img.width, img.height, RedFormat, UnsignedByteType);
  t.unpackAlignment = 1; // rows of any width
  t.generateMipmaps = true;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.needsUpdate = true;
  return { texture: t, grey, width: img.width, height: img.height };
}
