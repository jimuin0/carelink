import { bookingDraftKey } from './client-storage';
import { CLIENT_BOOKING_DRAFT_META_PREFIX, getClientCleanupGeneration, hasClientCleanupNeeded } from './client-cleanup-marker';

export const BOOKING_DRAFT_STORAGE_FAILED = '予約の下書きを保存・確認できませんでした。現在の入力はこの画面に保持されています。';
export const BOOKING_DRAFT_OBSOLETE = 'ログアウト・退会前の予約下書きは復元しませんでした。現在の入力から続けてください。';
export class BookingDraftStorageError extends Error {
  constructor(readonly code: 'storage' | 'obsolete' | 'cleanup' | 'conflict') {
    super(code === 'obsolete' ? BOOKING_DRAFT_OBSOLETE : BOOKING_DRAFT_STORAGE_FAILED);
  }
}
type DraftMetadata = { version: 1; generation: string | null; sha256: string };
export const bookingDraftMetadataKey = (facilityId: string) => `${CLIENT_BOOKING_DRAFT_META_PREFIX}${facilityId}`;

function generation() {
  if (hasClientCleanupNeeded()) throw new BookingDraftStorageError('cleanup');
  try { return getClientCleanupGeneration(); } catch { throw new BookingDraftStorageError('storage'); }
}
async function digest(value: string) {
  try {
    const bytes = new TextEncoder().encode(value);
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  } catch { throw new BookingDraftStorageError('storage'); }
}
function metadata(value: string | null): DraftMetadata | null {
  if (value === null) return null;
  try {
    const parsed = JSON.parse(value) as DraftMetadata;
    if (!parsed || Object.keys(parsed).sort().join(',') !== 'generation,sha256,version' || parsed.version !== 1
      || !(parsed.generation === null || typeof parsed.generation === 'string')
      || typeof parsed.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(parsed.sha256)) throw new Error();
    return parsed;
  } catch { throw new BookingDraftStorageError('obsolete'); }
}
function removeSnapshot(key: string, metaKey: string, raw: string | null, meta: string | null) {
  if (sessionStorage.getItem(key) !== raw || sessionStorage.getItem(metaKey) !== meta) throw new BookingDraftStorageError('conflict');
  sessionStorage.removeItem(key); sessionStorage.removeItem(metaKey);
  if (sessionStorage.getItem(key) !== null || sessionStorage.getItem(metaKey) !== null) throw new BookingDraftStorageError('storage');
}

/** Keep the historical booking value exactly as written. Separate tab-local
 * metadata contains only a cleanup generation and a payload checksum. */
export async function saveBookingDraftForLogin(facilityId: string, raw: string): Promise<void> {
  const key = bookingDraftKey(facilityId), metaKey = bookingDraftMetadataKey(facilityId);
  const epoch = generation();
  const meta = JSON.stringify({ version: 1, generation: epoch, sha256: await digest(raw) });
  if (generation() !== epoch) throw new BookingDraftStorageError('conflict');
  try {
    sessionStorage.setItem(key, raw); sessionStorage.setItem(metaKey, meta);
    if (sessionStorage.getItem(key) !== raw || sessionStorage.getItem(metaKey) !== meta
      || generation() !== epoch) throw new BookingDraftStorageError('conflict');
  } catch (error) {
    try {
      // A partial write must not leave input looking like a verified backup.
      if (sessionStorage.getItem(key) === raw) sessionStorage.removeItem(key);
      if (sessionStorage.getItem(metaKey) === meta) sessionStorage.removeItem(metaKey);
    } catch { /* The caller keeps its live input and reports an unverified save. */ }
    throw error instanceof BookingDraftStorageError ? error : new BookingDraftStorageError('storage');
  }
}

/** A legacy value is eligible only before this browser has a cleanup
 * generation. After cleanup, even a sleeping old tab's later legacy write is
 * rejected. Reading consumes only the exact verified snapshot. */
export async function consumeBookingDraft(facilityId: string): Promise<string | null> {
  const key = bookingDraftKey(facilityId), metaKey = bookingDraftMetadataKey(facilityId);
  let raw: string | null, meta: string | null;
  try { raw = sessionStorage.getItem(key); meta = sessionStorage.getItem(metaKey); }
  catch { throw new BookingDraftStorageError('storage'); }
  if (raw === null) return null;
  try {
    const epoch = generation(), saved = metadata(meta);
    if (saved ? saved.generation !== epoch || saved.sha256 !== await digest(raw) : epoch !== null) throw new BookingDraftStorageError('obsolete');
    if (generation() !== epoch) throw new BookingDraftStorageError('obsolete');
    removeSnapshot(key, metaKey, raw, meta);
    return raw;
  } catch (error) {
    try { removeSnapshot(key, metaKey, raw, meta); } catch { /* Refuse restoration even when deletion cannot be verified. */ }
    throw error instanceof BookingDraftStorageError ? error : new BookingDraftStorageError('storage');
  }
}
