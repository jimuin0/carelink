import { hasClientCleanupNeeded } from './client-cleanup-marker';

// No name, body, email, photo, token or consent is stored. A result-unknown
// review keeps only its operation id across reloads/tabs, without its inputs.
export const REVIEW_PENDING_PREFIX = 'review-submission-pending:';
const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const unavailable = () => new Error('REVIEW_RESULT_UNCONFIRMED');
export function readReviewFence(facilityId: string): string | null {
  if (hasClientCleanupNeeded()) throw unavailable();
  try { return localStorage.getItem(REVIEW_PENDING_PREFIX + facilityId); }
  catch { throw unavailable(); }
}
function beginReviewFence(facilityId: string, operationId: string): void {
  if (!OPERATION_ID.test(operationId)) throw unavailable();
  try {
    localStorage.setItem(REVIEW_PENDING_PREFIX + facilityId, operationId);
    if (localStorage.getItem(REVIEW_PENDING_PREFIX + facilityId) !== operationId) throw unavailable();
  } catch { throw unavailable(); }
}
/**
 * Runs one review POST under the browser's exclusive lock.
 *
 * A fence left by an earlier attempt whose result is unknown is RESUMED: the
 * same operation id is sent again (resumed=true). The server stores the id with
 * the review (unique), so a resend returns the earlier review when it was
 * saved and creates the review only when it was not — never a second one.
 * Before 2026-10-23 an existing fence refused every later attempt and nothing
 * could remove it, so the facility's review form stayed locked on the device.
 * A fresh attempt writes a new fence first (resumed=false).
 */
export async function withReviewTransportFence<T>(
  facilityId: string, newOperationId: string, action: (operationId: string, resumed: boolean) => Promise<T>,
): Promise<T> {
  // localStorage read/set is not a cross-tab CAS. Hold the browser's exclusive
  // lock through the HTTP attempt; a lost result leaves the durable marker.
  if (!navigator.locks?.request) throw new Error('このブラウザでは投稿結果の保護を確認できません。入力を保持して対応ブラウザでお試しください。');
  return navigator.locks.request(REVIEW_PENDING_PREFIX + facilityId, { mode: 'exclusive' }, async () => {
    const earlier = readReviewFence(facilityId);
    if (earlier !== null) {
      if (!OPERATION_ID.test(earlier)) throw unavailable();
      return action(earlier, true);
    }
    beginReviewFence(facilityId, newOperationId);
    return action(newOperationId, false);
  });
}
export function finishReviewFence(facilityId: string, operationId: string): void {
  try {
    const key = REVIEW_PENDING_PREFIX + facilityId;
    if (localStorage.getItem(key) !== operationId) throw unavailable();
    localStorage.removeItem(key);
    if (localStorage.getItem(key) !== null) throw unavailable();
  } catch { throw unavailable(); }
}
/** These UUID-only receipt fences contain no draft input and are deliberately
 * retained after logout/retirement. Global erasure would permit an uncertain
 * accepted review to be posted again with a new operation. Only a verified
 * acceptance (including a resumed operation the server already saved), a
 * precommit rejection of a fresh operation, or a 24h duplicate refusal may
 * remove its fence. */
export function validateRetainedReviewFences(): void {
  for (let i = 0; i < localStorage.length; i++) {
    const key=localStorage.key(i);
    if (key === null) throw unavailable();
    if (key.startsWith(REVIEW_PENDING_PREFIX)) {
      const value=localStorage.getItem(key);
      if (value === null || !OPERATION_ID.test(value)) throw unavailable();
    }
  }
}
