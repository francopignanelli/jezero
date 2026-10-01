/** Public, non-secret client configuration. Never place credentials in VITE_* variables. */
export const DATA_BASE_URL: string =
  (import.meta.env.VITE_DATA_BASE_URL as string | undefined) ?? './data';

export const dataUrl = (path: string): string => `${DATA_BASE_URL.replace(/\/$/, '')}/${path}`;

/**
 * Version token appended to tile URLs so browsers and CloudFront never serve tiles from an older
 * data build. Set VITE_DATA_VERSION at release time; in development every page load is fresh.
 */
export const DATA_VERSION: string =
  (import.meta.env.VITE_DATA_VERSION as string | undefined) ??
  (import.meta.env.DEV ? String(Date.now()) : 'jezero-v1');

/** Absolute form, required when handing URLs to Web Workers (they resolve relative to the worker script). */
export const absoluteDataUrl = (path: string): string =>
  new URL(dataUrl(path), window.location.href).href;

/** Initial orbital view over Jezero (planetocentric °N, °E). */
export const JEZERO = { lat: 18.44, lon: 77.45 } as const;

/**
 * Oblique operational view: look at the delta front from the south-east. Heights are metres
 * relative to the reference sphere; the Jezero floor is ~2.5 km below it.
 */
export const JEZERO_OPERATIONAL_VIEW = {
  lat: 18.455,
  lon: 77.41,
  targetHeightM: -2500,
  rangeM: 9000,
  headingDeg: -35,
  pitchDeg: -32,
} as const;

/**
 * Features that are hidden until they work end to end (no placeholder UI in the product).
 * Enable locally with VITE_FEATURE_ASSISTANT=true / VITE_FEATURE_MISSIONS=true.
 */
export const FEATURES = {
  assistant: import.meta.env.VITE_FEATURE_ASSISTANT === 'true',
  missions: import.meta.env.VITE_FEATURE_MISSIONS === 'true',
} as const;
