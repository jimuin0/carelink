/**
 * お客様によるキャンセルの「キャンセル料の算出材料」（fee context）の単一ソース。
 *
 * キャンセル RPC（cancel_customer_booking_with_channels_atomic）は、キャンセルと同じトランザクションで
 * メール用に凍結した snapshot から次の材料を取り出し、API へ返すと同時に bookings.cancel_fee_context へ
 * 保存する（20261023020000）。API の応答・お客様／店舗宛メール・管理画面の予約詳細は、どれも
 * この材料を computeCancelFee に通すので、同じキャンセルに違う金額が出ることがない。
 */
import { z } from 'zod';
import { CANCEL_RULES, computeCancelFee, hoursUntilBookingStart } from './cancel-fee';
import { isValidIsoDate } from './date-utils';

/** snapshot に凍結されたキャンセルポリシー。cancel_rule は 20261023020000 より前に積まれた分には無い。 */
export const cancelPolicySnapshotSchema = z.object({
  free_cancel_hours: z.number().finite().nullable(),
  late_cancel_rate: z.number().finite().nullable(),
  cancel_rule: z.enum(CANCEL_RULES).nullable().optional(),
});

export const cancelFeeContextSchema = z.object({
  policy: cancelPolicySnapshotSchema.nullable(),
  totalPrice: z.number().finite().nullable(),
  bookingDate: z.string().refine(isValidIsoDate),
  startTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/),
  capturedAt: z.string().datetime({ offset: true }),
});
export type CancelFeeContext = z.infer<typeof cancelFeeContextSchema>;

/**
 * PostgreSQL の timestamptz（マイクロ秒まで）を epoch ミリ秒にする。ミリ秒より細かい桁を落としてから読むので、
 * 小数部が 3 桁を超える ISO 文字列を読めないブラウザ（管理画面で使う）でも同じ値になる。
 */
export function isoToMs(iso: string): number {
  return Date.parse(iso.replace(/(\.\d{3})\d+/, '$1'));
}

/** 材料からキャンセル料を算出する（キャンセルを受け付けた時刻＝capturedAt 時点の残り時間で判定）。 */
export function cancelFeeFromContext(ctx: CancelFeeContext): { fee: number; rate: number; isLate: boolean } {
  return computeCancelFee(ctx.policy, ctx.totalPrice,
    hoursUntilBookingStart(ctx.bookingDate, ctx.startTime, isoToMs(ctx.capturedAt)));
}

/**
 * 管理画面の予約詳細向け。bookings.cancel_fee_context を検証して、お客様へ通知したキャンセル料と
 * キャンセルを受け付けた時刻を返す。値が無い（店舗側の操作でキャンセルした予約・この仕組みより前の
 * キャンセル）・形が崩れている場合は null（＝金額を推測で出さない）。
 */
export function readCancelFeeReceipt(raw: unknown): { fee: number; rate: number; cancelledAt: string } | null {
  const parsed = cancelFeeContextSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { fee, rate } = cancelFeeFromContext(parsed.data);
  return { fee, rate, cancelledAt: parsed.data.capturedAt };
}

/**
 * お客様宛のキャンセル通知メールが積まれる宛先か（＝お客様へキャンセル料をメールでお知らせしたか）。
 * publish_customer_booking_transition_email がお客様を宛先に加える条件
 * `nullif(btrim(b.email),'') IS NOT NULL` と同じ（btrim は半角スペースだけを落とす）。
 * 店舗宛のキャンセル通知メールと管理画面の予約詳細が、案内の文言を言い分けるのに使う。
 * SQL 側の条件が変わったら src/lib/__tests__/cancel-fee-receipt.test.ts が落ちる。
 */
export function isCustomerEmailRecipient(email: string | null | undefined): boolean {
  return /[^ ]/.test(email ?? '');
}

/** ISO 日時を JST の「2026年10月22日 20:30」に整形する（日本は夏時間が無いので +9 時間で正確）。 */
export function formatJstDateTime(iso: string): string {
  const d = new Date(isoToMs(iso) + 9 * 3_600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
