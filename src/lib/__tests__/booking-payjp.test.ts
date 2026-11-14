/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { applyBookingChargeEvent, bookingPaymentAmount, markBookingPaymentPaid, type PaymentRow } from '../booking-payjp';
import { createFakeSupabase, eqOf, type FakeCall, type FakeResult } from '@/test-utils/fake-supabase';

type Db = ReturnType<typeof createFakeSupabase>;
const admin = (db: Db) => db.client as never;
const ROW: PaymentRow = { id: 'p1', booking_id: 'b1', amount: 5000, payment_type: 'full', status: 'pending' };

describe('bookingPaymentAmount', () => {
  test('店舗が前払いを設定していなければ受け付けない', () => {
    expect(bookingPaymentAmount(5000, null, 'full')).toBeNull();
    expect(bookingPaymentAmount(5000, { deposit_type: 'none', deposit_amount: 1000 }, 'full')).toBeNull();
    expect(bookingPaymentAmount(5000, { deposit_type: null, deposit_amount: null }, 'deposit')).toBeNull();
  });
  test('full は予約金額', () => {
    expect(bookingPaymentAmount(5000, { deposit_type: 'fixed', deposit_amount: 1000 }, 'full')).toBe(5000);
    expect(bookingPaymentAmount(null, { deposit_type: 'fixed', deposit_amount: 1000 }, 'full')).toBeNull();
  });
  test('deposit の fixed は円額・percent は割合（四捨五入）', () => {
    expect(bookingPaymentAmount(5000, { deposit_type: 'fixed', deposit_amount: 1000 }, 'deposit')).toBe(1000);
    expect(bookingPaymentAmount(5000, { deposit_type: 'fixed', deposit_amount: null }, 'deposit')).toBeNull();
    expect(bookingPaymentAmount(3333, { deposit_type: 'percent', deposit_amount: 30 }, 'deposit')).toBe(1000);
    expect(bookingPaymentAmount(null, { deposit_type: 'percent', deposit_amount: 30 }, 'deposit')).toBeNull();
    expect(bookingPaymentAmount(5000, { deposit_type: 'percent', deposit_amount: null }, 'deposit')).toBeNull();
  });
  test('PAY.JP の範囲（50〜9,999,999 円）外は受け付けない', () => {
    expect(bookingPaymentAmount(49, { deposit_type: 'fixed', deposit_amount: 1 }, 'full')).toBeNull();
    expect(bookingPaymentAmount(10_000_000, { deposit_type: 'fixed', deposit_amount: 1 }, 'full')).toBeNull();
    expect(bookingPaymentAmount(50, { deposit_type: 'fixed', deposit_amount: 1 }, 'full')).toBe(50);
  });
});

describe('markBookingPaymentPaid', () => {
  function make(opts: Partial<Record<'row' | 'booking' | 'confirm', FakeResult>> = {}) {
    return createFakeSupabase((c: FakeCall) => {
      if (c.table === 'booking_payjp_charges') return opts.row;
      if ((c.payload as { status?: string }).status === 'confirmed') return opts.confirm;
      return opts.booking ?? { data: [{ id: 'b1' }] };
    });
  }
  test('行を paid にし、予約の支払い状態と金額を写す（full は予約の状態を変えない）', async () => {
    const db = make();
    await markBookingPaymentPaid(admin(db), ROW, 'ch_1');
    expect(db.calls[0].payload).toMatchObject({ status: 'paid', payjp_charge_id: 'ch_1' });
    expect(eqOf(db.calls[0], 'status')).toBe('pending');
    expect(db.calls[1].payload).toEqual({ payment_status: 'paid', paid_amount: 5000 });
    expect(db.calls).toHaveLength(2);
  });
  test('deposit は仮予約だけ確定にする', async () => {
    const db = make();
    await markBookingPaymentPaid(admin(db), { ...ROW, payment_type: 'deposit' }, 'ch_1');
    expect(db.calls[2].payload).toMatchObject({ status: 'confirmed' });
    expect(eqOf(db.calls[2], 'status')).toBe('pending');
  });
  test('予約に紐づかない行は予約を触らない', async () => {
    const db = make();
    await markBookingPaymentPaid(admin(db), { ...ROW, booking_id: null }, 'ch_1');
    expect(db.calls).toHaveLength(1);
  });
  test.each([
    ['行の更新', { row: { error: { message: 'x' } } }, /booking_payjp_charges paid/],
    ['予約の更新', { booking: { error: { message: 'x' } } }, /bookings paid update failed/],
    ['予約が無い', { booking: { data: [] } }, /matched 0 rows/],
    ['予約が null', { booking: { data: null } }, /matched 0 rows/],
  ])('%sの失敗は throw', async (_l, opts, re) => {
    await expect(markBookingPaymentPaid(admin(make(opts as never)), ROW, 'ch_1')).rejects.toThrow(re);
  });
  test('デポジットの確定に失敗したら throw', async () => {
    await expect(markBookingPaymentPaid(admin(make({ confirm: { error: { message: 'x' } } })), { ...ROW, payment_type: 'deposit' }, 'ch_1')).rejects.toThrow(/deposit confirm/);
  });
});

describe('applyBookingChargeEvent', () => {
  function make(opts: Partial<Record<'byId' | 'byCharge' | 'update' | 'booking', FakeResult>> = {}) {
    return createFakeSupabase((c: FakeCall) => {
      if (c.table === 'bookings') return opts.booking ?? { data: [{ id: 'b1' }] };
      if (c.op === 'update') return opts.update;
      if (eqOf(c, 'id') !== undefined) return opts.byId ?? { data: ROW };
      return opts.byCharge ?? { data: { ...ROW, status: 'paid' } };
    });
  }
  test('対象外のイベントは無視', async () => {
    expect(await applyBookingChargeEvent(admin(make()), { type: 'charge.failed', data: {} })).toBe('ignored');
  });
  test('charge.succeeded: payment_id の無い支払い（定期課金など）は無視', async () => {
    const db = make();
    expect(await applyBookingChargeEvent(admin(db), { type: 'charge.succeeded', data: { id: 'ch_1', metadata: null } })).toBe('ignored');
    expect(await applyBookingChargeEvent(admin(db), { type: 'charge.succeeded', data: { metadata: { payment_id: 'p1' } } })).toBe('ignored');
    expect(db.calls).toHaveLength(0);
  });
  test('charge.succeeded: 結果不明で残った pending を paid にする', async () => {
    const db = make();
    expect(await applyBookingChargeEvent(admin(db), { type: 'charge.succeeded', data: { id: 'ch_1', metadata: { payment_id: 'p1' } } })).toBe('applied');
    expect(db.calls[1].payload).toMatchObject({ status: 'paid', payjp_charge_id: 'ch_1' });
  });
  test('charge.succeeded: 反映済みなら何もしない', async () => {
    const db = make({ byId: { data: { ...ROW, status: 'paid' } } });
    expect(await applyBookingChargeEvent(admin(db), { type: 'charge.succeeded', data: { id: 'ch_1', metadata: { payment_id: 'p1' } } })).toBe('ignored');
  });
  test('charge.succeeded: 読み取り失敗・行が無いのは throw', async () => {
    const ev = { type: 'charge.succeeded', data: { id: 'ch_1', metadata: { payment_id: 'p1' } } };
    await expect(applyBookingChargeEvent(admin(make({ byId: { error: { message: 'x' } } })), ev)).rejects.toThrow(/lookup failed/);
    await expect(applyBookingChargeEvent(admin(make({ byId: { data: null } })), ev)).rejects.toThrow(/no booking payment/);
  });
  test('charge.refunded: 全額は refunded・一部は partial_refund（予約にも写す）', async () => {
    let db = make();
    expect(await applyBookingChargeEvent(admin(db), { type: 'charge.refunded', data: { id: 'ch_1', amount_refunded: 5000 } })).toBe('applied');
    expect(db.calls[1].payload).toMatchObject({ status: 'refunded', refund_amount: 5000 });
    expect(db.calls[2].payload).toEqual({ payment_status: 'refunded' });
    db = make();
    await applyBookingChargeEvent(admin(db), { type: 'charge.refunded', data: { id: 'ch_1', amount_refunded: 1000 } });
    expect(db.calls[1].payload).toMatchObject({ status: 'partial_refund', refund_amount: 1000 });
    db = make();
    await applyBookingChargeEvent(admin(db), { type: 'charge.refunded', data: { id: 'ch_1' } });
    expect(db.calls[1].payload).toMatchObject({ status: 'partial_refund', refund_amount: 0 });
  });
  test('charge.refunded: 予約の支払いでない・ID が無いものは無視、読み取り失敗は throw', async () => {
    expect(await applyBookingChargeEvent(admin(make({ byCharge: { data: null } })), { type: 'charge.refunded', data: { id: 'ch_x' } })).toBe('ignored');
    expect(await applyBookingChargeEvent(admin(make()), { type: 'charge.refunded', data: {} })).toBe('ignored');
    await expect(applyBookingChargeEvent(admin(make({ byCharge: { error: { message: 'x' } } })), { type: 'charge.refunded', data: { id: 'ch_1' } })).rejects.toThrow(/lookup failed/);
  });
  test('dispute.created: disputed にする（予約に紐づかない行は予約を触らない）', async () => {
    let db = make();
    expect(await applyBookingChargeEvent(admin(db), { type: 'dispute.created', data: { charge: 'ch_1' } })).toBe('applied');
    expect(db.calls[1].payload).toMatchObject({ status: 'disputed' });
    expect(db.calls[1].payload).not.toHaveProperty('refund_amount');
    expect(db.calls[2].payload).toEqual({ payment_status: 'disputed' });
    db = make({ byCharge: { data: { ...ROW, booking_id: null } } });
    await applyBookingChargeEvent(admin(db), { type: 'dispute.created', data: { charge: 'ch_1' } });
    expect(db.calls).toHaveLength(2);
  });
  test('dispute.created: charge が無い・該当なしは無視', async () => {
    expect(await applyBookingChargeEvent(admin(make()), { type: 'dispute.created', data: {} })).toBe('ignored');
    expect(await applyBookingChargeEvent(admin(make({ byCharge: { data: null } })), { type: 'dispute.created', data: { charge: 'ch_1' } })).toBe('ignored');
  });
  test('状態の更新失敗は throw', async () => {
    await expect(applyBookingChargeEvent(admin(make({ update: { error: { message: 'x' } } })), { type: 'dispute.created', data: { charge: 'ch_1' } })).rejects.toThrow(/disputed update failed/);
    await expect(applyBookingChargeEvent(admin(make({ booking: { error: { message: 'x' } } })), { type: 'dispute.created', data: { charge: 'ch_1' } })).rejects.toThrow(/bookings disputed/);
  });
});
