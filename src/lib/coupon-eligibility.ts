/**
 * クーポンの「対象：新規／リピーター」の判定と文言の単一ソース（2026年10月22日 新設）。
 *
 * 【背景】管理画面で「対象」を新規やリピーターにしても、予約時にはどこでも確認しておらず、
 * 来店歴のある客が新規限定の割引価格で予約を確定できた（ゲストは user_id が無いので何度でも）。
 *
 * 【定義】判定の権威は予約 RPC create_booking_for_menus_atomic
 * （supabase/migrations/20261022160000_coupon_target_eligibility.sql）。同じ店舗で
 * 「キャンセル以外の予約」が 1 件でもあれば予約履歴あり。本人の照合はログインユーザー ID か、
 * 予約メールアドレスの正規化値（bookings.email_canonical・Gmail のドット／+ を同一視）。
 * - 新規（new_customer）… 予約履歴が無いお客様だけ使える
 * - リピーター（repeat）… 予約履歴があるお客様だけ使える
 * 店舗の手動予約（電話予約）はクーポンを付けないので、この判定の対象外。
 */

/** 予約履歴として数えない予約ステータス（キャンセル系）。RPC の NOT IN と同じ集合。 */
export const COUPON_HISTORY_IGNORED_STATUSES = ['cancelled', 'cancel_fee_paid'] as const;

/** RPC が拒否時に投げるコード → お客様向けの文言（/api/booking の KNOWN_CREATE_REJECTIONS へ合流）。 */
export const COUPON_TARGET_REJECTIONS: Readonly<Record<'COUPON_NEW_CUSTOMER_ONLY' | 'COUPON_REPEAT_ONLY', string>> = {
  COUPON_NEW_CUSTOMER_ONLY: 'このクーポンは、この店舗を初めてご予約の方限定です。クーポンを外してご予約ください',
  COUPON_REPEAT_ONLY: 'このクーポンは、この店舗で2回目以降のご予約の方限定です。クーポンを外してご予約ください',
};

/** 管理画面の「対象」欄に添える説明（新規作成・編集の両方で使う）。 */
export const COUPON_TARGET_ADMIN_HELP =
  '新規：この店舗で予約したことがない方（キャンセルした予約は数えません）／リピーター：予約したことがある方。ネット予約の確定時に、ログイン情報とメールアドレスで自動的に確認します。';

/** お客様向けの利用条件（新規・リピーター以外は条件なしで null）。 */
export function couponTargetCondition(couponType: string): string | null {
  if (couponType === 'new_customer') return 'この店舗を初めてご予約の方限定';
  if (couponType === 'repeat') return 'この店舗で2回目以降のご予約の方限定';
  return null;
}

/**
 * 予約履歴の有無が分かっているときに、そのクーポンが使えないかを返す。
 * hasHistory が null（不明）のときは判定しない（false＝使えるものとして表示し、確定時に RPC が判定する）。
 */
export function isCouponBlockedByHistory(couponType: string, hasHistory: boolean | null): boolean {
  if (hasHistory === null) return false;
  if (couponType === 'new_customer') return hasHistory;
  if (couponType === 'repeat') return !hasHistory;
  return false;
}
