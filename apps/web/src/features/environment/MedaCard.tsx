import { greatCircleDistance } from '@copernico/domain';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dataUrl, JEZERO } from '../../config';
import { formatDistance, formatUtc } from '../../lib/format';

interface MedaSol {
  sol: number;
  solStartUtc: string;
  lsDeg: number | null;
  airTempK: { min: number; max: number } | null;
  pressurePa: { min: number; mean: number; max: number } | null;
  rover: { lat: number; lon: number; elevationM: number; fromWaypointSol: number } | null;
}
interface MedaFile {
  release: { name: string; published: string; firstSol: number; lastSol: number };
  instrument: string;
  methodology: string[];
  landingPage: string;
  sols: MedaSol[];
}

const c = (k: number) => Math.round(k - 273.15);

/** Latest released MEDA measurements and a historical summary of the release. Never "live". */
export function MedaCard() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const [data, setData] = useState<MedaFile | null | undefined>(undefined);

  useEffect(() => {
    fetch(dataUrl('environment/meda.json'))
      .then((r) => (r.ok ? (r.json() as Promise<MedaFile>) : null))
      .then(setData)
      .catch(() => setData(null));
  }, []);

  if (data === undefined) return null;
  if (!data || data.sols.length === 0) {
    return (
      <div className="card">
        <span className="tag tag-observed">{t('environment.kinds.observed')}</span>
        <p className="lede" style={{ marginTop: 8 }}>
          {t('environment.measurementsPending')}
        </p>
      </div>
    );
  }

  const withTemp = data.sols.filter((s) => s.airTempK && s.pressurePa);
  const latest = withTemp[withTemp.length - 1]!;
  const lows = withTemp.map((s) => s.airTempK!.min);
  const highs = withTemp.map((s) => s.airTempK!.max);
  const pressures = withTemp.map((s) => s.pressurePa!.mean);
  const distance = latest.rover ? greatCircleDistance(latest.rover, JEZERO) : null;

  return (
    <>
      <div className="card">
        <div className="card-title">
          {t('environment.medaLatest', { sol: latest.sol })}
          <span className="tag tag-observed">{t('environment.kinds.observed')}</span>
        </div>
        <p className="meta">
          {formatUtc(Date.parse(latest.solStartUtc), locale)} · {data.release.name} (
          {data.release.published})
        </p>
        <dl className="metrics">
          <div className="metric">
            <dt>{t('environment.airTemp')}</dt>
            <dd>
              {c(latest.airTempK!.min)} … {c(latest.airTempK!.max)} °C
              <small>
                {latest.airTempK!.min} … {latest.airTempK!.max} K
              </small>
            </dd>
          </div>
          <div className="metric">
            <dt>{t('environment.pressure')}</dt>
            <dd>
              {Math.round(latest.pressurePa!.mean)} Pa
              <small>
                {Math.round(latest.pressurePa!.min)} … {Math.round(latest.pressurePa!.max)} Pa
              </small>
            </dd>
          </div>
        </dl>
        {latest.rover && (
          <p className="meta">
            {t('environment.medaWhere', {
              elevation: Math.round(latest.rover.elevationM),
              distance: distance !== null ? formatDistance(distance, locale) : '—',
            })}
          </p>
        )}
        <p className="meta">{t('environment.medaCaveat')}</p>
      </div>

      <div className="card">
        <div className="card-title">
          {t('environment.medaSummary', {
            first: data.release.firstSol,
            last: data.release.lastSol,
          })}
          <span className="tag">{t('environment.kinds.historical_summary')}</span>
        </div>
        <p style={{ fontSize: 'var(--fs-sm)' }}>
          {t('environment.medaRange', {
            n: withTemp.length,
            lowMin: c(Math.min(...lows)),
            lowMax: c(Math.max(...lows)),
            highMin: c(Math.min(...highs)),
            highMax: c(Math.max(...highs)),
            pMin: Math.round(Math.min(...pressures)),
            pMax: Math.round(Math.max(...pressures)),
          })}
        </p>
        <p className="meta">
          Ls {withTemp[0]!.lsDeg?.toFixed(0)}° → {latest.lsDeg?.toFixed(0)}° ·{' '}
          <a
            href={data.landingPage}
            target="_blank"
            rel="noreferrer noopener"
            style={{ color: 'var(--info)' }}
          >
            NASA PDS Atmospheres Node
          </a>
        </p>
      </div>
    </>
  );
}
