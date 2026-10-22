import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  cancelFeeContextSchema, cancelFeeFromContext, cancelPolicySnapshotSchema, readCancelFeeReceipt, formatJstDateTime, isoToMs,
  isCustomerEmailRecipient,
} from '@/lib/cancel-fee-receipt';

// 2030-01-07 10:00 JST に始まる 5,000 円の予約を、開始 3 時間前（07:00 JST = 2030-01-06T22:00Z）に取り消した材料。
// capturedAt は PostgreSQL が jsonb に書くのと同じマイクロ秒つきの形。
const context = {
  policy: { free_cancel_hours: 24, late_cancel_rate: 50, cancel_rule: 'free_window' },
  totalPrice: 5000, bookingDate: '2030-01-07', startTime: '10:00:00', capturedAt: '2030-01-06T22:00:00.123456+00:00',
};

describe('cancelPolicySnapshotSchema / cancelFeeContextSchema', () => {
  it('cancel_rule の無い旧い snapshot（20261023020000 より前に積まれたメール）も読める', () => {
    expect(cancelPolicySnapshotSchema.parse({ free_cancel_hours: 24, late_cancel_rate: 50 }))
      .toEqual({ free_cancel_hours: 24, late_cancel_rate: 50 });
    expect(cancelPolicySnapshotSchema.parse({ free_cancel_hours: 24, late_cancel_rate: 50, cancel_rule: null }))
      .toEqual({ free_cancel_hours: 24, late_cancel_rate: 50, cancel_rule: null });
  });

  it('DB の CHECK 制約に無いルールは受け付けない（金額を推測しない）', () => {
    expect(cancelPolicySnapshotSchema.safeParse({ free_cancel_hours: 24, late_cancel_rate: 50, cancel_rule: 'never' }).success).toBe(false);
  });

  it.each([
    ['日付が実在しない', { bookingDate: '2030-02-30' }],
    ['時刻が不正', { startTime: '25:00' }],
    ['受付時刻にオフセットが無い形式でない', { capturedAt: 'yesterday' }],
    ['金額が文字列', { totalPrice: '5000' }],
  ])('%s → 不正', (_label, patch) => {
    expect(cancelFeeContextSchema.safeParse({ ...context, ...patch }).success).toBe(false);
  });
});

describe('cancelFeeFromContext', () => {
  it('キャンセルを受け付けた時刻（capturedAt）時点の残り時間で算出する（ここでは 3 時間前＝期限後）', () => {
    expect(cancelFeeFromContext(cancelFeeContextSchema.parse(context))).toEqual({ fee: 2500, rate: 50, isLate: true });
  });

  it('同じ材料でも無料期限の前に受け付けていれば 0', () => {
    expect(cancelFeeFromContext(cancelFeeContextSchema.parse({ ...context, capturedAt: '2030-01-05T00:00:00Z' })))
      .toEqual({ fee: 0, rate: 50, isLate: false });
  });

  it('ポリシーの無い店舗は 0', () => {
    expect(cancelFeeFromContext(cancelFeeContextSchema.parse({ ...context, policy: null }))).toEqual({ fee: 0, rate: 0, isLate: false });
  });
});

describe('readCancelFeeReceipt（管理画面の予約詳細）', () => {
  it('保存された材料からお客様へ通知した金額と受付時刻を返す', () => {
    expect(readCancelFeeReceipt(context)).toEqual({ fee: 2500, rate: 50, cancelledAt: context.capturedAt });
  });

  it.each([null, undefined, {}, 'text', { ...context, policy: { free_cancel_hours: 'x' } }])('材料が無い・崩れている %j → null', (raw) => {
    expect(readCancelFeeReceipt(raw)).toBeNull();
  });
});

describe('isCustomerEmailRecipient（お客様へキャンセル料をメールでお知らせしたか）', () => {
  it.each([
    ['customer@example.invalid', true], [' customer@example.invalid ', true],
    [null, false], [undefined, false], ['', false], ['   ', false],
  ])('%j → %s', (email, expected) => {
    expect(isCustomerEmailRecipient(email)).toBe(expected);
  });

  // 店舗宛メール・管理画面の文言は、お客様宛のキャンセル通知が積まれたかをこの関数で言い分ける。
  // 積む側（SQL）の条件だけが変わると「お知らせしています」が事実と食い違うので、条件の一致を固定する。
  it('お客様を宛先に加える SQL の条件（最新の publish_customer_booking_transition_email）と同じ', () => {
    const dir = join(process.cwd(), 'supabase/migrations');
    const definitions = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
      .filter((f) => readFileSync(join(dir, f), 'utf8').includes('CREATE OR REPLACE FUNCTION public.publish_customer_booking_transition_email('));
    expect(definitions.length).toBeGreaterThan(0);
    const sql = readFileSync(join(dir, definitions[definitions.length - 1]), 'utf8').replace(/\s+/g, ' ');
    expect(sql).toContain("SELECT 'customer'::text AS role,b.email AS email WHERE nullif(btrim(b.email),'') IS NOT NULL");
  });
});

describe('formatJstDateTime', () => {
  it('JST の日時で表示する（UTC では前日でも JST の日付になる）', () => {
    expect(formatJstDateTime('2026-10-22T11:30:00Z')).toBe('2026年10月22日 20:30');
    expect(formatJstDateTime('2026-10-22T15:05:59.999+00:00')).toBe('2026年10月23日 00:05');
    expect(formatJstDateTime('2026-10-23T09:07:00+09:00')).toBe('2026年10月23日 09:07');
  });
});

describe('isoToMs', () => {
  it('PostgreSQL のマイクロ秒つき timestamptz をミリ秒までで読む', () => {
    expect(isoToMs('2030-01-06T22:00:00.123456+00:00')).toBe(Date.UTC(2030, 0, 6, 22, 0, 0, 123));
    expect(isoToMs('2030-01-07T07:00:00.5+09:00')).toBe(Date.UTC(2030, 0, 6, 22, 0, 0, 500));
    expect(isoToMs('2030-01-06T22:00:00Z')).toBe(Date.UTC(2030, 0, 6, 22, 0, 0));
  });

  it('マイクロ秒を Date.parse が読めない環境でも同じ値になる（小数部を 3 桁に落としてから読む）', () => {
    const parse = jest.spyOn(Date, 'parse');
    isoToMs('2030-01-06T22:00:00.123456+00:00');
    expect(parse).toHaveBeenCalledWith('2030-01-06T22:00:00.123+00:00');
    parse.mockRestore();
  });
});
