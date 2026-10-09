/**
 * ブラウザに残る個人情報の後始末（単一ソース）。
 *
 * 🔴 なぜ必要か
 * 退会（アカウント削除）後は `window.location.href = '/'` で全リロードしているが、
 * 【リロードでは sessionStorage は消えない】。予約フローはログイン遷移の直前に
 * 下書きを sessionStorage へ保存しており、その中身は氏名・メールアドレス・電話番号・
 * 備考＝個人情報そのもの。復元時に消える設計だが、保存したまま予約ページへ戻らずに
 * 退会した場合は【タブを閉じるまで端末に残り続ける】。
 * 「退会したのに入力した個人情報が端末に残っている」状態は、退会という操作の意味と矛盾する。
 *
 * ⚠️ 認証情報については全リロードで十分（このアプリの Supabase クライアントは
 * @supabase/ssr の createBrowserClient ＝ Cookie 方式で、サーバー側の
 * /api/account/delete が sb-*auth-token を失効させている）。認証tokenをlocalStorageへ置かない。
 * localStorageの非PII消去世代は、休眠タブの古い予約下書きを無効化するために保持する。
 * ここで面倒を見るのは【アプリが自分で書いた分】だけに限る。
 * sessionStorage.clear() で一括消去しないのは、他機能が同じ領域を使い始めたときに
 * 巻き添えで消す事故を作らないため。
 */

import { CLIENT_BOOKING_DRAFT_META_PREFIX } from './client-cleanup-marker';

/** 予約フローの下書きキーの接頭辞。施設 ID を後ろに付けて使う。 */
export const BOOKING_DRAFT_PREFIX = 'booking-draft:';

function isAccountDraftKey(key: string): boolean {
  return key.startsWith(BOOKING_DRAFT_PREFIX) || key.startsWith(CLIENT_BOOKING_DRAFT_META_PREFIX);
}

/** 施設 ID から下書きキーを組み立てる。組み立て方を1箇所に閉じ、消去側とのズレを防ぐ。 */
export function bookingDraftKey(facilityId: string): string {
  return `${BOOKING_DRAFT_PREFIX}${facilityId}`;
}

/**
 * このアプリの予約下書きとしてsessionStorageへ書いた個人情報を消す。
 *
 * 既存呼出しとの互換のためbest-effortにする。退会の直前検証は
 * clearAccountLocalDataをawaitし、失敗を無視しない。
 */
export function clearStoredPersonalData(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key !== null && isAccountDraftKey(key)) keys.push(key);
    }
    // 走査中に削除すると添字がずれて取りこぼすため、集めてから消す。
    for (const key of keys) sessionStorage.removeItem(key);
  } catch {
    // このlegacy helperは投げない。削除の成否を確定するcallerはasync検証を使う。
  }
}

export const LOCAL_DATA_CLEAR_FAILED = 'この端末の下書きの削除を確認できませんでした。ブラウザーの保存設定をご確認ください。';

/** Verify both app-owned stores before an irreversible account deletion.
 * The legacy best-effort wipe remains available to existing callers, but a
 * deletion caller must not mistake an unavailable or failed wipe for success.
 * Attempt the booking wipe even if IndexedDB failed, to reduce retained data.
 */
let cleanupInFlight: Promise<void> | null = null;
export function clearAccountLocalData(): Promise<void> {
  if (cleanupInFlight) return cleanupInFlight;
  const cleanup = verifyAccountLocalData().finally(() => { cleanupInFlight = null; });
  cleanupInFlight = cleanup;
  return cleanup;
}

async function verifyAccountLocalData(): Promise<void> {
  let failed = false;
  try {
    const { clearAllLocalSalonDrafts } = await import('./salon-local-draft');
    await clearAllLocalSalonDrafts();
  } catch { failed = true; }
  const before: string[] = [];
  try {
    for (let index = 0; index < sessionStorage.length; index++) {
      const key = sessionStorage.key(index);
      if (key === null) failed = true;
      else if (isAccountDraftKey(key)) before.push(key);
    }
  } catch { failed = true; }
  clearStoredPersonalData();
  try {
    for (const key of before) if (sessionStorage.getItem(key) !== null) failed = true;
    for (let index = 0; index < sessionStorage.length; index++) {
      const key = sessionStorage.key(index);
      if (key === null || isAccountDraftKey(key)) failed = true;
    }
  } catch { failed = true; }
  if (failed) throw new Error(LOCAL_DATA_CLEAR_FAILED);
}
