/**
 * クーポンの「対象：新規／リピーター」の判定と文言の単一ソース（2026年10月22日 新設）。
 *
 * 【背景】管理画面で「対象」を新規やリピーターにしても、予約時にはどこでも確認しておらず、
 * 来店歴のある客が新規限定の割引価格で予約を確定できた（ゲストは user_id が無いので何度でも）。
 *
 * 【定義】判定の権威は予約 RPC create_booking_for_menus_atomic
 * （supabase/migrations/20261022160000_coupon_target_eligibility.sql）。
 * - 新規・リピーターのクーポンは【ログインしたお客様だけ】が使える（ゲストは
 *   COUPON_TARGET_LOGIN_REQUIRED）。
 * - 照合するのはそのアカウント自身の予約だけ＝アカウントの予約と、アカウントの【確認済み】
 *   メールアドレス（正規化値・Gmail のドット／+ を同一視）で受けた予約。
 *   🔴 予約フォームに入力されたメールアドレスでは照合しない。入力値で照合すると、他人の
 *   アドレスを入れて送るだけで「その人がこの店舗に通っているか」が本人に知られずに分かる
 *   （拒否された予約はロールバックされ、メールも何も届かないため）。医療・福祉の店舗では
 *   来院歴そのものが要配慮情報にあたり得る。
 * - 新規（new_customer）… この店舗に「キャンセル以外の予約」が 1 件も無い
 *   （確認待ち・確定・無断キャンセルも予約として数える＝初回来店前の 2 件目に新規価格を重ねない）
 * - リピーター（repeat）… この店舗に来店した予約（受付・完了）がある
 *   （売上集計 aggregate_daily_revenue の「リピーター＝来店済み」と同じ考え方）
 * 店舗の手動予約（電話予約）はクーポンを付けないので、この判定の対象外。
 */

/** 予約履歴（新規の判定）として数えない予約ステータス（キャンセル系）。RPC の NOT IN と同じ集合。 */
export const COUPON_HISTORY_IGNORED_STATUSES = ['cancelled', 'cancel_fee_paid'] as const;

/** 来店（リピーターの判定）として数える予約ステータス（受付・完了）。RPC の IN と同じ集合。 */
export const COUPON_VISIT_STATUSES = ['arrived', 'completed'] as const;

type CouponTargetRejection = 'COUPON_TARGET_LOGIN_REQUIRED' | 'COUPON_NEW_CUSTOMER_ONLY' | 'COUPON_REPEAT_ONLY';

/** RPC が拒否時に投げるコード → お客様向けの文言（/api/booking の KNOWN_CREATE_REJECTIONS へ合流）。 */
export const COUPON_TARGET_REJECTIONS: Readonly<Record<CouponTargetRejection, string>> = {
  COUPON_TARGET_LOGIN_REQUIRED: 'このクーポンはログインしてご利用ください。ログインするか、クーポンを外してご予約ください',
  COUPON_NEW_CUSTOMER_ONLY: 'このクーポンは、この店舗を初めてご予約の方限定です。クーポンを外してご予約ください',
  COUPON_REPEAT_ONLY: 'このクーポンは、この店舗にご来店いただいたことがある方限定です。クーポンを外してご予約ください',
};

/** 管理画面の「対象」欄に添える説明（新規作成・編集の両方で使う）。 */
export const COUPON_TARGET_ADMIN_HELP =
  '新規：この店舗で予約したことがない方（キャンセルした予約は数えません）／リピーター：この店舗に来店されたことがある方（ステータスが「受付」か「完了」の予約がある方）。どちらもログインしたお客様だけが使えます。ネット予約の確定時に、お客様のアカウントの予約履歴で自動的に確認します。';

/** 新規・リピーター限定のクーポンか（＝ログインが必要で、予約履歴で判定される）。 */
export function isTargetedCoupon(couponType: string): boolean {
  return couponType === 'new_customer' || couponType === 'repeat';
}

/** お客様向けの利用条件（新規・リピーター以外は条件なしで null）。 */
export function couponTargetCondition(couponType: string): string | null {
  if (couponType === 'new_customer') return 'この店舗を初めてご予約の方限定';
  if (couponType === 'repeat') return 'この店舗にご来店いただいたことがある方限定';
  return null;
}

/**
 * 予約画面で、そのクーポンを今は選べない理由を返す（選べるなら null）。
 * - signedIn が false（ゲストと確定）なら新規・リピーターは 'login'
 * - ログイン中で本人の予約がある（hasBooking が true）と分かっていれば、新規は 'history'
 * どちらも分からない（null）ときは止めない。確定時に RPC が判定する。
 * リピーターはここでは履歴で止めない。アカウントのメールアドレスで受けたゲスト予約は
 * 画面から読めない（RLS は本人の user_id の予約だけ）ため、「来店が無い」とは言い切れない。
 */
export function couponTargetBlock(
  couponType: string,
  state: { signedIn: boolean | null; hasBooking: boolean | null },
): 'login' | 'history' | null {
  if (!isTargetedCoupon(couponType)) return null;
  if (state.signedIn === false) return 'login';
  if (couponType === 'new_customer' && state.hasBooking === true) return 'history';
  return null;
}
