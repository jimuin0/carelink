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
 * /api/account/delete が sb-*auth-token を失効させている）。localStorage は使っていない。
 * ここで面倒を見るのは【アプリが自分で書いた分】だけに限る。
 * sessionStorage.clear() で一括消去しないのは、他機能が同じ領域を使い始めたときに
 * 巻き添えで消す事故を作らないため。
 */

/** 予約フローの下書きキーの接頭辞。施設 ID を後ろに付けて使う。 */
export const BOOKING_DRAFT_PREFIX = 'booking-draft:';

/** 施設 ID から下書きキーを組み立てる。組み立て方を1箇所に閉じ、消去側とのズレを防ぐ。 */
export function bookingDraftKey(facilityId: string): string {
  return `${BOOKING_DRAFT_PREFIX}${facilityId}`;
}

/**
 * このアプリが sessionStorage へ書いた個人情報を全て消す。
 *
 * 退会成功後、画面遷移の【前】に呼ぶこと。遷移してからでは同じタブで実行される保証がない。
 * sessionStorage が使えない環境（プライベートモード等）でも退会自体は妨げない。
 */
export function clearStoredPersonalData(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key !== null && key.startsWith(BOOKING_DRAFT_PREFIX)) keys.push(key);
    }
    // 走査中に削除すると添字がずれて取りこぼすため、集めてから消す。
    for (const key of keys) sessionStorage.removeItem(key);
  } catch {
    // sessionStorage 不可。消すべきものが書けてもいないので、何もしなくてよい。
  }
}
