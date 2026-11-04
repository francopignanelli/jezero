import { LINES, mainElements, spectrum, type RockType } from './science';

const SPEC_W = 260;
const SPEC_H = 70;

/** LIBS spectrum: intensity against wavelength (240–800 nm), the main lines labelled. */
export function Spectrum({ type, seed, small }: { type: RockType; seed: string; small?: boolean }) {
  const values = spectrum(type, seed);
  const max = Math.max(...values);
  const x = (nm: number) => ((nm - 240) / 560) * SPEC_W;
  const pts = values
    .map(
      (v, i) =>
        `${((i / (values.length - 1)) * SPEC_W).toFixed(1)},${(SPEC_H - 12 - (v / max) * (SPEC_H - 22)).toFixed(1)}`,
    )
    .join(' ');
  const main = mainElements(type, 4);
  const labelled = LINES.filter(
    (l, i) => main.includes(l.el) && LINES.findIndex((m) => m.el === l.el) === i,
  );
  return (
    <svg
      className={`game-spectrum ${small ? 'is-small' : ''}`}
      viewBox={`0 0 ${SPEC_W} ${SPEC_H}`}
      aria-hidden="true"
    >
      <polyline points={pts} />
      {labelled.map((l) => (
        <text key={l.el} x={x(l.nm)} y={9} textAnchor="middle">
          {l.el}
        </text>
      ))}
      {!small && (
        <>
          <text x={0} y={SPEC_H - 1}>
            240 nm
          </text>
          <text x={SPEC_W} y={SPEC_H - 1} textAnchor="end">
            800 nm
          </text>
        </>
      )}
    </svg>
  );
}
