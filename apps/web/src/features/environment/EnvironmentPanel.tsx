import { daylightWindow, m2020Sol, m2020SolStartUtcMs, mars24, marsYear, solarPosition, SOL_SECONDS } from '@copernico/domain';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../app/store';
import { JEZERO } from '../../config';
import { formatDegrees, formatHours, formatUtc } from '../../lib/format';
import { MedaCard } from './MedaCard';

function seasonKey(ls: number): string {
  if (ls < 90) return 'northSpring';
  if (ls < 180) return 'northSummer';
  if (ls < 270) return 'northAutumn';
  return 'northWinter';
}

const toLocalInput = (ms: number) => new Date(ms).toISOString().slice(0, 16);

export function EnvironmentPanel() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const evaStart = useApp((s) => s.evaStartUtcMs);
  const setEvaStart = useApp((s) => s.setEvaStart);
  const minElevation = 10;

  const model = useMemo(() => {
    const s = mars24(evaStart);
    const sun = solarPosition(evaStart, JEZERO);
    const sol = m2020Sol(evaStart);
    const window = daylightWindow(m2020SolStartUtcMs(sol), SOL_SECONDS * 1000, JEZERO, minElevation);
    return { s, sun, sol, window, my: marsYear(s) };
  }, [evaStart]);

  return (
    <section aria-labelledby="env-title">
      <h2 id="env-title">{t('environment.title')}</h2>
      <p className="lede">{t('environment.intro')}</p>
      <p className="alert alert-info">{t('environment.noLive')}</p>

      <label className="field" style={{ marginTop: 12 }}>
        {t('environment.evaStart')}
        <input
          type="datetime-local"
          value={toLocalInput(evaStart)}
          onChange={(e) => {
            const ms = Date.parse(`${e.target.value}:00Z`);
            if (Number.isFinite(ms)) setEvaStart(ms);
          }}
        />
      </label>

      <div className="card">
        <div className="card-title">
          {t('status.sol', { sol: model.sol })} · {t('status.marsYear', { my: model.my })}
          <span className="tag tag-calculated">{t('environment.kinds.calculated')}</span>
        </div>
        <dl className="metrics">
          <div className="metric">
            <dt>{t('environment.season')}</dt>
            <dd style={{ fontSize: 'var(--fs-sm)' }}>
              {t(`environment.seasons.${seasonKey(model.s.lsDeg)}`)}
              <small>Ls {formatDegrees(model.s.lsDeg, locale, 1)}</small>
            </dd>
          </div>
          <div className="metric">
            <dt>LTST</dt>
            <dd>
              {formatHours(model.sun.ltstHours)}
              <small>LMST {formatHours(model.sun.lmstHours)}</small>
            </dd>
          </div>
          <div className="metric">
            <dt>{t('environment.sunElevation')}</dt>
            <dd>{formatDegrees(model.sun.elevationDeg, locale)}</dd>
          </div>
          <div className="metric">
            <dt>{t('environment.sunAzimuth')}</dt>
            <dd>{formatDegrees(model.sun.azimuthDeg, locale)}</dd>
          </div>
        </dl>
        <p style={{ fontSize: 'var(--fs-sm)' }}>
          <strong>{t('environment.daylight', { min: minElevation })}:</strong>{' '}
          {model.window
            ? `${formatUtc(model.window.startUtcMs, locale)} → ${formatUtc(model.window.endUtcMs, locale)}`
            : t('environment.noDaylight', { min: minElevation })}
        </p>
        <p className="meta">{t('status.calculated')}</p>
        <p className="meta">{t('environment.lighting')}</p>
      </div>

      <h3>{t('environment.measurementsTitle')}</h3>
      <MedaCard />
    </section>
  );
}
