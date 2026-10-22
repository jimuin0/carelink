/**
 * キャンセル料の算出（客への金額通知用・実徴収はしない）。
 *
 * 神原さん仕様: キャンセル料は客に金額を通知するのみで、徴収は店舗と客が直接やり取りする
 * （Stripe 等の自動徴収はしない）。本モジュールは facility_cancel_policies の料率と予約時刻から
 * 通知用の金額を計算する純粋関数のみを提供する。
 *
 * 🔴 キャンセルポリシーの「意味」はここ（resolveCancelPolicy）だけが決める。
 *   設定画面の選択肢・予約画面の案内文（describeCancelPolicy）・キャンセル料の計算
 *   （computeCancelFee＝API の応答とお客様／店舗宛メール・管理画面の予約詳細）・マイページと LIFF の
 *   キャンセルボタンはすべてこの解釈を通す。以前は free_cancel_hours=0 を、設定画面は「キャンセル不可」、
 *   予約画面は「常にキャンセル料」、計算は「いつでも無料」とそれぞれ別の意味に読んでいた
 *   （2026年10月22日・神原さん判断「店舗側の設定に任せる」で選択肢を分けて明示した）。
 */

/**
 * 店舗が選ぶキャンセルの受け付け方（facility_cancel_policies.cancel_rule・DB の CHECK 制約と一致）。
 * - free_window: 予約日時の free_cancel_hours 時間前まで無料、それ以降は late_cancel_rate のキャンセル料
 * - always_fee:  期限なし。キャンセルは受け付け、いつキャンセルしても late_cancel_rate のキャンセル料
 * - no_online:   ネット（マイページ・LINE）からのキャンセルは受け付けない。お客様は店舗へ直接連絡する
 *                （キャンセル RPC が BOOKING_ONLINE_CANCEL_DISABLED で拒否する）
 */
export const CANCEL_RULES = ['free_window', 'always_fee', 'no_online'] as const;
export type CancelRule = (typeof CANCEL_RULES)[number];

/**
 * facility_cancel_policies の列の既定値（migration 20260405000003 の DEFAULT と同じ値）。
 * ポリシーをまだ保存していない店舗の設定画面の初期値に使う。
 */
export const CANCEL_POLICY_DEFAULTS = { free_cancel_hours: 24, late_cancel_rate: 50, no_show_rate: 100 } as const;

/**
 * 保存済みの行で列が NULL のときの読み方。設定画面の表示・予約画面の案内（describeCancelPolicy）・
 * キャンセル料の計算（computeCancelFee）がすべてこの値を使う。設定画面からは NULL を保存できない。
 * - free_cancel_hours: DB の DEFAULT と同じ 24 時間。
 * - late_cancel_rate: 0（キャンセル料なし）。DB の DEFAULT（50）ではない。2026年10月23日より前から、
 *   予約画面は NULL を「予約後のキャンセル料はかかりません。」と案内し、計算も 0 円だった。その案内を見て
 *   予約したお客様に、あとから 50% のキャンセル料を通知しないよう、お客様に見えていた意味を保つ。
 */
export const CANCEL_POLICY_NULL_READING = { free_cancel_hours: 24, late_cancel_rate: 0 } as const;

/** ネットからのキャンセルを受け付けない店舗で、お客様に出す案内（予約画面・マイページ・LIFF・API の応答）。 */
export const ONLINE_CANCEL_DISABLED_MESSAGE =
  'この店舗ではネットからのキャンセルをお受けしていません。キャンセルをご希望の場合は、店舗へ直接ご連絡ください。';

export type CancelPolicy = {
  free_cancel_hours: number | null;
  late_cancel_rate: number | null;
  /** 未設定（NULL）は 2026年10月23日より前に保存された行。free_cancel_hours から解釈する。 */
  cancel_rule?: CancelRule | null;
  no_show_rate?: number | null;
  policy_text?: string | null;
};

export type ResolvedCancelPolicy =
  | { rule: 'free_window'; freeHours: number; rate: number }
  | { rule: 'always_fee'; rate: number }
  | { rule: 'no_online'; rate: number };

/**
 * キャンセルポリシーの単一の解釈。cancel_rule が無い旧い行は free_cancel_hours から読む:
 * 1 以上は「N時間前まで無料」、0 以下は旧選択肢「キャンセル不可」で、予約画面が
 * 「キャンセルの場合は〜%をキャンセル料として承ります」と案内していた設定なので「期限なし（常にキャンセル料）」。
 */
export function resolveCancelPolicy(policy: CancelPolicy): ResolvedCancelPolicy {
  const rate = policy.late_cancel_rate ?? CANCEL_POLICY_NULL_READING.late_cancel_rate;
  if (policy.cancel_rule === 'no_online') return { rule: 'no_online', rate };
  const freeHours = policy.free_cancel_hours ?? CANCEL_POLICY_NULL_READING.free_cancel_hours;
  if (policy.cancel_rule === 'always_fee' || freeHours <= 0) return { rule: 'always_fee', rate };
  return { rule: 'free_window', freeHours, rate };
}

/** お客様がマイページ・LIFF から自分でキャンセルできる店舗か（ポリシー未設定の店舗は従来どおり可）。 */
export function isOnlineCancelAllowed(policy: CancelPolicy | null | undefined): boolean {
  return !policy || resolveCancelPolicy(policy).rule !== 'no_online';
}

/**
 * 予約開始（JST）まで残り何時間か。booking_date(YYYY-MM-DD) + start_time(HH:MM[:SS]) を JST として
 * 解釈し、nowMs（UTC epoch ミリ秒）との差を時間で返す。解釈不能なら Infinity（＝無料期限内扱い）。
 */
export function hoursUntilBookingStart(bookingDate: string, startTime: string, nowMs: number): number {
  const hhmm = startTime.slice(0, 5);
  const startMs = Date.parse(`${bookingDate}T${hhmm}:00+09:00`);
  if (Number.isNaN(startMs)) return Infinity;
  return (startMs - nowMs) / 3_600_000;
}

/**
 * 予約の開始時刻（JST）を過ぎたか。キャンセル・日時変更の「開始後はオンラインで受け付けない」判定に使う
 * （SQL 側の BOOKING_ALREADY_STARTED と同じ規則）。解釈不能な日時は開始前として扱う＝最終判定は DB に任せる。
 */
export function hasBookingStarted(bookingDate: string, startTime: string, nowMs: number): boolean {
  return hoursUntilBookingStart(bookingDate, startTime, nowMs) < 0;
}

/**
 * 予約の開始時刻（JST）より前か。「完了」「無断キャンセル」と、会計して完了にする操作は、開始時刻を
 * 過ぎてからしか記録できない（SQL 側の BOOKING_NOT_STARTED と同じ規則＝開始時刻ちょうどからは記録できる）。
 * 解釈不能な日時は開始前として扱う（記録させない側へ倒す）。
 */
export function isBeforeBookingStart(bookingDate: string, startTime: string, nowMs: number): boolean {
  return hoursUntilBookingStart(bookingDate, startTime, nowMs) > 0;
}

/**
 * キャンセル料を算出する。policy 不在・金額不明/0以下・料率0以下はいずれも 0（無料）。
 * 「N時間前まで無料」は期限内なら 0、過ぎたら total_price × late_cancel_rate%。
 * 「期限なし」はいつキャンセルしても total_price × late_cancel_rate%。
 * 「ネットでのキャンセル不可」はネットからのキャンセル自体を受け付けないので、ここでは金額を出さない
 * （電話等でのキャンセル料は店舗がお客様へ直接案内する）。
 */
export function computeCancelFee(
  policy: CancelPolicy | null | undefined,
  totalPrice: number | null | undefined,
  hoursUntilStart: number,
): { fee: number; rate: number; isLate: boolean } {
  if (!policy || !totalPrice || totalPrice <= 0) return { fee: 0, rate: 0, isLate: false };
  const resolved = resolveCancelPolicy(policy);
  const { rate } = resolved;
  if (rate <= 0 || resolved.rule === 'no_online'
    || (resolved.rule === 'free_window' && hoursUntilStart >= resolved.freeHours)) {
    return { fee: 0, rate, isLate: false };
  }
  return { fee: Math.round((totalPrice * rate) / 100), rate, isLate: true };
}

/**
 * 【2026年7月15日 追加】予約確認画面（客向け）にキャンセルポリシーを表示するための説明文を
 * 生成する純粋関数。computeCancelFee と同じ解釈（resolveCancelPolicy）から文言を選ぶので、
 * 予約時に案内した内容と、キャンセル後に通知される金額が食い違わない。
 */
export function describeCancelPolicy(policy: CancelPolicy): string {
  const resolved = resolveCancelPolicy(policy);
  if (resolved.rule === 'no_online') return ONLINE_CANCEL_DISABLED_MESSAGE;
  if (resolved.rate <= 0) return '予約後のキャンセル料はかかりません。';
  if (resolved.rule === 'always_fee') {
    return `キャンセルの場合は時期にかかわらず、施術料金の${resolved.rate}%をキャンセル料として承ります。`;
  }
  return `予約日時の${resolved.freeHours}時間前まで無料でキャンセルできます。それ以降のキャンセルは施術料金の${resolved.rate}%をキャンセル料として承ります。`;
}
