/**
 * 予約の前払い（オンライン決済）を PAY.JP で受ける共通処理（2026年11月14日・Stripe から移行）。
 *
 * route.ts は HTTP メソッド以外を export できないため、金額の決定と DB 反映はここに置く。
 *   - 支払いの作成は /api/payment/charge（payjp.js が 3D セキュア付きで作ったトークンで即時に確定）。
 *   - 結果が分からないまま残った支払い・返金・チャージバックは /api/payjp/webhook がここで反映する。
 * 前払いは「近日公開」（src/lib/coming-soon.ts）で、利用者向けの導線はまだ無い。
 */
import type { createServiceRoleClient } from './supabase-server';

type Admin = ReturnType<typeof createServiceRoleClient>;

export type BookingPaymentType = 'full' | 'deposit';
export const BOOKING_PAYMENT_TYPES: readonly BookingPaymentType[] = ['full', 'deposit'];

export type DepositSetting = { deposit_type: string | null; deposit_amount: number | null };

/**
 * 支払う金額を DB の値だけから決める（利用者が送った金額は使わない）。
 * - 店舗が前払いを設定していない（deposit_type が none / 未設定）なら null＝受け付けない。
 * - full：予約金額（total_price）。
 * - deposit：fixed は deposit_amount（円）、percent は予約金額 × deposit_amount%（四捨五入）。
 * PAY.JP の下限（50 円）未満・上限超えも null。
 */
export function bookingPaymentAmount(totalPrice: number | null, setting: DepositSetting | null, type: BookingPaymentType): number | null {
  const depositType = setting?.deposit_type ?? 'none';
  if (depositType !== 'fixed' && depositType !== 'percent') return null;
  let amount: number;
  if (type === 'full') {
    amount = totalPrice ?? 0;
  } else if (depositType === 'fixed') {
    amount = setting?.deposit_amount ?? 0;
  } else {
    amount = Math.round(((totalPrice ?? 0) * (setting?.deposit_amount ?? 0)) / 100);
  }
  if (!Number.isInteger(amount) || amount < 50 || amount > 9_999_999) return null;
  return amount;
}

export type PaymentRow = { id: string; booking_id: string | null; amount: number; payment_type: string; status: string };

/**
 * 支払いが確定した行を paid にし、予約の支払い状態へ写す。冪等（すでに paid なら何もしない）。
 * デポジットは、仮予約（pending）のときだけ確定（confirmed）にする。失敗は throw。
 */
export async function markBookingPaymentPaid(admin: Admin, row: PaymentRow, chargeId: string): Promise<void> {
  const now = new Date().toISOString();
  const upd = await admin.from('booking_payjp_charges')
    .update({ status: 'paid', payjp_charge_id: chargeId, updated_at: now })
    .eq('id', row.id).eq('status', 'pending').select('id');
  if (upd.error) throw new Error(`booking_payjp_charges paid update failed: ${upd.error.message}`);
  if (!row.booking_id) return;
  const booking = await admin.from('bookings')
    .update({ payment_status: 'paid', paid_amount: row.amount })
    .eq('id', row.booking_id).select('id');
  if (booking.error) throw new Error(`bookings paid update failed: ${booking.error.message}`);
  if (!booking.data || booking.data.length === 0) throw new Error(`bookings paid update matched 0 rows (booking_id=${row.booking_id})`);
  if (row.payment_type === 'deposit') {
    const confirm = await admin.from('bookings')
      .update({ status: 'confirmed', updated_at: now })
      .eq('id', row.booking_id).eq('status', 'pending');
    if (confirm.error) throw new Error(`bookings deposit confirm failed: ${confirm.error.message}`);
  }
}

export type ChargeEvent = { type: string; data: Record<string, unknown> };
export type ChargeApplyOutcome = 'applied' | 'ignored';

const PAYMENT_ROW_COLUMNS = 'id, booking_id, amount, payment_type, status';

async function rowByChargeId(admin: Admin, chargeId: string): Promise<PaymentRow | null> {
  const { data, error } = await admin.from('booking_payjp_charges').select(PAYMENT_ROW_COLUMNS).eq('payjp_charge_id', chargeId).maybeSingle();
  if (error) throw new Error(`booking_payjp_charges lookup failed: ${error.message}`);
  return data;
}

async function setStatus(admin: Admin, row: PaymentRow, status: 'refunded' | 'partial_refund' | 'disputed', refundAmount?: number): Promise<void> {
  const payload: { status: string; updated_at: string; refund_amount?: number } = { status, updated_at: new Date().toISOString() };
  if (refundAmount !== undefined) payload.refund_amount = refundAmount;
  const upd = await admin.from('booking_payjp_charges').update(payload).eq('id', row.id);
  if (upd.error) throw new Error(`booking_payjp_charges ${status} update failed: ${upd.error.message}`);
  if (!row.booking_id) return;
  const booking = await admin.from('bookings').update({ payment_status: status }).eq('id', row.booking_id);
  if (booking.error) throw new Error(`bookings ${status} update failed: ${booking.error.message}`);
}

/**
 * チャージバック（dispute.created）の対象支払い ID を取り出す。
 * PAY.JP の公式リファレンスには dispute オブジェクトの項目が載っていない（2026年11月14日に確認）ため、
 * 考えられる形をすべて受ける：charge が ID 文字列／charge が支払いオブジェクト（id を持つ）／charge_id。
 * どれも ch_ で始まる ID だけを採る。
 */
export function disputeChargeId(data: Record<string, unknown>): string | null {
  const charge = data.charge;
  const candidates = [
    charge,
    charge && typeof charge === 'object' ? (charge as Record<string, unknown>).id : undefined,
    data.charge_id,
  ];
  for (const c of candidates) if (typeof c === 'string' && c.startsWith('ch_')) return c;
  return null;
}

/**
 * charge.succeeded / charge.refunded / dispute.created を予約の支払いへ反映する。
 * 定期課金（広告枠・有料オプション）の支払いなど、予約の支払いでないものは 'ignored'。
 */
export async function applyBookingChargeEvent(admin: Admin, event: ChargeEvent): Promise<ChargeApplyOutcome> {
  const data = event.data;
  if (event.type === 'charge.succeeded') {
    const metadata = (data.metadata && typeof data.metadata === 'object' ? data.metadata : {}) as Record<string, unknown>;
    if (typeof metadata.payment_id !== 'string' || typeof data.id !== 'string') return 'ignored';
    const { data: row, error } = await admin.from('booking_payjp_charges').select(PAYMENT_ROW_COLUMNS).eq('id', metadata.payment_id).maybeSingle();
    if (error) throw new Error(`booking_payjp_charges lookup failed: ${error.message}`);
    if (!row) throw new Error(`no booking payment ${metadata.payment_id} for PAY.JP charge ${data.id}`);
    if (row.status !== 'pending') return 'ignored';
    await markBookingPaymentPaid(admin, row, data.id);
    return 'applied';
  }
  if (event.type === 'charge.refunded') {
    if (typeof data.id !== 'string') return 'ignored';
    const row = await rowByChargeId(admin, data.id);
    if (!row) return 'ignored';
    const refunded = typeof data.amount_refunded === 'number' ? data.amount_refunded : 0;
    await setStatus(admin, row, refunded >= row.amount ? 'refunded' : 'partial_refund', refunded);
    return 'applied';
  }
  if (event.type === 'dispute.created') {
    const chargeId = disputeChargeId(data);
    if (!chargeId) return 'ignored';
    const row = await rowByChargeId(admin, chargeId);
    if (!row) return 'ignored';
    await setStatus(admin, row, 'disputed');
    return 'applied';
  }
  return 'ignored';
}
