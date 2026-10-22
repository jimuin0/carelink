/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: jest.fn() }));

import { getFacilityNotificationSettings, DEFAULT_NOTIFICATION_FLAGS } from '@/lib/notification-settings';
import { createServiceRoleClient } from '@/lib/supabase-server';

const mockCreate = createServiceRoleClient as jest.MockedFunction<typeof createServiceRoleClient>;

function clientReturning(data: unknown, opts: { throws?: boolean; error?: unknown } = {}) {
  if (opts.throws) {
    return { from: jest.fn(() => { throw new Error('db down'); }) } as unknown as ReturnType<typeof createServiceRoleClient>;
  }
  return {
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          maybeSingle: jest.fn().mockResolvedValue({ data, error: opts.error ?? null }),
        }),
      }),
    }),
  } as unknown as ReturnType<typeof createServiceRoleClient>;
}

describe('getFacilityNotificationSettings', () => {
  it('行が無い施設 → デフォルト（後方互換・無条件送信相当）', async () => {
    mockCreate.mockReturnValue(clientReturning(null));
    expect(await getFacilityNotificationSettings('f1')).toEqual(DEFAULT_NOTIFICATION_FLAGS);
  });

  it('保存済みの値を camelCase で返す', async () => {
    mockCreate.mockReturnValue(clientReturning({
      push_on_new_booking: false,
      push_on_cancel: false,
      push_on_review: true,
      email_on_review: false,
      email_daily_summary: true,
      email_weekly_report: false,
    }));
    expect(await getFacilityNotificationSettings('f1')).toEqual({
      pushOnNewBooking: false,
      pushOnCancel: false,
      pushOnReview: true,
      emailOnReview: false,
      emailDailySummary: true,
      emailWeeklyReport: false,
    });
  });

  it('列が null の場合は各デフォルトで埋める', async () => {
    mockCreate.mockReturnValue(clientReturning({
      push_on_new_booking: null,
      push_on_cancel: null,
      push_on_review: null,
      email_on_review: true,
      email_daily_summary: null,
      email_weekly_report: null,
    }));
    expect(await getFacilityNotificationSettings('f1')).toEqual(DEFAULT_NOTIFICATION_FLAGS);
  });

  // E22: 口コミのメールは push_on_review に相乗りしない（Push を切ってもメールは届く）。
  it('口コミの Push とメールは別々の設定として返す', async () => {
    mockCreate.mockReturnValue(clientReturning({
      push_on_new_booking: true, push_on_cancel: true, push_on_review: false, email_on_review: true,
      email_daily_summary: false, email_weekly_report: true,
    }));
    expect(await getFacilityNotificationSettings('f1')).toEqual(expect.objectContaining({ pushOnReview: false, emailOnReview: true }));
    expect(DEFAULT_NOTIFICATION_FLAGS.emailOnReview).toBe(true);
  });

  it('email_on_review が欠けた応答（列未適用など）は「メール ON」と取り違えない', async () => {
    mockCreate.mockReturnValue(clientReturning({
      push_on_new_booking: true, push_on_cancel: true, push_on_review: true,
      email_daily_summary: false, email_weekly_report: true,
    }));
    await expect(getFacilityNotificationSettings('f1')).rejects.toThrow('settings response invalid');
  });

  it('取得失敗（例外）は送信許可へ変換しない', async () => {
    mockCreate.mockReturnValue(clientReturning(null, { throws: true }));
    await expect(getFacilityNotificationSettings('f1')).rejects.toThrow('db down');
  });

  it.each([null, { push_on_new_booking: true }])('resolved DB error with data %p never allows delivery', async (data) => {
    mockCreate.mockReturnValue(clientReturning(data, { error: { message: 'connection timeout' } }));
    await expect(getFacilityNotificationSettings('f1')).rejects.toThrow('settings read failed');
  });

  it.each([undefined, {}, [], false, { push_on_review: 'false' }])('malformed response %p never becomes missing settings', async (data) => {
    mockCreate.mockReturnValue(clientReturning(data));
    await expect(getFacilityNotificationSettings('f1')).rejects.toThrow('settings response invalid');
  });

  it('a string boolean cannot permit a disabled notification', async () => {
    mockCreate.mockReturnValue(clientReturning({
      push_on_new_booking: false, push_on_cancel: false, push_on_review: 'false', email_on_review: false,
      email_daily_summary: false, email_weekly_report: false,
    }));
    await expect(getFacilityNotificationSettings('f1')).rejects.toThrow('settings response invalid');
  });
});
