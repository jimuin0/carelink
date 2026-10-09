import { hasClientCleanupNeeded } from './client-cleanup-marker';

// No name, body, email, photo, token or consent is stored. A result-unknown
// review must stay fenced across reloads/tabs, without persisting its inputs.
export const REVIEW_PENDING_PREFIX = 'review-submission-pending:';
const unavailable = () => new Error('REVIEW_RESULT_UNCONFIRMED');
export function readReviewFence(facilityId: string): string | null {
  if (hasClientCleanupNeeded()) throw unavailable();
  try { return localStorage.getItem(REVIEW_PENDING_PREFIX + facilityId); }
  catch { throw unavailable(); }
}
function beginReviewFence(facilityId: string, operationId: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operationId)) throw unavailable();
  if (readReviewFence(facilityId) !== null) throw unavailable();
  try {
    localStorage.setItem(REVIEW_PENDING_PREFIX + facilityId, operationId);
    if (localStorage.getItem(REVIEW_PENDING_PREFIX + facilityId) !== operationId) throw unavailable();
  } catch { throw unavailable(); }
}
export async function withReviewTransportFence<T>(facilityId: string, operationId: string, action: () => Promise<T>): Promise<T> {
  // localStorage read/set is not a cross-tab CAS. Hold the browser's exclusive
  // lock through the HTTP attempt; a lost result leaves the durable marker.
  if (!navigator.locks?.request) throw new Error('このブラウザでは投稿結果の保護を確認できません。入力を保持して対応ブラウザでお試しください。');
  return navigator.locks.request(REVIEW_PENDING_PREFIX + facilityId, { mode: 'exclusive' }, async () => {
    beginReviewFence(facilityId, operationId);
    return action();
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
 * accepted review to be posted again with a new operation. Only a matching
 * verified acceptance/precommit rejection may remove its fence. */
export function validateRetainedReviewFences(): void {
  for (let i = 0; i < localStorage.length; i++) {
    const key=localStorage.key(i);
    if (key === null) throw unavailable();
    if (key.startsWith(REVIEW_PENDING_PREFIX)) {
      const value=localStorage.getItem(key);
      if (value === null || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw unavailable();
    }
  }
}
