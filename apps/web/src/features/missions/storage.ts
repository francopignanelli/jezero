import { Mission, type MissionInput } from '@copernico/contracts';
import { z } from 'zod';

/**
 * Saved missions in this browser (no account, no server). Records follow the shared `Mission`
 * contract so they can move to the API later unchanged. Every access is guarded: private windows
 * or blocked storage simply mean nothing is saved.
 */
const KEY = 'copernico.missions.v1';
const MAX_MISSIONS = 50;
const Stored = z.array(Mission);

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** ULID: 48-bit time + 80 random bits, Crockford base32 (matches the contract's id format). */
export function ulid(now = Date.now()): string {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32]! + time;
    t = Math.floor(t / 32);
  }
  const random = crypto.getRandomValues(new Uint8Array(16));
  let rand = '';
  for (let i = 0; i < 16; i++) rand += CROCKFORD[random[i]! % 32]!;
  return time + rand;
}

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

export function listMissions(): Mission[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = Stored.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) : [];
  } catch {
    return [];
  }
}

function write(missions: Mission[]): boolean {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(missions.slice(0, MAX_MISSIONS)));
    return true;
  } catch {
    return false;
  }
}

/** Saves a new mission; returns it, or null when storage is unavailable or full. */
export function saveMission(input: MissionInput): Mission | null {
  const at = nowIso();
  const mission = Mission.parse({
    ...input,
    schemaVersion: 1,
    id: ulid(),
    version: 1,
    createdAt: at,
    updatedAt: at,
  });
  return write([mission, ...listMissions()]) ? mission : null;
}

/** Replaces a mission's content (new version). */
export function updateMission(id: string, input: MissionInput): Mission | null {
  const list = listMissions();
  const old = list.find((m) => m.id === id);
  if (!old) return null;
  const next = Mission.parse({ ...old, ...input, version: old.version + 1, updatedAt: nowIso() });
  return write(list.map((m) => (m.id === id ? next : m))) ? next : null;
}

export function renameMission(id: string, name: string): boolean {
  const list = listMissions();
  const old = list.find((m) => m.id === id);
  if (!old) return false;
  const parsed = Mission.safeParse({ ...old, name, version: old.version + 1, updatedAt: nowIso() });
  return parsed.success && write(list.map((m) => (m.id === id ? parsed.data : m)));
}

export function deleteMission(id: string): boolean {
  return write(listMissions().filter((m) => m.id !== id));
}
