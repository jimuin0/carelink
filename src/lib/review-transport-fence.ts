import { hasClientCleanupNeeded } from './client-cleanup-marker';

// No name, body, email, photo, token or consent is stored. A result-unknown
// review keeps only its operation id across reloads/tabs, without its inputs.
export const REVIEW_PENDING_PREFIX = 'review-submission-pending:';
const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * Fences written since 2026-10-23 are stored as `v2:<operation id>`; the server
 * stores that id with the review. A bare UUID is a LEGACY fence from the form
 * that never sent its id, so the server cannot find the earlier review by it.
 */
const FENCE_VERSION = 'v2:';
const unavailable = () => new Error('REVIEW_RESULT_UNCONFIRMED');
/**
 * new    … no earlier attempt; a fresh fence was written for this operation.
 * resume … an earlier attempt of this form left its operation id (server-known).
 * legacy … an earlier attempt of the pre-2026-10-23 form; the server has to
 *          look for the earlier review by reviewer, not by operation id.
 */
export type ReviewFenceMode = 'new' | 'resume' | 'legacy';
function parseFence(value: string): { operationId: string; mode: 'resume' | 'legacy' } {
  if (value.startsWith(FENCE_VERSION)) {
    const operationId = value.slice(FENCE_VERSION.length);
    if (OPERATION_ID.test(operationId)) return { operationId, mode: 'resume' };
  } else if (OPERATION_ID.test(value)) return { operationId: value, mode: 'legacy' };
  throw unavailable();
}
export function readReviewFence(facilityId: string): string | null {
  if (hasClientCleanupNeeded()) throw unavailable();
  try { return localStorage.getItem(REVIEW_PENDING_PREFIX + facilityId); }
  catch { throw unavailable(); }
}
function beginReviewFence(facilityId: string, operationId: string): void {
  if (!OPERATION_ID.test(operationId)) throw unavailable();
  try {
    localStorage.setItem(REVIEW_PENDING_PREFIX + facilityId, FENCE_VERSION + operationId);
    if (localStorage.getItem(REVIEW_PENDING_PREFIX + facilityId) !== FENCE_VERSION + operationId) throw unavailable();
  } catch { throw unavailable(); }
}
/**
 * Runs one review POST under the browser's exclusive lock.
 *
 * A fence left by an earlier attempt whose result is unknown is RESUMED: the
 * same operation id is sent again (mode 'resume'). The server stores the id with
 * the review (unique), so a resend returns the earlier review when it was
 * saved and creates the review only when it was not — never a second one.
 * A legacy fence (mode 'legacy') carries an id the old server never stored; the
 * server then looks for the reviewer's earlier review of the facility instead.
 * Before 2026-10-23 an existing fence refused every later attempt and nothing
 * could remove it, so the facility's review form stayed locked on the device.
 * A fresh attempt writes a new fence first (mode 'new').
 */
export async function withReviewTransportFence<T>(
  facilityId: string, newOperationId: string, action: (operationId: string, mode: ReviewFenceMode) => Promise<T>,
): Promise<T> {
  // localStorage read/set is not a cross-tab CAS. Hold the browser's exclusive
  // lock through the HTTP attempt; a lost result leaves the durable marker.
  if (!navigator.locks?.request) throw new Error('このブラウザでは投稿結果の保護を確認できません。入力を保持して対応ブラウザでお試しください。');
  return navigator.locks.request(REVIEW_PENDING_PREFIX + facilityId, { mode: 'exclusive' }, async () => {
    const earlier = readReviewFence(facilityId);
    if (earlier !== null) {
      const { operationId, mode } = parseFence(earlier);
      return action(operationId, mode);
    }
    beginReviewFence(facilityId, newOperationId);
    return action(newOperationId, 'new');
  });
}
export function finishReviewFence(facilityId: string, operationId: string): void {
  try {
    const key = REVIEW_PENDING_PREFIX + facilityId;
    const stored = localStorage.getItem(key);
    if (stored === null || parseFence(stored).operationId !== operationId) throw unavailable();
    localStorage.removeItem(key);
    if (localStorage.getItem(key) !== null) throw unavailable();
  } catch { throw unavailable(); }
}
/** These UUID-only receipt fences contain no draft input and are deliberately
 * retained after logout/retirement. Global erasure would permit an uncertain
 * accepted review to be posted again with a new operation. Only a verified
 * acceptance (including a resumed operation the server already saved), a
 * precommit rejection of a fresh operation, a 24h duplicate refusal, or a
 * refusal because the fence belongs to another reviewer may remove its fence. */
export function validateRetainedReviewFences(): void {
  for (let i = 0; i < localStorage.length; i++) {
    const key=localStorage.key(i);
    if (key === null) throw unavailable();
    if (key.startsWith(REVIEW_PENDING_PREFIX)) {
      const value=localStorage.getItem(key);
      if (value === null) throw unavailable();
      parseFence(value);
    }
  }
}
