/** Non-secret privacy fence shared by tabs. It grants no authentication,
 * identity or receipt authority and contains no personal input. */
export const CLIENT_CLEANUP_COOKIE = 'carelink_client_cleanup';
export const CLIENT_CLEANUP_COMPLETED_EVENT = 'carelink-client-cleanup-complete';
export const CLIENT_CLEANUP_GENERATION_KEY = 'carelink-client-cleanup-generation-v1';
export const CLIENT_BOOKING_DRAFT_META_PREFIX = 'carelink-booking-generation:';
const COOKIE_DAYS = 7 * 24 * 60 * 60;
const MARKER_FAILED = 'この端末の下書き削除の確認情報を更新できませんでした。';
let localCleanupNeeded = false;

/** Only a random, non-secret cleanup generation is shared. No account,
 * identity, form input, consent or authentication capability is retained. */
export function getClientCleanupGeneration(): string | null {
  try {
    const value = localStorage.getItem(CLIENT_CLEANUP_GENERATION_KEY);
    if (value !== null && !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)) throw new Error();
    return value;
  } catch { throw new Error(MARKER_FAILED); }
}

export function hasClientCleanupNeeded(): boolean {
  if (localCleanupNeeded) return true;
  if (typeof document === 'undefined') return false;
  try { return document.cookie.split(';').some(value => value.trim() === `${CLIENT_CLEANUP_COOKIE}=1`); }
  catch { return true; }
}

function write(value: string, maxAge: number) {
  if (typeof document === 'undefined') throw new Error(MARKER_FAILED);
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
  try { document.cookie = `${CLIENT_CLEANUP_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`; }
  catch { throw new Error(MARKER_FAILED); }
}

export function markClientCleanupNeeded(): void {
  localCleanupNeeded = true;
  write('1', COOKIE_DAYS);
  // Read the cookie directly: the memory fence must not turn a dropped write
  // into success. The memory fence remains if cookies are unavailable.
  let stored: boolean;
  try { stored = document.cookie.split(';').some(value => value.trim() === `${CLIENT_CLEANUP_COOKIE}=1`); }
  catch { throw new Error(MARKER_FAILED); }
  if (!stored) throw new Error(MARKER_FAILED);
}

/** Call only after both local stores have been wiped and read back. A failed
 * clear remains fenced rather than reporting an unverified privacy success. */
export function completeClientCleanupMarker(): void {
  if (hasClientCleanupNeeded()) {
    // Persist and read back the generation before releasing the shared fence.
    // Another tab may consume the cookie while a sleeping tab retains its own
    // sessionStorage; that old input still cannot match this generation.
    localCleanupNeeded = true;
    try {
      const generation = crypto.randomUUID();
      localStorage.setItem(CLIENT_CLEANUP_GENERATION_KEY, generation);
      if (getClientCleanupGeneration() !== generation) throw new Error();
    } catch { throw new Error(MARKER_FAILED); }
  }
  write('', 0);
  localCleanupNeeded = false;
  if (hasClientCleanupNeeded()) { localCleanupNeeded = true; throw new Error(MARKER_FAILED); }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CLIENT_CLEANUP_COMPLETED_EVENT));
}
