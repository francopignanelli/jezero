import type { Mission, MissionInput } from '@copernico/contracts';
import type { EvaTimeline, RouteResult } from '@copernico/domain';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useApp, type WaypointEntry } from '../../app/store';
import { DATASET_ID } from '../../config';
import { formatDistance, formatDuration } from '../../lib/format';
import { computeRoutes } from '../routes/compute';
import { Briefing } from './Briefing';
import { decodeShare, encodeShare, fromMissionInput, toMissionInput, type Versions } from './codec';
import { download, fileSlug, toCsv, toGeoJson } from './export';
import { deleteMission, listMissions, renameMission, saveMission, updateMission } from './storage';

const currentVersions = (route: RouteResult): Versions => ({
  datasetVersion: DATASET_ID,
  algorithmVersion: route.algorithmVersion,
  parameterSet: route.parameterSet,
});

const missionState = () => {
  const s = useApp.getState();
  return {
    waypoints: s.waypoints,
    profile: s.profile,
    returnToStart: s.returnToStart,
    evaStartUtcMs: s.evaStartUtcMs,
  };
};

/**
 * Loads a mission into the planner and recomputes it with the current planner and data. Returns a
 * note when the stored versions differ from the ones used now (the route may differ).
 */
export async function openMission(
  m: MissionInput,
  id: string | null,
  messages: { needTwo: string; gridUnavailable: string },
): Promise<{ error: string | null; versionChanged: boolean }> {
  const s = useApp.getState();
  const state = fromMissionInput(m);
  s.setWaypoints(state.waypoints.map(({ id: _id, ...w }) => w));
  s.setProfile(state.profile);
  s.setReturnToStart(state.returnToStart);
  s.setEvaStart(state.evaStartUtcMs);
  s.setActiveMission({ id, name: m.name });
  s.setTab('route');
  const error = await computeRoutes(messages);
  const r = useApp.getState().result;
  const route = r ? (state.profile === 'lower-risk' ? r.lowerRisk : r.shortest) : null;
  const now = route ? currentVersions(route) : null;
  const versionChanged =
    !!now &&
    (now.algorithmVersion !== m.algorithmVersion ||
      now.parameterSet !== m.parameterSet ||
      now.datasetVersion !== m.datasetVersion);
  return { error, versionChanged };
}

/** Opens a mission shared by link (#m=…) once the scene is ready. */
export function useShareLinkLoader(): void {
  const { t } = useTranslation();
  const sceneReady = useApp((s) => s.sceneReady);
  const setNotice = useApp((s) => s.setNotice);
  const done = useRef(false);
  useEffect(() => {
    if (!sceneReady || done.current) return;
    done.current = true;
    const d = decodeShare(window.location.hash);
    if (!d.ok) {
      if (d.reason === 'invalid') setNotice({ kind: 'error', text: t('missions.shareInvalid') });
      return;
    }
    void openMission(d.mission, null, {
      needTwo: t('route.needTwo'),
      gridUnavailable: t('route.gridUnavailable'),
    }).then(({ error, versionChanged }) =>
      setNotice(
        error
          ? { kind: 'error', text: error }
          : {
              kind: 'info',
              text: `${t('missions.sharedOpened', { name: d.mission.name })}${versionChanged ? ` ${t('missions.versionChanged')}` : ''}`,
            },
      ),
    );
  }, [sceneReady, setNotice, t]);
}

/** Saved missions in this browser, shown at the top of the Plan panel. */
export function SavedMissions() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const version = useApp((s) => s.missionsVersion);
  const bump = useApp((s) => s.bumpMissions);
  const setNotice = useApp((s) => s.setNotice);
  const [list, setList] = useState<Mission[]>([]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  useEffect(() => setList(listMissions()), [version]);

  if (list.length === 0) return null;
  return (
    <details className="saved-missions">
      <summary>{t('missions.saved', { count: list.length })}</summary>
      <ul>
        {list.map((m) => (
          <li key={m.id}>
            {renaming === m.id ? (
              <form
                className="field-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (renameMission(m.id, draft)) bump();
                  setRenaming(null);
                }}
              >
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  maxLength={80}
                  aria-label={t('missions.name')}
                  autoFocus
                />
                <button type="submit" className="btn btn-sm">
                  {t('missions.renameSave')}
                </button>
              </form>
            ) : (
              <>
                <div className="saved-main">
                  <strong>{m.name}</strong>
                  <span className="meta">
                    {m.route
                      ? `${formatDistance(m.route.metrics.horizontalDistanceM, locale)} · ${formatDuration(m.route.metrics.estimatedDurationS)} · `
                      : ''}
                    {new Date(m.updatedAt).toLocaleDateString(locale)} · v{m.version}
                  </span>
                </div>
                <div className="saved-actions">
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() =>
                      void openMission(m, m.id, {
                        needTwo: t('route.needTwo'),
                        gridUnavailable: t('route.gridUnavailable'),
                      }).then(({ error, versionChanged }) => {
                        if (error) setNotice({ kind: 'error', text: error });
                        else if (versionChanged)
                          setNotice({ kind: 'info', text: t('missions.versionChanged') });
                      })
                    }
                  >
                    {t('missions.open')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setDraft(m.name);
                      setRenaming(m.id);
                    }}
                  >
                    {t('missions.rename')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      if (
                        window.confirm(t('missions.confirmDelete', { name: m.name })) &&
                        deleteMission(m.id)
                      )
                        bump();
                    }}
                  >
                    {t('missions.delete')}
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      <p className="meta">{t('missions.localOnly')}</p>
    </details>
  );
}

/** Save · Share · Export for the current result. */
export function MissionActions({
  route,
  timeline,
  names,
}: {
  route: RouteResult;
  timeline: EvaTimeline | null;
  names: (w: WaypointEntry, i: number) => string;
}) {
  const { t } = useTranslation();
  const active = useApp((s) => s.activeMission);
  const setActive = useApp((s) => s.setActiveMission);
  const bump = useApp((s) => s.bumpMissions);
  const setNotice = useApp((s) => s.setNotice);
  const waypoints = useApp((s) => s.waypoints);
  const [name, setName] = useState(active?.name ?? '');
  const [printing, setPrinting] = useState(false);

  useEffect(() => setName(active?.name ?? ''), [active]);

  const returnToStart = useApp((st) => st.returnToStart);
  // "Landing → Three Forks → Hawksbill Gap ↺": every stop after the start, marked when it loops back.
  const defaultName = () => {
    const stops = waypoints.slice(1).map((w, i) => names(w, i + 1).split(' — ')[0]);
    const text =
      [names(waypoints[0]!, 0).split(' — ')[0], ...stops].join(' → ') + (returnToStart ? ' ↺' : '');
    return text.length > 80 ? `${text.slice(0, 77)}…` : text;
  };
  const input = (n: string) =>
    toMissionInput(n.trim() || defaultName(), missionState(), currentVersions(route), route);

  const save = () => {
    const m = input(name);
    const saved = active?.id ? updateMission(active.id, m) : saveMission(m);
    if (!saved) {
      setNotice({ kind: 'error', text: t('missions.storageUnavailable') });
      return;
    }
    setActive({ id: saved.id, name: saved.name });
    bump();
    setNotice({
      kind: 'info',
      text: t('missions.savedNotice', { name: saved.name, version: saved.version }),
    });
  };

  const share = async () => {
    const url = `${window.location.origin}${window.location.pathname}${encodeShare(input(name))}`;
    try {
      await navigator.clipboard.writeText(url);
      setNotice({ kind: 'info', text: t('missions.linkCopied') });
    } catch {
      window.prompt(t('missions.copyPrompt'), url);
    }
  };

  const exportInput = () => ({
    name: name.trim() || defaultName(),
    waypoints,
    route,
    timeline,
    versions: currentVersions(route),
    names,
  });

  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(false);
    window.addEventListener('afterprint', done);
    const id = window.setTimeout(() => window.print(), 300); // let the briefing and its map snapshot render
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('afterprint', done);
    };
  }, [printing]);

  return (
    <section
      className="mission-actions"
      aria-label={t('missions.actions')}
      data-tour="mission-actions"
    >
      <label className="field">
        {t('missions.name')}
        <input
          value={name}
          placeholder={defaultName()}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <div className="btn-row">
        <button type="button" className="btn btn-primary btn-sm" onClick={save}>
          {active?.id ? t('missions.update') : t('missions.save')}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => void share()}>
          {t('missions.share')}
        </button>
        <details className="menu">
          <summary className="btn btn-sm">{t('missions.export')}</summary>
          <div className="menu-items" role="menu">
            <button
              type="button"
              role="menuitem"
              onClick={() =>
                download(
                  `${fileSlug(exportInput().name)}.geojson`,
                  'application/geo+json',
                  toGeoJson(exportInput()),
                )
              }
            >
              GeoJSON
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() =>
                download(
                  `${fileSlug(exportInput().name)}-itinerary.csv`,
                  'text/csv',
                  toCsv(exportInput()),
                )
              }
            >
              {t('missions.csv')}
            </button>
            <button type="button" role="menuitem" onClick={() => setPrinting(true)}>
              {t('missions.briefing')}
            </button>
          </div>
        </details>
      </div>
      {printing &&
        createPortal(
          <Briefing name={exportInput().name} route={route} timeline={timeline} names={names} />,
          document.body,
        )}
    </section>
  );
}
