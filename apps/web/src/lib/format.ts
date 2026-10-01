/**
 * Display precision follows docs/PLAN.md §6.6: never show more precision than the data supports.
 * distance → 10 m (0.01 km ≥ 1 km); elevation → 1 m; slope → 1°; duration → 5 min.
 */
export function formatDistance(m: number, locale: string): string {
  if (!Number.isFinite(m)) return '—';
  if (Math.abs(m) >= 1000) {
    return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(m / 1000)} km`;
  }
  return `${new Intl.NumberFormat(locale).format(Math.round(m / 10) * 10)} m`;
}

export function formatElevation(m: number, locale: string): string {
  if (!Number.isFinite(m)) return '—';
  return `${new Intl.NumberFormat(locale).format(Math.round(m))} m`;
}

export function formatDegrees(deg: number, locale: string, digits = 0): string {
  if (!Number.isFinite(deg)) return '—';
  return `${new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(deg)}°`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  const totalMin = Math.round(Math.abs(seconds) / 300) * 5;
  const h = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return h > 0 ? `${h} h ${String(min).padStart(2, '0')} min` : `${min} min`;
}

export function formatHours(h: number): string {
  const totalMin = Math.round(h * 60) % (24 * 60);
  return `${String(Math.floor(totalMin / 60)).padStart(2, '0')}:${String(totalMin % 60).padStart(2, '0')}`;
}

export function formatCoordinate(lat: number, lon: number, locale: string): string {
  const f = new Intl.NumberFormat(locale, { minimumFractionDigits: 5, maximumFractionDigits: 5 });
  return `${f.format(lat)}° N, ${f.format(lon)}° E`;
}

export function formatUtc(ms: number, locale: string): string {
  return `${new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(ms))} UTC`;
}
