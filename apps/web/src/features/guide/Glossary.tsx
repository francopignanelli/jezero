import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../app/store';
import { IconX } from '../../ui/icons';

/** Glossary term ids (texts in i18n under glossary.terms.<id>.{term,def}). */
export const GLOSSARY_TERMS = [
  'marswalk',
  'jezero',
  'perseverance',
  'sol',
  'ltst',
  'ls',
  'plannedEva',
  'evaLimit',
  'walkback',
  'slope',
  'slopeLimit',
  'lowerRisk',
  'coverage',
  'elevation',
  'thermalInertia',
  'crism',
  'hirise',
  'ctx',
  'mola',
  'viking',
  'meda',
  'reach',
  'detour',
  'dwell',
  'daylight',
] as const;
export type GlossaryTermId = (typeof GLOSSARY_TERMS)[number];

/** A label that opens the glossary at its definition (dotted underline, keyboard accessible). */
export function Term({ id, children }: { id: GlossaryTermId; children: ReactNode }) {
  const { t } = useTranslation();
  const openGlossary = useApp((s) => s.openGlossary);
  return (
    <button
      type="button"
      className="term"
      title={t(`glossary.terms.${id}.def`)}
      onClick={() => openGlossary(id)}
    >
      {children}
    </button>
  );
}

/** Plain-language definitions of every technical word in the app, searchable, in EN and ES. */
export function Glossary() {
  const { t, i18n } = useTranslation();
  const { open, term } = useApp((s) => s.glossary);
  const close = useApp((s) => s.closeGlossary);
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLDListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const entries = useMemo(
    () =>
      GLOSSARY_TERMS.map((id) => ({
        id,
        term: t(`glossary.terms.${id}.term`),
        def: t(`glossary.terms.${id}.def`),
      })).sort((a, b) => a.term.localeCompare(b.term, i18n.language)),
    [t, i18n.language],
  );
  const q = query.trim().toLowerCase();
  const shown = q ? entries.filter((e) => `${e.term} ${e.def}`.toLowerCase().includes(q)) : entries;

  useEffect(() => {
    if (!open) return;
    setQuery('');
    if (term) {
      window.setTimeout(() => {
        const el = listRef.current?.querySelector<HTMLElement>(`#gloss-${term}`);
        el?.scrollIntoView({ block: 'center' });
        el?.classList.add('flash');
        window.setTimeout(() => el?.classList.remove('flash'), 1600);
      }, 50);
    } else searchRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, term, close]);

  if (!open) return null;
  return (
    <div className="welcome-backdrop" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="glossary" role="dialog" aria-modal="true" aria-labelledby="glossary-title">
        <div className="card-title">
          <h2 id="glossary-title">{t('glossary.title')}</h2>
          <button
            type="button"
            className="popover-close"
            aria-label={t('glossary.close')}
            onClick={close}
          >
            <IconX />
          </button>
        </div>
        <p className="lede">{t('glossary.intro')}</p>
        <label className="field">
          <span className="visually-hidden">{t('glossary.search')}</span>
          <input
            ref={searchRef}
            type="search"
            placeholder={t('glossary.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <dl ref={listRef} className="glossary-list">
          {shown.map((e) => (
            <div key={e.id} id={`gloss-${e.id}`} className="glossary-item">
              <dt>{e.term}</dt>
              <dd>{e.def}</dd>
            </div>
          ))}
          {shown.length === 0 && <p className="meta">{t('glossary.none')}</p>}
        </dl>
      </div>
    </div>
  );
}
