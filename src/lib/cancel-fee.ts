/**
 * キャンセル料の算出（客への金額通知用・実徴収はしない）。
 *
 * 神原さん仕様: キャンセル料は客に金額を通知するのみで、徴収は店舗と客が直接やり取りする
 * （Stripe 等の自動徴収はしない）。本モジュールは facility_cancel_policies の料率と予約時刻から
 * 通知用の金額を計算する純粋関数のみを提供する。
 */

export type CancelPolicy = {
  free_cancel_hours: number | null;
  late_cancel_rate: number | null;
  no_show_rate?: number | null;
  policy_text?: string | null;
};

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
 * キャンセル料を算出する。無料期限（free_cancel_hours）以内のキャンセルは無料、期限を過ぎたら
 * total_price × late_cancel_rate%。policy 不在・金額不明/0以下・料率0以下・期限内はいずれも 0（無料）。
 */
export function computeCancelFee(
  policy: CancelPolicy | null | undefined,
  totalPrice: number | null | undefined,
  hoursUntilStart: number,
): { fee: number; rate: number; isLate: boolean } {
  if (!policy || !totalPrice || totalPrice <= 0) return { fee: 0, rate: 0, isLate: false };
  const free = policy.free_cancel_hours ?? 0;
  const rate = policy.late_cancel_rate ?? 0;
  if (hoursUntilStart >= free || rate <= 0) return { fee: 0, rate, isLate: false };
  return { fee: Math.round((totalPrice * rate) / 100), rate, isLate: true };
}

/**
 * 【2026年7月15日 追加】予約確認画面（客向け）にキャンセルポリシーを表示するための説明文を
 * 生成する純粋関数。free_cancel_hours <= 0（キャンセル不可設定）・late_cancel_rate <= 0
 * （キャンセル料なし）はそれぞれ文言を分岐し、実在しない「0時間前まで無料」等の不自然な
 * 表現を避ける。実際のキャンセル料計算（computeCancelFee）とは別に、表示専用の文言生成に限定する。
 */
export function describeCancelPolicy(policy: CancelPolicy): string {
  const free = policy.free_cancel_hours ?? 0;
  const rate = policy.late_cancel_rate ?? 0;
  if (rate <= 0) return '予約後のキャンセル料はかかりません。';
  if (free <= 0) return `キャンセルの場合、施術料金の${rate}%をキャンセル料として承ります。`;
  return `予約日時の${free}時間前まで無料でキャンセルできます。それ以降のキャンセルは施術料金の${rate}%をキャンセル料として承ります。`;
}
