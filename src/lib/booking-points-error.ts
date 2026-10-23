import { NextResponse } from 'next/server';
import { alertCaughtError } from './alert';
import { bookingRpcErrorCode } from './booking-rpc-error';
import { safeCaptureException } from './safe';

/**
 * 予約の状態変更・会計で、ポイントの台帳と照合できなかったときの応答（2026年10月23日）。
 *
 * bookings の status を書き換えると、DB のトリガ sync_booking_points（と台帳のガード
 * guard_user_point_ledger）がポイントの控除・付与・返還を同じトランザクションで処理する。台帳と予約が
 * 食い違っている予約（持ち主の分からない台帳行・分類されていない古い行・控除額の不一致など）では、
 * 推測で返還・付与しないよう、次のコードだけを投げて取り消す。
 *
 * 以前の /api/admin/booking-status・/api/admin/booking-checkout はこれを区別せず、店舗には
 * 500「更新に失敗しました」「会計の保存に失敗しました」としか出なかった（退会した会員のポイント利用予約が
 * 毎回これになっていた。DB 側は 20261023130000 で直した）。店舗には直せないので、409 で理由と
 * 問い合わせ先を伝え、運営には直す必要があることを通知する。
 */
export const BOOKING_POINTS_ERROR_CODES: readonly string[] = [
  'POINTS_AUTH_REQUIRED',
  'POINTS_INSUFFICIENT',
  'POINTS_LEGACY_RECONCILIATION_REQUIRED',
  'POINTS_LEDGER_IMMUTABLE',
  'INVALID_BOOKING_POINTS',
];

/** 応答の code。画面が文言ではなくこれで見分けられるようにする。 */
export const BOOKING_POINTS_CONFLICT_CODE = 'BOOKING_POINTS_RECONCILIATION_REQUIRED';

/** RPC のエラーがポイントの台帳との照合の失敗か（コードの完全一致。似た名前の別エラーは含めない）。 */
export function isBookingPointsError(message: unknown): boolean {
  return BOOKING_POINTS_ERROR_CODES.includes(bookingRpcErrorCode(message));
}

/**
 * 409 と店舗向けの案内を返し、運営へ通知する（店舗の操作では直らず、台帳の確認が要るため）。
 * 予約は何も変わっていない（トランザクションごと取り消されている）。
 */
export function bookingPointsConflict(tag: string, cause: unknown, route: string, userMessage: string): NextResponse {
  safeCaptureException(cause, tag);
  alertCaughtError(tag, cause, route);
  return NextResponse.json({ error: userMessage, code: BOOKING_POINTS_CONFLICT_CODE }, { status: 409 });
}
