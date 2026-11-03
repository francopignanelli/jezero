/**
 * The photo gallery: pictures taken in photo mode, kept in the browser (IndexedDB, as JPEG
 * blobs), newest first, at most MAX_PHOTOS. Without IndexedDB (e.g. some private windows) the
 * photo can still be downloaded, but it is not kept.
 */

export interface Photo {
  id: string;
  createdMs: number;
  missionId: string | null;
  filter: string;
  blob: Blob;
}

const DB = 'copernico-game';
const STORE = 'photos';
export const MAX_PHOTOS = 30;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no IndexedDB'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        t.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        t.onerror = () => {
          db.close();
          reject(t.error ?? new Error('IndexedDB transaction failed'));
        };
      }),
  );
}

export async function listPhotos(): Promise<Photo[]> {
  try {
    const all = await tx<Photo[]>('readonly', (s) => s.getAll() as IDBRequest<Photo[]>);
    return all.sort((a, b) => b.createdMs - a.createdMs);
  } catch {
    return [];
  }
}

/** Keeps a photo (dropping the oldest beyond MAX_PHOTOS); false if it could not be kept. */
export async function savePhoto(p: Omit<Photo, 'id'>): Promise<boolean> {
  try {
    const id = `${p.createdMs}-${Math.random().toString(36).slice(2, 8)}`;
    await tx('readwrite', (s) => s.put({ ...p, id }));
    const all = await listPhotos();
    for (const old of all.slice(MAX_PHOTOS)) await deletePhoto(old.id);
    return true;
  } catch {
    return false;
  }
}

export async function deletePhoto(id: string): Promise<void> {
  try {
    await tx('readwrite', (s) => s.delete(id));
  } catch {
    // ignore
  }
}

/** File name for a download: copernico-jezero-YYYYMMDD-HHMMSS.jpg */
export function photoFileName(createdMs: number): string {
  const d = new Date(createdMs);
  const p = (n: number) => String(n).padStart(2, '0');
  return `copernico-jezero-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.jpg`;
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}
