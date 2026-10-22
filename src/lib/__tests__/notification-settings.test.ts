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

  it('email_on_review が欠けた応答（エラーを伴わない想定外の形）は「メール ON」と取り違えない', async () => {
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

  // migration 20261023100000 より先にアプリがデプロイされた場合（Vercel は main へのマージで自動デプロイ）。
  // 列が無いだけで設定の読み取りが失敗すると、この変更と無関係の口コミ Push まで止まっていた（レビュー指摘）。
  describe('email_on_review 列がまだ無い DB（migration 未適用）', () => {
    const missingColumn = { code: '42703', message: 'column facility_notification_settings.email_on_review does not exist' };
    const LEGACY_ROW = { push_on_new_booking: false, push_on_cancel: true, push_on_review: true, email_daily_summary: null, email_weekly_report: false };

    function clientSequence(results: { data: unknown; error: unknown }[]) {
      const selected: string[] = [];
      const client = {
        from: jest.fn(() => ({
          select: jest.fn((columns: string) => {
            selected.push(columns);
            return { eq: jest.fn(() => ({ maybeSingle: jest.fn(async () => results.shift()) })) };
          }),
        })),
      } as unknown as ReturnType<typeof createServiceRoleClient>;
      return { client, selected };
    }

    beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => {}));
    afterEach(() => jest.restoreAllMocks());

    it('列を除いて読み直し、口コミ Push などは保存値のまま・口コミのメールは既定（ON）で返す', async () => {
      const { client, selected } = clientSequence([{ data: null, error: missingColumn }, { data: LEGACY_ROW, error: null }]);
      mockCreate.mockReturnValue(client);
      expect(await getFacilityNotificationSettings('f1')).toEqual({
        pushOnNewBooking: false, pushOnCancel: true, pushOnReview: true, emailOnReview: true,
        emailDailySummary: false, emailWeeklyReport: false,
      });
      expect(selected).toHaveLength(2);
      expect(selected[0]).toContain('email_on_review');
      expect(selected[1]).not.toContain('email_on_review');
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('facility_notification_settings.email_on_review'));
    });

    it('PostgREST のスキーマキャッシュ由来（PGRST204）でも同じく読み直す', async () => {
      mockCreate.mockReturnValue(clientSequence([{ data: null, error: { code: 'PGRST204' } }, { data: null, error: null }]).client);
      expect(await getFacilityNotificationSettings('f1')).toEqual(DEFAULT_NOTIFICATION_FLAGS);
    });

    it('読み直しも失敗したら送信を許可しない', async () => {
      mockCreate.mockReturnValue(clientSequence([{ data: null, error: missingColumn }, { data: null, error: { message: 'timeout' } }]).client);
      await expect(getFacilityNotificationSettings('f1')).rejects.toThrow('settings read failed');
    });

    it('読み直した応答が不正なら送信を許可しない', async () => {
      mockCreate.mockReturnValue(clientSequence([{ data: null, error: missingColumn }, { data: { ...LEGACY_ROW, push_on_review: 'false' }, error: null }]).client);
      await expect(getFacilityNotificationSettings('f1')).rejects.toThrow('settings response invalid');
    });

    it('列の不在以外のエラーでは読み直さない（従来どおり送信を許可しない）', async () => {
      const { client, selected } = clientSequence([{ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }]);
      mockCreate.mockReturnValue(client);
      await expect(getFacilityNotificationSettings('f1')).rejects.toThrow('settings read failed');
      expect(selected).toHaveLength(1);
    });
  });
});
