import type { ExplanationCode } from '@copernico/domain';
import i18n from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import en from '../i18n/en.json';
import es from '../i18n/es.json';
import { explanationText } from './explain';
import { formatDegrees, formatDistance, formatDuration, formatHours } from './format';

describe('display precision (PLAN §6.6)', () => {
  it('rounds distances to 10 m below 1 km and to 0.01 km above', () => {
    expect(formatDistance(1234.5, 'en')).toBe('1.23 km');
    expect(formatDistance(374, 'en')).toBe('370 m');
    expect(formatDistance(5, 'en')).toBe('10 m');
    expect(formatDistance(Number.NaN, 'en')).toBe('—');
  });

  it('rounds durations to 5 minutes and slopes to whole degrees', () => {
    expect(formatDuration(3.76 * 3600)).toBe('3 h 45 min');
    expect(formatDuration(149)).toBe('0 min');
    expect(formatDuration(151)).toBe('5 min');
    expect(formatDuration(8 * 3600)).toBe('8 h');
    expect(formatDuration(3600 + 300)).toBe('1 h 05 min');
    expect(formatDegrees(14.75, 'en')).toBe('15°');
    expect(formatHours(9.999)).toBe('10:00');
  });
});

describe('explanations are rendered only from structured facts', () => {
  beforeAll(async () => {
    await i18n.init({
      resources: { en: { translation: en }, es: { translation: es } },
      lng: 'en',
      interpolation: { escapeValue: false },
    });
  });

  const detour: ExplanationCode = {
    code: 'DETOUR_AVOIDS_STEEP_TERRAIN',
    extraDistanceM: 33.7,
    steepAvoidedM: 197.7,
    moderateAvoidedM: 258.8,
    lowerRiskMaxSlopeDeg: 14.75,
    shortestMaxSlopeDeg: 18.25,
  };

  it('English', () => {
    const text = explanationText(detour, i18n.t.bind(i18n), 'en');
    expect(text).toContain('30 m longer');
    expect(text).toContain('200 m of 15–20° slopes');
    expect(text).toContain('15°, versus 18°');
  });

  it('Spanish has the same keys as English', async () => {
    const keys = (o: object, p = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) =>
        typeof v === 'object' ? keys(v as object, `${p}${k}.`) : [`${p}${k}`],
      );
    expect(keys(es).sort()).toEqual(keys(en).sort());
    await i18n.changeLanguage('es');
    expect(explanationText(detour, i18n.t.bind(i18n), 'es')).toContain('evita');
  });
});
