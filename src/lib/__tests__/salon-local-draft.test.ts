/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { webcrypto } from 'node:crypto';
import { clearAllLocalSalonDrafts, clearLocalSalonDraft, lockLocalSalonDraft, readLocalSalonDraft,
  replaceLockedLocalSalonDraft, restoreLocalSalonDraft, saveLocalSalonDraft, SALON_LOCAL_DRAFT_TTL, SALON_LOCAL_DRAFT_TIMEOUT } from '../salon-local-draft';
import { importSalonDraftBackup } from '../salon-draft-backup';
import * as cleanupMarker from '../client-cleanup-marker';
jest.mock('../client-cleanup-marker', () => ({ ...jest.requireActual('../client-cleanup-marker'), hasClientCleanupNeeded: jest.fn(() => false) }));
const pendingCleanup = cleanupMarker.hasClientCleanupNeeded as jest.Mock;

// Deterministic request/commit failures are tested here. The separate browser
// suite uses actual IndexedDB, including structured Blob clones and two tabs.
class MemoryIDB {
  row: unknown;
  fault = '';
  closes = 0;
  hasStore = true;
  upgrade = false;
  lastDB: Record<string, any> | null = null;
  reads = 0;
  beforeGet: ((count: number) => void) | null = null;
  private transactions: (() => void)[] = [];
  private running = false;
  private start() {
    if (this.running || !this.transactions.length) return;
    this.running = true;
    queueMicrotask(this.transactions[0]);
  }
  open = () => {
    if (this.fault === 'openThrow') throw new Error('private');
    const request: Record<string, any> = {};
    const db = { close: () => this.closes++, objectStoreNames: { contains: () => this.hasStore },
      createObjectStore: () => { if (this.fault === 'upgrade') throw new Error('private'); this.hasStore = true; },
      transaction: () => {
        if (this.fault === 'transaction') throw new Error('private');
        let aborted = false, pending: unknown = undefined;
        const tx: Record<string, any> = {};
        const done = () => {
          if (!aborted && this.fault === 'write' && pending !== undefined) aborted = true;
          if (!aborted && pending !== undefined) this.row = pending;
          if (aborted) tx.onabort?.(); else tx.oncomplete?.();
          this.transactions.shift(); this.running = false; this.start();
        };
        tx.abort = () => { if (this.fault === 'hangAbort') throw new Error('private'); aborted = true; };
        tx.objectStore = () => {
          if (this.fault === 'storeThrow') throw new Error('private');
          return {
          get: () => {
            if (this.fault === 'getThrow') throw new Error('private');
            const read: Record<string, any> = {};
            this.transactions.push(() => {
              this.beforeGet?.(++this.reads);
              if (this.fault === 'read') { aborted = true; }
              else { read.result = this.row && typeof this.row === 'object' ? { ...this.row } : this.row; read.onsuccess?.(); }
              if (!['hangTransaction', 'hangAbort'].includes(this.fault)) queueMicrotask(done);
            }); this.start(); return read;
          },
          put: (value: unknown) => { if (this.fault === 'putThrow') throw new Error('private'); pending = value; },
        }; }; return tx;
      },
    };
    this.lastDB = db;
    queueMicrotask(() => {
      if (this.fault === 'hangOpen') return;
      if (this.fault === 'openError') request.onerror?.();
      else { request.result = db; request.transaction = { abort: () => undefined };
        if (this.upgrade) request.onupgradeneeded?.();
        if (this.fault === 'blocked') request.onblocked?.(); request.onsuccess?.(); }
    }); return request;
  };
}
let db: MemoryIDB;
const originalIDB = global.indexedDB, originalCrypto = global.crypto;
beforeEach(() => {
  pendingCleanup.mockReset(); pendingCleanup.mockReturnValue(false);
  db = new MemoryIDB();
  Object.defineProperty(global, 'indexedDB', { configurable: true, value: db });
  Object.defineProperty(global, 'crypto', { configurable: true, value: webcrypto });
});
afterEach(() => { jest.restoreAllMocks(); Object.defineProperty(global, 'indexedDB', { configurable: true, value: originalIDB });
  Object.defineProperty(global, 'crypto', { configurable: true, value: originalCrypto }); jest.useRealTimers(); });
const photo = () => new File([new Uint8Array([0, 255, 6])], '原写真.png', { type: 'image/png', lastModified: 42 });
const save = (revision: number | null = null) => saveLocalSalonDraft({ facility_name: '入力途中', email: '途中@' }, [photo()], revision);

test('a legacy retirement/logout marker refuses all public input access, while verified cleanup remains possible', async () => {
  const saved = await save(); const pending = pendingCleanup.mockReturnValue(true);
  await expect(readLocalSalonDraft()).rejects.toMatchObject({ code: 'cleanup' });
  await expect(save(saved.revision)).rejects.toMatchObject({ code: 'cleanup' });
  await expect(restoreLocalSalonDraft(saved.revision)).rejects.toMatchObject({ code: 'cleanup' });
  await expect(lockLocalSalonDraft(saved.revision)).rejects.toMatchObject({ code: 'cleanup' });
  await expect(replaceLockedLocalSalonDraft({}, [], saved.revision)).rejects.toMatchObject({ code: 'cleanup' });
  await clearAllLocalSalonDrafts();
  expect(db.row).toMatchObject({ state: 'cleared', backup: null });
  pending.mockReturnValue(false); expect((await readLocalSalonDraft())?.backup).toBeNull();
  await expect(save(saved.revision)).rejects.toMatchObject({ code: 'conflict' });
});
test('a marker arriving during the IndexedDB transaction aborts an old tab save before payload changes', async () => {
  const saved = await save(); const original = db.row; const pending = pendingCleanup.mockReturnValue(false);
  db.beforeGet = () => { pending.mockReturnValue(true); };
  await expect(save(saved.revision)).rejects.toMatchObject({ code: 'cleanup' }); expect(db.row).toEqual(original);
});
test('a marker arriving while a read is committing prevents exposing personal input', async () => {
  await save(); const pending = pendingCleanup.mockReturnValue(false);
  let calls = 0; pending.mockImplementation(() => ++calls >= 3);
  await expect(readLocalSalonDraft()).rejects.toMatchObject({ code: 'cleanup' });
});

test('no opt-in API call means no data; explicit save verifies the original bytes and seven-day expiry', async () => {
  expect(await readLocalSalonDraft()).toBeNull();
  const before = Date.now(); const saved = await save();
  expect(saved.state).toBe('saved'); expect(saved.revision).toBe(1);
  expect(saved.expiresAt - saved.updatedAt).toBe(SALON_LOCAL_DRAFT_TTL);
  expect(saved.updatedAt).toBeGreaterThanOrEqual(before);
  const restored = await importSalonDraftBackup(await restoreLocalSalonDraft(1));
  expect(restored.values).toEqual({ facility_name: '入力途中', email: '途中@' });
  expect([...new Uint8Array(await restored.photos[0]!.arrayBuffer())]).toEqual([0, 255, 6]);
  expect(restored.photos[0]!.name).toBe('原写真.png');
  expect(Object.keys(saved).sort()).toEqual(['backup', 'expiresAt', 'id', 'revision', 'sha256', 'state', 'updatedAt']);
  expect(await saved.backup!.text()).not.toMatch(/proof|token|agreed|receipt|intent/);
});
test.each(['proof', 'token', 'agreed', 'intentId', 'receiptId', 'recaptcha_token'])('authority field %s never reaches IndexedDB', async key => {
  await expect(saveLocalSalonDraft({ [key]: 'secret' }, [], null)).rejects.toMatchObject({ code: 'corrupt' });
  expect(db.row).toBeUndefined();
});
test('two writers with the same revision cannot overwrite each other', async () => {
  const original = await save();
  const results = await Promise.allSettled([save(original.revision), save(original.revision)]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
  expect((await readLocalSalonDraft())?.revision).toBe(2);
});
test('the pretransport lock survives missing session context, replay and old-tab saves', async () => {
  const saved = await save(); const locked = await lockLocalSalonDraft(saved.revision);
  expect(locked.state).toBe('locked'); expect(locked.revision).toBe(2);
  expect(await lockLocalSalonDraft(locked.revision)).toEqual(locked);
  await expect(restoreLocalSalonDraft(locked.revision)).rejects.toMatchObject({ code: 'locked' });
  await expect(save(saved.revision)).rejects.toMatchObject({ code: 'conflict' });
  await expect(save(locked.revision)).rejects.toMatchObject({ code: 'locked' });
});
test('clearing a confirmed/locked draft deletes only personal content and preserves the fence', async () => {
  const locked = await lockLocalSalonDraft((await save()).revision);
  const cleared = await clearLocalSalonDraft(locked.revision);
  expect(cleared).toMatchObject({ state: 'locked', backup: null, sha256: null, revision: 3 });
  await expect(restoreLocalSalonDraft(cleared.revision)).rejects.toMatchObject({ code: 'locked' });
  await expect(save(null)).rejects.toMatchObject({ code: 'conflict' });
  await expect(save(cleared.revision)).rejects.toMatchObject({ code: 'locked' });
});
test('clear failure leaves the locked record, with no restorable fallback', async () => {
  const locked = await lockLocalSalonDraft((await save()).revision);
  db.fault = 'write'; await expect(clearLocalSalonDraft(locked.revision)).rejects.toMatchObject({ code: 'storage' });
  db.fault = ''; expect(await readLocalSalonDraft()).toEqual(locked);
  await expect(restoreLocalSalonDraft(locked.revision)).rejects.toMatchObject({ code: 'locked' });
});
test.each(['saved', 'locked'] as const)('expired %s personal content is removed on access while stale revisions stay fenced', async state => {
  let value = await save(); if (state === 'locked') value = await lockLocalSalonDraft(value.revision);
  jest.spyOn(Date, 'now').mockReturnValue(value.expiresAt);
  const cleared = await readLocalSalonDraft();
  expect(cleared).toMatchObject({ backup: null, sha256: null, revision: value.revision + 1, state: state === 'locked' ? 'locked' : 'cleared' });
  await expect(restoreLocalSalonDraft(cleared!.revision)).rejects.toMatchObject({ code: state === 'locked' ? 'locked' : 'expired' });
  await expect(save(value.revision)).rejects.toMatchObject({ code: 'conflict' });
});
test('an explicit logout clears personal content and fences older tabs before a new explicit opt-in', async () => {
  await clearAllLocalSalonDrafts(); expect(db.row).toBeUndefined();
  const locked = await lockLocalSalonDraft((await save()).revision);
  await clearAllLocalSalonDrafts();
  const cleared = await readLocalSalonDraft(); expect(cleared).toMatchObject({ state: 'cleared', backup: null });
  await expect(save(locked.revision)).rejects.toMatchObject({ code: 'conflict' });
  expect((await save(cleared!.revision)).state).toBe('saved');
});
test.each(['openThrow', 'openError', 'blocked', 'transaction', 'read', 'write', 'storeThrow', 'getThrow', 'putThrow'])('storage failure %s is never reported as a saved draft', async fault => {
  db.fault = fault; await expect(save()).rejects.toThrow('端末の下書きを確認できませんでした。');
  expect(db.row).toBeUndefined();
});
test('upgrade creates the store once; schema failure and version change close their connections', async () => {
  db.upgrade = true; db.hasStore = false; await save(); expect(db.hasStore).toBe(true);
  const closes = db.closes; db.lastDB!.onversionchange(); expect(db.closes).toBe(closes + 1);
  db = new MemoryIDB(); Object.defineProperty(global, 'indexedDB', { configurable: true, value: db });
  db.upgrade = true; db.hasStore = false; db.fault = 'upgrade';
  await expect(readLocalSalonDraft()).rejects.toMatchObject({ code: 'storage' });
});
test.each(['hangOpen', 'hangTransaction', 'hangAbort'])('hung %s terminates within the local storage deadline', async fault => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask'] }); db.fault = fault;
  const result = readLocalSalonDraft(); const check = expect(result).rejects.toMatchObject({ code: 'storage' });
  await jest.advanceTimersByTimeAsync(SALON_LOCAL_DRAFT_TIMEOUT); await check;
});
test('logout skips unavailable or provably absent databases, and visibly rejects inaccessible existing storage', async () => {
  Object.defineProperty(global, 'indexedDB', { configurable: true, value: undefined }); await clearAllLocalSalonDrafts();
  Object.defineProperty(global, 'indexedDB', { configurable: true, value: { databases: async () => [] } }); await clearAllLocalSalonDrafts();
  Object.defineProperty(global, 'indexedDB', { configurable: true, value: { databases: async () => { throw new Error('private'); } } });
  await expect(clearAllLocalSalonDrafts()).rejects.toMatchObject({ code: 'storage' });
  Object.defineProperty(global, 'indexedDB', { configurable: true, value: db });
  await save(); (db as any).databases = async () => [{ name: 'carelink-salon-local-draft-v1' }]; await clearAllLocalSalonDrafts();
  expect((await readLocalSalonDraft())?.backup).toBeNull();
});
test('hung database inventory is bounded without treating an unverified wipe as successful', async () => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask'] }); (db as any).databases = () => new Promise(() => undefined);
  const result = clearAllLocalSalonDrafts(); const check = expect(result).rejects.toMatchObject({ code: 'storage' });
  await jest.advanceTimersByTimeAsync(SALON_LOCAL_DRAFT_TIMEOUT); await check;
});
test.each([null, 5, false])('nonrecord storage metadata %j is rejected safely', async row => {
  db.row = row; await expect(readLocalSalonDraft()).rejects.toMatchObject({ code: 'corrupt' });
});
test('a successful write whose readback was lost is not a saved confirmation', async () => {
  db.beforeGet = count => { if (count === 2) db.row = undefined; };
  await expect(save()).rejects.toMatchObject({ code: 'conflict' });
});
test('a lost lock readback never permits transport or restore', async () => {
  const saved = await save(); const reads = db.reads;
  db.beforeGet = count => { if (count === reads + 2) db.row = undefined; };
  await expect(lockLocalSalonDraft(saved.revision)).rejects.toMatchObject({ code: 'conflict' });
});
test('a same-revision state corrupted during restore cannot return any input', async () => {
  const value = await save(); const reads = db.reads;
  db.beforeGet = count => { if (count === reads + 2) db.row = { ...(db.row as object), state: 'locked' }; };
  await expect(restoreLocalSalonDraft(value.revision)).rejects.toMatchObject({ code: 'locked' });
});
test('lost clearing verification and concurrent logout writes remain explicit failures', async () => {
  const value = await save(); const reads = db.reads;
  db.beforeGet = count => { if (count === reads + 2) db.row = undefined; };
  await expect(clearLocalSalonDraft(value.revision)).rejects.toMatchObject({ code: 'conflict' });
  db.beforeGet = null; const newer = await save(); const after = db.reads;
  db.beforeGet = count => { if (count === after + 2) db.row = { ...(db.row as object), revision: newer.revision + 10 }; };
  await expect(clearAllLocalSalonDrafts()).rejects.toMatchObject({ code: 'conflict' });
});
test('no IndexedDB and tampered metadata fail closed without exposing private error details', async () => {
  Object.defineProperty(global, 'indexedDB', { configurable: true, value: undefined });
  await expect(readLocalSalonDraft()).rejects.toMatchObject({ code: 'unavailable' });
  Object.defineProperty(global, 'indexedDB', { configurable: true, value: db });
  db.row = { token: 'private' }; await expect(readLocalSalonDraft()).rejects.toMatchObject({ code: 'corrupt' });
});
test('a structured-clone payload with wrong checksum cannot restore any input', async () => {
  const value = await save(); db.row = { ...value, backup: new TextEncoder().encode('private').buffer };
  await expect(restoreLocalSalonDraft(value.revision)).rejects.toMatchObject({ code: 'corrupt' });
});
test('cleared saved record retains revision and stale-tab clear cannot delete a newer input', async () => {
  const value = await save(); const newer = await save(value.revision);
  await expect(clearLocalSalonDraft(value.revision)).rejects.toMatchObject({ code: 'conflict' });
  expect((await readLocalSalonDraft())?.revision).toBe(newer.revision);
  expect(await clearLocalSalonDraft(newer.revision)).toMatchObject({ state: 'cleared', backup: null });
});
test('expired inputs cannot acquire a transport fence', async () => {
  const value = await save(); jest.spyOn(Date, 'now').mockReturnValue(value.expiresAt);
  await expect(lockLocalSalonDraft(value.revision)).rejects.toMatchObject({ code: 'expired' });
});
test('correcting an explicitly never-committed own draft preserves the fence and requires exact revision', async () => {
  const locked = await lockLocalSalonDraft((await save()).revision);
  const corrected = await replaceLockedLocalSalonDraft({ facility_name: '訂正後' }, [], locked.revision);
  expect(corrected.state).toBe('locked'); expect(corrected.revision).toBe(locked.revision + 1);
  await expect(restoreLocalSalonDraft(corrected.revision)).rejects.toMatchObject({ code: 'locked' });
  await expect(replaceLockedLocalSalonDraft({}, [], locked.revision)).rejects.toMatchObject({ code: 'conflict' });
  const cleared = await clearLocalSalonDraft(corrected.revision);
  await expect(replaceLockedLocalSalonDraft({}, [], cleared.revision)).rejects.toMatchObject({ code: 'conflict' });
});
