/**
 * @jest-environment node
 */
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: jest.fn() }));

import { getFacilityNotificationSettings, DEFAULT_NOTIFICATION_FLAGS } from '@/lib/notification-settings';
import { createServiceRoleClient } from '@/lib/supabase-server';

const mockCreate = createServiceRoleClient as jest.MockedFunction<typeof createServiceRoleClient>;

function clientReturning(data: unknown, opts: { throws?: boolean } = {}) {
  if (opts.throws) {
    return { from: jest.fn(() => { throw new Error('db down'); }) } as unknown as ReturnType<typeof createServiceRoleClient>;
  }
  return {
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          maybeSingle: jest.fn().mockResolvedValue({ data }),
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
      email_daily_summary: true,
      email_weekly_report: false,
    }));
    expect(await getFacilityNotificationSettings('f1')).toEqual({
      pushOnNewBooking: false,
      pushOnCancel: false,
      pushOnReview: true,
      emailDailySummary: true,
      emailWeeklyReport: false,
    });
  });

  it('列が null の場合は各デフォルトで埋める', async () => {
    mockCreate.mockReturnValue(clientReturning({
      push_on_new_booking: null,
      push_on_cancel: null,
      push_on_review: null,
      email_daily_summary: null,
      email_weekly_report: null,
    }));
    expect(await getFacilityNotificationSettings('f1')).toEqual(DEFAULT_NOTIFICATION_FLAGS);
  });

  it('取得失敗（例外）→ デフォルトにフォールバック', async () => {
    mockCreate.mockReturnValue(clientReturning(null, { throws: true }));
    expect(await getFacilityNotificationSettings('f1')).toEqual(DEFAULT_NOTIFICATION_FLAGS);
  });
});
