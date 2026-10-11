/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { createHash, webcrypto } from 'node:crypto';
import { consumeBookingDraft, saveBookingDraftForLogin, bookingDraftMetadataKey } from '../booking-draft-storage';
import { bookingDraftKey } from '../client-storage';
import { CLIENT_CLEANUP_GENERATION_KEY, hasClientCleanupNeeded } from '../client-cleanup-marker';
jest.mock('../client-cleanup-marker', () => ({ ...jest.requireActual('../client-cleanup-marker'), hasClientCleanupNeeded: jest.fn(() => false) }));
const pending = hasClientCleanupNeeded as jest.Mock;
const originalSession = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
const originalLocal = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const epoch1 = 'bda00000-0000-4000-8000-000000000001', epoch2 = 'bda00000-0000-4000-8000-000000000002';
const facility = 'synthetic-facility', key = bookingDraftKey(facility), metaKey = bookingDraftMetadataKey(facility);
const raw = JSON.stringify({ savedAt: 123, menuIds: ['synthetic-menu'], customerName: 'Synthetic name', email: 'synthetic@example.invalid' });
let session: Map<string, string>, local: Map<string, string>, fault: string;
let afterSet: (() => void) | null;
const checksum = (value: string) => createHash('sha256').update(value).digest('hex');
const tag = (generation: string | null, value = raw) => JSON.stringify({ version: 1, generation, sha256: checksum(value) });
beforeEach(() => {
  pending.mockReset(); pending.mockReturnValue(false); session = new Map(); local = new Map(); fault = ''; afterSet = null;
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem(k: string) { if (fault === 'epochRead') throw new Error('private'); return local.get(k) ?? null; },
  } });
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    getItem(k: string) { if (fault === 'read') throw new Error('private'); return session.get(k) ?? null; },
    setItem(k: string, value: string) {
      if (fault === `write:${k}`) throw new Error('private');
      if (fault !== `drop:${k}`) session.set(k, value);
      afterSet?.();
    },
    removeItem(k: string) { if (fault === 'remove') throw new Error('private'); if (fault !== 'dropRemove') session.delete(k); },
  } });
});
afterEach(() => {
  jest.restoreAllMocks();
  for (const [name, descriptor] of [['sessionStorage', originalSession], ['localStorage', originalLocal], ['crypto', originalCrypto]] as const) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
  }
});
test('empty or another-facility storage does not restore anything or require an epoch read', async () => {
  session.set(bookingDraftKey('other-facility'), raw); fault = 'epochRead'; expect(await consumeBookingDraft(facility)).toBeNull();
});
test('legacy input is consumed once only before any cleanup generation has been recorded', async () => {
  session.set(key, raw); expect(await consumeBookingDraft(facility)).toBe(raw); expect(session.has(key)).toBe(false);
  expect(await consumeBookingDraft(facility)).toBeNull();
});
test.each([null, epoch1])('new current-generation guest input preserves the exact historical value and restores normally (%s)', async epoch => {
  if (epoch !== null) local.set(CLIENT_CLEANUP_GENERATION_KEY, epoch);
  await saveBookingDraftForLogin(facility, raw); expect(session.get(key)).toBe(raw);
  expect(JSON.parse(session.get(metaKey)!)).toEqual({ version: 1, generation: epoch, sha256: checksum(raw) });
  expect(session.get(metaKey)).not.toMatch(/Synthetic name|synthetic@example/);
  expect(await consumeBookingDraft(facility)).toBe(raw); expect(session.has(key)).toBe(false); expect(session.has(metaKey)).toBe(false);
});
test.each([null, epoch1])('after cookie consumption a sleeping tab untagged/prior-generation input is denied and removed (%s)', async previous => {
  local.set(CLIENT_CLEANUP_GENERATION_KEY, epoch2); session.set(key, raw);
  if (previous !== null) session.set(metaKey, tag(previous));
  await expect(consumeBookingDraft(facility)).rejects.toMatchObject({ code: 'obsolete' }); expect(session.size).toBe(0);
});
test('an old writer cannot reuse current-generation metadata while replacing its bound payload', async () => {
  local.set(CLIENT_CLEANUP_GENERATION_KEY, epoch2); session.set(key, raw+' '); session.set(metaKey, tag(epoch2));
  await expect(consumeBookingDraft(facility)).rejects.toMatchObject({ code: 'obsolete' }); expect(session.size).toBe(0);
});
test.each(['epochRead', 'read'])('unknown %s refuses restoration instead of interpreting it as no cleanup', async kind => {
  session.set(key, raw); fault = kind;
  await expect(consumeBookingDraft(facility)).rejects.toMatchObject({ code: 'storage' });
});
test('a corrupt shared generation refuses both new saves and old restores', async () => {
  local.set(CLIENT_CLEANUP_GENERATION_KEY, 'bad'); session.set(key, raw);
  await expect(saveBookingDraftForLogin(facility, raw)).rejects.toMatchObject({ code: 'storage' });
  await expect(consumeBookingDraft(facility)).rejects.toMatchObject({ code: 'storage' }); expect(session.size).toBe(0);
});
test('an active logout/retirement fence blocks persistence and removes reachable input without restoration', async () => {
  pending.mockReturnValue(true); session.set(key, raw);
  await expect(saveBookingDraftForLogin(facility, raw)).rejects.toMatchObject({ code: 'cleanup' });
  await expect(consumeBookingDraft(facility)).rejects.toMatchObject({ code: 'cleanup' }); expect(session.size).toBe(0);
});
test.each(['not-json', 'null', '{}', JSON.stringify({ version: 2, generation: null, sha256: checksum(raw) }),
  JSON.stringify({ version: 1, generation: 2, sha256: checksum(raw) }),
  JSON.stringify({ version: 1, generation: null, sha256: 2 }), JSON.stringify({ version: 1, generation: null, sha256: 'bad' }),
  JSON.stringify({ version: 1, generation: null, sha256: checksum(raw), user: 'untrusted' })])('malformed metadata is never treated as a legacy-compatible value (%s)', async meta => {
  session.set(key, raw); session.set(metaKey, meta); await expect(consumeBookingDraft(facility)).rejects.toMatchObject({ code: 'obsolete' }); expect(session.size).toBe(0);
});
test.each([key, metaKey])('partial/drop persistence (%s) leaves no verified-looking input', async target => {
  fault = `drop:${target}`; await expect(saveBookingDraftForLogin(facility, raw)).rejects.toMatchObject({ code: 'conflict' }); expect(session.size).toBe(0);
});
test.each([key, metaKey])('storage write failure (%s) retains no partial new draft', async target => {
  fault = `write:${target}`; await expect(saveBookingDraftForLogin(facility, raw)).rejects.toMatchObject({ code: 'storage' }); expect(session.size).toBe(0);
});
test('unreadable post-write verification and cleanup never become a successful save', async () => {
  afterSet = () => { fault = 'read'; };
  await expect(saveBookingDraftForLogin(facility, raw)).rejects.toMatchObject({ code: 'storage' });
});
test('a marker or generation change while hashing prevents any new input write', async () => {
  const original = crypto.subtle.digest.bind(crypto.subtle);
  jest.spyOn(crypto.subtle, 'digest').mockImplementation(async (...args) => { local.set(CLIENT_CLEANUP_GENERATION_KEY, epoch1); return original(...args); });
  await expect(saveBookingDraftForLogin(facility, raw)).rejects.toMatchObject({ code: 'conflict' }); expect(session.size).toBe(0);
});
test('an unavailable checksum engine cannot save or restore tagged input', async () => {
  session.set(key, raw); session.set(metaKey, tag(null)); jest.spyOn(crypto.subtle, 'digest').mockRejectedValue(new Error('private'));
  await expect(saveBookingDraftForLogin(facility, raw)).rejects.toMatchObject({ code: 'storage' });
  await expect(consumeBookingDraft(facility)).rejects.toMatchObject({ code: 'storage' }); expect(session.size).toBe(0);
});
test('a generation change after writes fails closed and removes its own partial backup', async () => {
  afterSet = () => { local.set(CLIENT_CLEANUP_GENERATION_KEY, epoch1); };
  await expect(saveBookingDraftForLogin(facility, raw)).rejects.toMatchObject({ code: 'conflict' }); expect(session.size).toBe(0);
});
test('a logout completed while a tagged restore is hashing invalidates that old input', async () => {
  local.set(CLIENT_CLEANUP_GENERATION_KEY, epoch1); session.set(key, raw); session.set(metaKey, tag(epoch1));
  const original = crypto.subtle.digest.bind(crypto.subtle);
  jest.spyOn(crypto.subtle, 'digest').mockImplementation(async (...args) => { local.set(CLIENT_CLEANUP_GENERATION_KEY, epoch2); return original(...args); });
  await expect(consumeBookingDraft(facility)).rejects.toMatchObject({ code: 'obsolete' }); expect(session.size).toBe(0);
});
test('a newly replaced snapshot while hashing is preserved rather than deleting another save', async () => {
  session.set(key, raw); session.set(metaKey, tag(null)); const replacement = raw+' ';
  const original = crypto.subtle.digest.bind(crypto.subtle);
  jest.spyOn(crypto.subtle, 'digest').mockImplementation(async (...args) => { session.set(key, replacement); session.set(metaKey, tag(null, replacement)); return original(...args); });
  await expect(consumeBookingDraft(facility)).rejects.toMatchObject({ code: 'conflict' }); expect(session.get(key)).toBe(replacement);
});
test.each(['remove', 'dropRemove'])('unverified consumed-input deletion (%s) never restores personal data', async kind => {
  session.set(key, raw); fault = kind; await expect(consumeBookingDraft(facility)).rejects.toMatchObject({ code: 'storage' });
});
