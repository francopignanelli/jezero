import {
  DEG_TO_RAD,
  greatCircleDistance,
  MARS_SPHERE_RADIUS_M,
  mars24,
  marsYear,
} from '@copernico/domain';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { DATA_VERSION, dataUrl } from '../../config';
import { PANORAMA_CREDIT, PANORAMAS, POIS, type Panorama } from '../../data/catalog';
import {
  loadRover,
  loadSamples,
  type RoverSnapshot,
  type SampleSite,
} from '../../data/surfaceData';
import { formatDegrees, formatDistance, formatElevation } from '../../lib/format';
import { IconChevron, IconPlay } from '../../ui/icons';

/** A place drawn inside the photo at its true direction. */
export interface Target {
  key: string;
  kind: 'poi' | 'panorama';
  id: string;
  name: string;
  azimuthDeg: number;
  elevationDeg: number;
  distanceM: number;
  /** Terrain between the camera and the place hides it (it is labelled at its direction anyway). */
  hidden: boolean;
  /** A POI where another panorama was taken: its label carries a "360°" chip to walk there. */
  panoramaId?: string | undefined;
}

const COMPASS16 = 'N NNE NE ENE E ESE SE SSE S SSW SW WSW W WNW NW NNW'.split(' ');
export const compass16 = (deg: number): string =>
  COMPASS16[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]!;

const M_PER_DEG = MARS_SPHERE_RADIUS_M * DEG_TO_RAD;
const NEARBY_SAMPLE_M = 600;

let roverPromise: Promise<RoverSnapshot | null> | null = null;
let samplesPromise: Promise<{ samples: SampleSite[] } | null> | null = null;

/** Rover traverse and samples (loaded once, shared by every panorama). */
export function useMissionData() {
  const [data, setData] = useState<{ rover: RoverSnapshot | null; samples: SampleSite[] }>({
    rover: null,
    samples: [],
  });
  useEffect(() => {
    roverPromise ??= loadRover();
    samplesPromise ??= loadSamples();
    let live = true;
    void Promise.all([roverPromise, samplesPromise]).then(([rover, s]) => {
      if (live) setData({ rover, samples: s?.samples ?? [] });
    });
    return () => {
      live = false;
    };
  }, []);
  return data;
}

export const solText = (p: Panorama): string =>
  p.sols[0] === p.sols[1] ? `${p.sols[0]}` : `${p.sols[0]}–${p.sols[1]}`;

function seasonKey(ls: number): string {
  if (ls < 90) return 'northSpring';
  if (ls < 180) return 'northSummer';
  if (ls < 270) return 'northAutumn';
  return 'northWinter';
}

/** Title block: place name, sol, date and Mars season. */
export function PanoramaTitle({ pano }: { pano: Panorama }) {
  const { t, i18n } = useTranslation();
  const utc = Date.parse(`${pano.date}T12:00:00Z`);
  const s = mars24(utc);
  const date = new Intl.DateTimeFormat(i18n.language, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(utc);
  return (
    <div className="pano-titleblock">
      <p className="pano-kicker">{t('panorama.hud.kicker')}</p>
      <h2 id="pano-title">{pano.title}</h2>
      <p className="pano-subline">
        <span>
          {t('panorama.hud.sol')} {solText(pano)}
        </span>
        <span>{date}</span>
        <span>
          {t(`environment.seasons.${seasonKey(s.lsDeg)}`)} · MY {marsYear(s)}
        </span>
      </p>
    </div>
  );
}

interface PanelProps {
  pano: Panorama;
  rover: RoverSnapshot | null;
  samples: SampleSite[];
}

/**
 * Side panel, kept short: what you are looking at and where (plain words, for anyone), why the
 * place matters, the mission moment, samples collected nearby, and the source (folded). Places
 * around are on the photo and the mini-map, so they are not listed again here.
 */
export function InfoPanel({ pano, rover, samples }: PanelProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const lang = locale.startsWith('es') ? 'es' : 'en';
  const g = pano.geometry!;
  const poi = POIS.find((p) => p.id === pano.poiId);
  const s = mars24(Date.parse(`${pano.date}T12:00:00Z`));
  const waypoint = rover?.waypoints.filter((w) => w[0] <= pano.sols[0]).at(-1);
  const landing = POIS.find((p) => p.id === 'landing-site');
  const fromLanding = landing ? greatCircleDistance(pano.position, landing) : NaN;
  const nearby = samples
    .map((x) => ({ x, d: greatCircleDistance(pano.position, x) }))
    .filter((n) => n.d <= NEARBY_SAMPLE_M)
    .sort((a, b) => a.d - b.d)
    .slice(0, 4);

  return (
    <aside className="pano-panel" aria-label={t('panorama.hud.info')}>
      <section>
        <h3>{t('panorama.hud.what')}</h3>
        <p className="pano-intro">{t(`panorama.intro.${pano.id}`)}</p>
        <h3>{t('panorama.hud.about')}</h3>
        <p>{poi ? poi.why[lang] : t(`panorama.about.${pano.id}`)}</p>
      </section>

      <section>
        <h3>{t('panorama.hud.moment')}</h3>
        <dl className="pano-facts">
          <div>
            <dt>{t('environment.season')}</dt>
            <dd>
              {t(`environment.seasons.${seasonKey(s.lsDeg)}`)}
              <small>
                Ls {formatDegrees(s.lsDeg, locale)} · MY {marsYear(s)}
              </small>
            </dd>
          </div>
          <div>
            <dt>{t('panorama.hud.driven')}</dt>
            <dd>
              {waypoint
                ? formatDistance(waypoint[4], locale)
                : rover
                  ? formatDistance(0, locale) // before the first logged drive
                  : '—'}
            </dd>
          </div>
          <div>
            <dt>{t('panorama.hud.elevation')}</dt>
            <dd>
              {formatElevation(g.groundM, locale)}
              <small>{t('panorama.hud.elevationRef')}</small>
            </dd>
          </div>
          <div>
            <dt>{t('panorama.hud.fromLanding')}</dt>
            <dd>{formatDistance(fromLanding, locale)}</dd>
          </div>
        </dl>
      </section>

      <section>
        <h3>{t('panorama.hud.samples')}</h3>
        {nearby.length === 0 ? (
          <p className="pano-muted">{t('panorama.hud.noSamples')}</p>
        ) : (
          <ul className="pano-list">
            {nearby.map(({ x, d }) => (
              <li key={x.sampleNumber}>
                <span className="pano-dot pano-dot-sample" aria-hidden="true" />
                <span className="pano-row-text">
                  <strong>
                    #{x.sampleNumber} {x.name}
                  </strong>
                  <small>
                    {t('panorama.hud.sol')} {x.sol} · {x.rockType || x.sampleType} ·{' '}
                    {formatDistance(d, locale)}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <details className="pano-source">
        <summary>{t('panorama.hud.source')}</summary>
        <p>{t('panorama.caption', { sols: solText(pano), date: pano.date })}</p>
        <p className="pano-muted">
          {PANORAMA_CREDIT} · {pano.reference}
        </p>
        <p className="pano-muted">
          {t('panorama.measured', { residual: g.medianResidualDeg.toFixed(2) })}
        </p>
        {(g.unimagedFraction ?? 0) > 0.01 && (
          <p className="pano-muted">
            {t('panorama.hud.unimagedNote', {
              percent: Math.round((g.unimagedFraction ?? 0) * 100),
            })}
          </p>
        )}
      </details>
    </aside>
  );
}

/** Mini-map size (CSS px) and the ground span it shows (m). */
export const MINIMAP_PX = 216;
const MINIMAP_SPAN_M = 3_000;

/** SVG path of the view cone on the mini-map for a heading and horizontal field of view (deg). */
export function coneD(headingDeg: number, hfovDeg: number): string {
  const c = MINIMAP_PX / 2;
  const r = MINIMAP_PX * 0.36;
  const a0 = (headingDeg - hfovDeg / 2) * DEG_TO_RAD;
  const a1 = (headingDeg + hfovDeg / 2) * DEG_TO_RAD;
  const p = (a: number) =>
    `${(c + r * Math.sin(a)).toFixed(1)} ${(c - r * Math.cos(a)).toFixed(1)}`;
  return `M ${c} ${c} L ${p(a0)} A ${r} ${r} 0 ${hfovDeg > 180 ? 1 : 0} 1 ${p(a1)} Z`;
}

/** Ground map around the panorama: CTX orbital image, the traverse, and the current view cone. */
export function MiniMap({
  pano,
  rover,
  coneRef,
  onWalk,
}: {
  pano: Panorama;
  rover: RoverSnapshot | null;
  coneRef: RefObject<SVGPathElement | null>;
  onWalk(id: string): void;
}) {
  const { t, i18n } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { lat: lat0, lon: lon0 } = pano.position;
  const cos0 = Math.cos(lat0 * DEG_TO_RAD);
  const k = MINIMAP_PX / MINIMAP_SPAN_M;
  const px = (lat: number, lon: number): [number, number] => [
    MINIMAP_PX / 2 + (lon - lon0) * cos0 * M_PER_DEG * k,
    MINIMAP_PX / 2 - (lat - lat0) * M_PER_DEG * k,
  ];

  useEffect(() => {
    const canvas = canvasRef.current!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = canvas.height = MINIMAP_PX * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let live = true;
    // CTX tiles at z12 (≈10 m/px, ~2.5 km per tile): the 3 km view needs at most 3×3.
    const z = 12;
    const tw = 180 / 2 ** z;
    const halfLon = MINIMAP_SPAN_M / 2 / (M_PER_DEG * cos0);
    const halfLat = MINIMAP_SPAN_M / 2 / M_PER_DEG;
    const tiles: Array<{ x: number; y: number }> = [];
    const x0 = Math.floor((lon0 - halfLon + 180) / tw);
    const x1 = Math.floor((lon0 + halfLon + 180) / tw);
    const y0 = Math.floor((90 - lat0 - halfLat) / tw);
    const y1 = Math.floor((90 - lat0 + halfLat) / tw);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) tiles.push({ x, y });
    const images = tiles.map(({ x, y }) => {
      const img = new Image();
      img.src = dataUrl(`tiles/imagery/ctx/${z}/${x}/${y}.webp?v=${DATA_VERSION}`);
      return img.decode().then(
        () => ({ img, x, y }),
        () => null,
      );
    });
    void Promise.all(images).then((loaded) => {
      if (!live) return;
      ctx.fillStyle = '#2a1a12';
      ctx.fillRect(0, 0, MINIMAP_PX, MINIMAP_PX);
      for (const tile of loaded) {
        if (!tile) continue;
        const [ax, ay] = px(90 - tile.y * tw, tile.x * tw - 180);
        const [bx, by] = px(90 - (tile.y + 1) * tw, (tile.x + 1) * tw - 180);
        ctx.drawImage(tile.img, ax, ay, bx - ax, by - ay);
      }
      // Greyscale CTX tinted with the Mastcam-Z ground colour, then dimmed for the overlay.
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = 'rgb(255, 176, 118)';
      ctx.fillRect(0, 0, MINIMAP_PX, MINIMAP_PX);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(12, 9, 7, 0.28)';
      ctx.fillRect(0, 0, MINIMAP_PX, MINIMAP_PX);
      // Traverse: driven up to this panorama (solid amber) and afterwards (dashed, faint).
      if (rover) {
        const pts = rover.waypoints;
        const split = pts.findIndex((w) => w[0] > pano.sols[1]);
        const cut = split < 0 ? pts.length : split;
        const stroke = (from: number, to: number, style: string, dash: number[]) => {
          ctx.beginPath();
          pts.slice(from, to).forEach((w, i) => {
            const [x, y] = px(w[1], w[2]);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.setLineDash(dash);
          ctx.strokeStyle = style;
          ctx.lineWidth = 2;
          ctx.lineJoin = 'round';
          ctx.stroke();
        };
        stroke(Math.max(0, cut - 1), pts.length, 'rgba(255, 236, 214, 0.5)', [3, 4]);
        stroke(0, cut, 'rgba(242, 160, 70, 0.95)', []);
        ctx.setLineDash([]);
      }
      for (const p of POIS) {
        const [x, y] = px(p.lat, p.lon);
        if (x < 0 || y < 0 || x > MINIMAP_PX || y > MINIMAP_PX) continue;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, 2 * Math.PI);
        ctx.fillStyle = '#b69cff';
        ctx.fill();
      }
    });
    return () => {
      live = false;
    };
    // px depends only on the panorama position.
  }, [pano, rover]);

  const others = PANORAMAS.filter((p) => p.id !== pano.id)
    .map((p) => ({ p, xy: px(p.position.lat, p.position.lon) }))
    .filter(({ xy: [x, y] }) => x > 6 && y > 6 && x < MINIMAP_PX - 6 && y < MINIMAP_PX - 6);

  return (
    <div className="pano-minimap" role="group" aria-label={t('panorama.hud.minimap')}>
      <canvas
        ref={canvasRef}
        style={{ width: MINIMAP_PX, height: MINIMAP_PX }}
        aria-hidden="true"
      />
      <svg viewBox={`0 0 ${MINIMAP_PX} ${MINIMAP_PX}`} aria-hidden="true">
        <defs>
          <radialGradient id="pano-cone" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffd59e" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#ffd59e" stopOpacity="0" />
          </radialGradient>
        </defs>
        <path ref={coneRef} fill="url(#pano-cone)" />
        <circle
          cx={MINIMAP_PX / 2}
          cy={MINIMAP_PX / 2}
          r="5.5"
          fill="#fff"
          stroke="#e8613c"
          strokeWidth="2.5"
        />
        <text x={MINIMAP_PX / 2} y="15" textAnchor="middle" className="pano-minimap-n">
          N
        </text>
        <g className="pano-minimap-scale">
          <line x1="12" x2={12 + 1000 * k} y1={MINIMAP_PX - 12} y2={MINIMAP_PX - 12} />
          <text x="12" y={MINIMAP_PX - 18}>
            {formatDistance(1000, i18n.language)}
          </text>
        </g>
      </svg>
      {others.map(({ p, xy: [x, y] }) => (
        <button
          key={p.id}
          type="button"
          className="pano-minimap-pano"
          style={{ left: x, top: y }}
          title={`${p.title} · ${t('panorama.hud.sol')} ${solText(p)}`}
          aria-label={t('panorama.hud.walkHere', { name: p.title })}
          onClick={() => onWalk(p.id)}
        />
      ))}
    </div>
  );
}

/** Every panorama on a line of mission sols, with previous / next. */
export function Timeline({
  pano,
  rover,
  onWalk,
  touring,
  onTour,
}: {
  pano: Panorama;
  rover: RoverSnapshot | null;
  onWalk(id: string): void;
  touring: boolean;
  onTour(): void;
}) {
  const { t } = useTranslation();
  const list = [...PANORAMAS].sort((a, b) => a.sols[0] - b.sols[0]);
  const maxSol = Math.max(rover?.latest.sol ?? 0, ...list.map((p) => p.sols[1]));
  const i = list.findIndex((p) => p.id === pano.id);
  const prev = list[i - 1];
  const next = list[i + 1];
  const at = (p: Panorama) => `${(p.sols[0] / maxSol) * 100}%`;
  const label = (p: Panorama) => `${p.title} · ${t('panorama.hud.sol')} ${solText(p)}`;
  return (
    <nav className="pano-timeline" aria-label={t('panorama.hud.timeline')}>
      {!touring && (
        <button
          type="button"
          className="pano-play"
          title={t('panorama.tour.startHint')}
          onClick={onTour}
        >
          <IconPlay width={16} height={16} />
          <span>{t('panorama.tour.start')}</span>
        </button>
      )}
      <button
        type="button"
        className="pano-step pano-step-prev"
        disabled={!prev}
        aria-label={prev ? t('panorama.hud.prev', { name: prev.title, sol: prev.sols[0] }) : ''}
        title={prev ? label(prev) : undefined}
        onClick={() => prev && onWalk(prev.id)}
      >
        <IconChevron width={18} height={18} />
      </button>
      <div className="pano-track">
        <span className="pano-track-line" />
        <span className="pano-track-done" style={{ width: at(pano) }} />
        {list.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`pano-track-dot${p.id === pano.id ? ' is-current' : ''}`}
            style={{ left: at(p) }}
            aria-current={p.id === pano.id ? 'location' : undefined}
            aria-label={label(p)}
            title={label(p)}
            onClick={() => onWalk(p.id)}
          />
        ))}
        <span className="pano-track-end pano-track-start">{t('panorama.hud.landing')}</span>
        <span className="pano-track-end">
          {t('panorama.hud.sol')} {maxSol}
        </span>
      </div>
      <button
        type="button"
        className="pano-step"
        disabled={!next}
        aria-label={next ? t('panorama.hud.next', { name: next.title, sol: next.sols[0] }) : ''}
        title={next ? label(next) : undefined}
        onClick={() => next && onWalk(next.id)}
      >
        <IconChevron width={18} height={18} />
      </button>
    </nav>
  );
}
