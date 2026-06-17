/**
 * キャンセル料 Stripe Checkout
 * POST /api/booking/[id]/cancel-fee
 *
 * 【現在無効（非表示）】
 * 旧実装は存在しないテーブル `cancellation_policies` と列 `bookings.menu_name` を
 * 参照しており動作不能（PostgREST 400）だった。UI からの呼び出しも存在しない。
 * 料金ポリシーの仕様が未確定のため、機能自体を無効化して非表示にする。
 *
 * 再有効化する場合は実スキーマに合わせて以下に対応すること:
 *   - テーブル: `facility_cancel_policies`
 *     (free_cancel_hours / late_cancel_rate / no_show_rate / policy_text)
 *   - 予約日時は bookings.booking_date + start_time から算出
 *   - 料金マッピング規則（no_show_rate の適用条件等）を確定してから実装
 */

import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    { error: 'この機能は現在ご利用いただけません' },
    { status: 404 }
  );
}
