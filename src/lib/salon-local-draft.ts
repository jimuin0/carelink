import { exportSalonDraftBackup, importSalonDraftBackup, SALON_DRAFT_MAX_BYTES } from './salon-draft-backup';
import { hasClientCleanupNeeded } from './client-cleanup-marker';

export const SALON_LOCAL_DRAFT_DB = 'carelink-salon-local-draft-v1';
export const SALON_LOCAL_DRAFT_STORE = 'drafts';
export const SALON_LOCAL_DRAFT_ID = 'registration-input';
export const SALON_LOCAL_DRAFT_TTL = 7 * 24 * 60 * 60 * 1000;
export const SALON_LOCAL_DRAFT_TIMEOUT = 5000;
const ERROR_MESSAGE = '端末の下書きを確認できませんでした。入力と写真はこの画面に保持されています。';
type Failure = 'unavailable' | 'storage' | 'corrupt' | 'conflict' | 'locked' | 'expired' | 'cleanup';
export class SalonLocalDraftError extends Error {
  constructor(readonly code: Failure) { super(ERROR_MESSAGE); }
}
export interface LocalSalonDraft {
  id: typeof SALON_LOCAL_DRAFT_ID;
  revision: number;
  state: 'saved' | 'locked' | 'cleared';
  updatedAt: number;
  expiresAt: number;
  backup: Blob | null;
  sha256: string | null;
}
type StoredDraft = Omit<LocalSalonDraft, 'backup'> & { backup: ArrayBuffer | null };
const exposed = (value: StoredDraft | null): LocalSalonDraft | null => value
  ? { ...value, backup: value.backup === null ? null : new Blob([value.backup], { type: 'application/json' }) } : null;

function record(raw: unknown): StoredDraft | null {
  if (raw === undefined) return null;
  if (!raw || typeof raw !== 'object') throw new SalonLocalDraftError('corrupt');
  const value = raw as StoredDraft;
  if (Object.keys(value).sort().join(',') !== 'backup,expiresAt,id,revision,sha256,state,updatedAt'
    || value.id !== SALON_LOCAL_DRAFT_ID || !Number.isSafeInteger(value.revision) || value.revision < 1
    || !['saved', 'locked', 'cleared'].includes(value.state)
    || !Number.isSafeInteger(value.updatedAt) || value.updatedAt < 0
    || !Number.isSafeInteger(value.expiresAt) || value.expiresAt < 0
    || (value.backup !== null && (!(value.backup instanceof ArrayBuffer) || value.backup.byteLength === 0 || value.backup.byteLength > SALON_DRAFT_MAX_BYTES))
    || (value.sha256 !== null && !/^[a-f0-9]{64}$/.test(value.sha256))
    || (value.backup === null) !== (value.sha256 === null)
    || (value.state === 'saved' && value.backup === null)
    || (value.state === 'cleared' && value.backup !== null)) throw new SalonLocalDraftError('corrupt');
  return value;
}

async function open(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') throw new SalonLocalDraftError('unavailable');
  return new Promise((resolve, reject) => {
    let settled = false;
    let request: IDBOpenDBRequest;
    const timeout = setTimeout(() => fail(), SALON_LOCAL_DRAFT_TIMEOUT);
    const fail = () => { clearTimeout(timeout); settled = true; reject(new SalonLocalDraftError('storage')); };
    try { request = indexedDB.open(SALON_LOCAL_DRAFT_DB, 1); } catch { fail(); return; }
    request.onupgradeneeded = () => {
      try {
        if (!request.result.objectStoreNames.contains(SALON_LOCAL_DRAFT_STORE)) {
          request.result.createObjectStore(SALON_LOCAL_DRAFT_STORE, { keyPath: 'id' });
        }
      } catch { request.transaction?.abort(); fail(); }
    };
    request.onerror = fail;
    request.onblocked = fail;
    request.onsuccess = () => {
      if (settled) { request.result.close(); return; }
      clearTimeout(timeout); settled = true;
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

// No asynchronous hashing/serialization inside a transaction: browsers may
// commit an idle transaction before an awaited promise resumes.
async function mutate(action: (current: StoredDraft | null) => StoredDraft | null): Promise<StoredDraft | null> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      let result: StoredDraft | null = null;
      let failure: unknown;
      let tx: IDBTransaction;
      try { tx = db.transaction(SALON_LOCAL_DRAFT_STORE, 'readwrite'); }
      catch { reject(new SalonLocalDraftError('storage')); return; }
      const timeout = setTimeout(() => {
        failure = new SalonLocalDraftError('storage');
        try { tx.abort(); } catch { /* A terminated browser transaction cannot be aborted twice. */ }
        reject(failure);
      }, SALON_LOCAL_DRAFT_TIMEOUT);
      tx.oncomplete = () => { clearTimeout(timeout); resolve(result); };
      tx.onerror = tx.onabort = () => { clearTimeout(timeout); reject(failure instanceof SalonLocalDraftError ? failure : new SalonLocalDraftError('storage')); };
      try {
        const store = tx.objectStore(SALON_LOCAL_DRAFT_STORE);
        const request = store.get(SALON_LOCAL_DRAFT_ID);
        request.onsuccess = () => {
          try {
            const current = record(request.result);
            result = action(current);
            if (result !== current && result !== null) store.put(record(result));
          } catch (error) { failure = error; tx.abort(); }
        };
      } catch { clearTimeout(timeout); reject(new SalonLocalDraftError('storage')); }
    });
  } finally { db.close(); }
}

function match(current: Pick<LocalSalonDraft, 'revision'> | null, expected: number | null) {
  if ((current?.revision ?? null) !== expected) throw new SalonLocalDraftError('conflict');
}
function withoutPayload(current: StoredDraft, state: LocalSalonDraft['state']): StoredDraft {
  return { ...current, revision: current.revision + 1, state, backup: null, sha256: null, updatedAt: Date.now() };
}
async function hash(blob: Blob): Promise<string> {
  const bytes = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
async function verify(value: LocalSalonDraft) {
  try {
    if (value.backup === null || await hash(value.backup) !== value.sha256) throw new Error();
    await importSalonDraftBackup(value.backup);
  } catch { throw new SalonLocalDraftError('corrupt'); }
}

function permitDraftAccess() {
  if (hasClientCleanupNeeded()) throw new SalonLocalDraftError('cleanup');
}
async function readLocalDraftForCleanup(): Promise<LocalSalonDraft | null> {
  return exposed(await mutate(current => current));
}

/** Expired personal data is removed on the next access. A revision-only
 * tombstone remains, so stale tabs cannot recreate it by an ABA race. */
export async function readLocalSalonDraft(): Promise<LocalSalonDraft | null> {
  permitDraftAccess();
  const value = exposed(await mutate(current => {
    permitDraftAccess();
    return current?.backup && current.expiresAt <= Date.now()
      ? withoutPayload(current, current.state === 'locked' ? 'locked' : 'cleared') : current;
  }));
  permitDraftAccess();
  return value;
}

/** The backup serializer strictly whitelists input and original photos; it
 * rejects consent, receipt, capability, proof, and token fields. */
async function persist(values: unknown, photos: readonly (File | null)[], expectedRevision: number | null, state: 'saved' | 'locked'): Promise<LocalSalonDraft> {
  permitDraftAccess();
  let backup: Blob;
  let bytes: ArrayBuffer;
  let sha256: string;
  try { backup = await exportSalonDraftBackup(values, photos); bytes = await backup.arrayBuffer(); sha256 = await hash(backup); }
  catch { throw new SalonLocalDraftError('corrupt'); }
  const now = Date.now();
  const saved = await mutate(current => {
    permitDraftAccess();
    match(current, expectedRevision);
    if (state === 'saved' && current?.state === 'locked') throw new SalonLocalDraftError('locked');
    if (state === 'locked' && (current?.state !== 'locked' || !current.backup)) throw new SalonLocalDraftError('conflict');
    return { id: SALON_LOCAL_DRAFT_ID, revision: (expectedRevision ?? 0) + 1, state, updatedAt: now,
      // ArrayBuffer avoids browsers that reject IndexedDB Blob persistence;
      // it retains every original photo byte in the verified input envelope.
      expiresAt: now + SALON_LOCAL_DRAFT_TTL, backup: bytes, sha256 };
  });
  const checked = await readLocalSalonDraft();
  if (!saved || !checked || checked.revision !== saved.revision || checked.state !== state
    || checked.sha256 !== sha256) throw new SalonLocalDraftError('conflict');
  await verify(checked);
  permitDraftAccess();
  return checked;
}

export async function saveLocalSalonDraft(values: unknown, photos: readonly (File | null)[], expectedRevision: number | null): Promise<LocalSalonDraft> {
  return persist(values, photos, expectedRevision, 'saved');
}

/** Called by the owning component only after its transport explicitly proves
 * /commit was never attempted. Correcting an upload must never make the
 * submission fence restorable or replace another tab's revision. */
export async function replaceLockedLocalSalonDraft(values: unknown, photos: readonly (File | null)[], expectedRevision: number): Promise<LocalSalonDraft> {
  return persist(values, photos, expectedRevision, 'locked');
}

/** The fence commits before transport. No save or restore can turn a locked
 * record back into an unsent input, even after sessionStorage disappears. */
export async function lockLocalSalonDraft(expectedRevision: number): Promise<LocalSalonDraft> {
  permitDraftAccess();
  const saved = await mutate(current => {
    permitDraftAccess();
    match(current, expectedRevision);
    if (!current?.backup || current.expiresAt <= Date.now()) throw new SalonLocalDraftError('expired');
    if (current.state === 'locked') return current;
    return { ...current, revision: current.revision + 1, state: 'locked', updatedAt: Date.now() };
  });
  const checked = await readLocalSalonDraft();
  if (!saved || !checked || checked.revision !== saved.revision || checked.state !== 'locked'
    || checked.sha256 !== saved.sha256) throw new SalonLocalDraftError('conflict');
  await verify(checked);
  permitDraftAccess();
  return checked;
}

export async function restoreLocalSalonDraft(expectedRevision: number): Promise<Blob> {
  const current = await readLocalSalonDraft();
  match(current, expectedRevision);
  if (current?.state === 'locked') throw new SalonLocalDraftError('locked');
  if (!current?.backup) throw new SalonLocalDraftError('expired');
  await verify(current);
  const checked = await readLocalSalonDraft();
  match(checked, expectedRevision);
  if (checked?.state !== 'saved') throw new SalonLocalDraftError('locked');
  return current.backup;
}

/** Delete personal content, preserving the submission fence and revision. */
export async function clearLocalSalonDraft(expectedRevision: number): Promise<LocalSalonDraft> {
  const cleared = await mutate(current => {
    match(current, expectedRevision);
    // A matched numeric revision entails a record; null matches only null.
    return withoutPayload(current!, current!.state === 'locked' ? 'locked' : 'cleared');
  });
  const checked = await readLocalDraftForCleanup();
  if (!cleared || !checked || checked.revision !== cleared.revision || checked.backup !== null
    || checked.state !== cleared.state) throw new SalonLocalDraftError('conflict');
  return checked;
}

/** Explicit logout removes personal content and fences every older tab. No
 * opt-in or authority is retained. Reuse requires a fresh explicit opt-in. */
export async function clearAllLocalSalonDrafts(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  if (typeof indexedDB.databases === 'function') {
    let timeout: ReturnType<typeof setTimeout>;
    try {
      const databases = await Promise.race([indexedDB.databases(), new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new SalonLocalDraftError('storage')), SALON_LOCAL_DRAFT_TIMEOUT);
      })]);
      if (!databases.some(db => db.name === SALON_LOCAL_DRAFT_DB)) return;
    } catch { throw new SalonLocalDraftError('storage'); }
    finally { clearTimeout(timeout!); }
  }
  const cleared = await mutate(current => current ? withoutPayload(current, 'cleared') : null);
  const checked = await readLocalDraftForCleanup();
  if ((cleared?.revision ?? null) !== (checked?.revision ?? null) || checked?.backup) throw new SalonLocalDraftError('conflict');
}
