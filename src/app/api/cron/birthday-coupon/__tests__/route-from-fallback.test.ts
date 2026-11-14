/**
 * @jest-environment node
 *
 * birthday-coupon の送信元フォールバック専用テスト。
 *
 * 送信元は SSOT の `fromEnv()`（src/lib/email-from.ts）を【送信のたびに】呼んで解決する。
 * 以前のようなモジュールスコープの `const FROM = process.env.EMAIL_FROM || ...` は存在しない。
 * jest.setup.js が EMAIL_FROM を設定するため、ここでは送信直前に env を消して既定値へ倒れること、
 * および route を読み込んだ後に設定した env がそのまま使われる（＝読み込み時に固定されない）ことを確かめる。
 * resetModules + require は歴史的経緯で残している（再読込しても結果は変わらない）。
 */

const mockSendFallback = jest.fn().mockResolvedValue({ success: true });
const localMockFrom2 = jest.fn();

// モックはホイストされるため、最初に定義する
jest.mock('@/lib/cron-auth', () => ({ checkCronAuth: jest.fn(() => null) }));
jest.mock('@/lib/cron-logger', () => ({ logCronRun: jest.fn().mockResolvedValue(undefined), cronError: jest.fn().mockResolvedValue({ status: 500, json: async () => ({ error: 'Internal error' }) }) }));
jest.mock('@/lib/line', () => ({ sendLineText: jest.fn().mockResolvedValue(true) }));
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockSendFallback } })),
}));
jest.mock('@/lib/paginate', () => ({
  fetchAllPaged: jest.fn().mockResolvedValue({
    rows: [{ id: 'u-fall', email: 'fall@example.com', display_name: 'FallUser', email_unsubscribed: false }],
    error: null,
  }),
}));
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ from: (...args: any[]) => localMockFrom2(...args) })),
}));

localMockFrom2.mockImplementation((table: string) => {
  if (table === 'user_points') return { insert: jest.fn().mockResolvedValue({ error: null }) };
  if (table === 'line_user_links') return {
    select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ data: null }) }) }),
  };
  if (table === 'birthday_notifications') return {
    select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ in: jest.fn().mockResolvedValue({ data: [] }) }) }),
    insert: jest.fn().mockResolvedValue({ error: null }),
  };
  return {};
});

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  process.env.RESEND_API_KEY = 'resend-key';
  process.env.CRON_SECRET = 'cron-secret';
  process.env.NEXT_PUBLIC_SITE_URL = 'https://carelink-jp.com';
  delete process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK;
  // 時刻固定
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-06-15T03:00:00Z'));
});

afterAll(() => {
  jest.useRealTimers();
});

describe('birthday-coupon 送信元フォールバック（fromEnv・EMAIL_FROM 未設定時）', () => {
  test('EMAIL_FROM 未設定 → デフォルト差出人 CareLink <noreply@carelink-jp.com> でメール送信', async () => {
    delete process.env.EMAIL_FROM;
    jest.resetModules();

    // jest.resetModules() 後はモックが再設定必要（モジュールキャッシュが消えるため）。
    jest.mock('@/lib/cron-auth', () => ({ checkCronAuth: jest.fn(() => null) }));
    jest.mock('@/lib/cron-logger', () => ({ logCronRun: jest.fn().mockResolvedValue(undefined), cronError: jest.fn().mockResolvedValue({ status: 500, json: async () => ({ error: 'Internal error' }) }) }));
    jest.mock('@/lib/line', () => ({ sendLineText: jest.fn().mockResolvedValue(true) }));
    jest.mock('resend', () => ({
      Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockSendFallback } })),
    }));
    jest.mock('@/lib/paginate', () => ({
      fetchAllPaged: jest.fn().mockResolvedValue({
        rows: [{ id: 'u-fall', email: 'fall@example.com', display_name: 'FallUser', email_unsubscribed: false }],
        error: null,
      }),
    }));
    jest.mock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => ({ from: (...args: any[]) => localMockFrom2(...args) })),
    }));

    const { GET: freshGET } = require('../route');

    const req = new Request('http://localhost/api/cron/birthday-coupon', {
      method: 'GET',
      headers: { authorization: 'Bearer cron-secret' },
    });

    await freshGET(req as any);

    // EMAIL_FROM 未設定 → fromEnv() の既定値 'CareLink <noreply@carelink-jp.com>' でメール送信
    expect(mockSendFallback).toHaveBeenCalledWith(expect.objectContaining({
      from: 'CareLink <noreply@carelink-jp.com>',
    }));

    // 読み込み後に設定した EMAIL_FROM が次回の送信で使われる（読み込み時の固定値ではない）
    mockSendFallback.mockClear();
    process.env.EMAIL_FROM = 'CareLink Support <support@carelink-jp.com>';
    try {
      await freshGET(new Request('http://localhost/api/cron/birthday-coupon', {
        method: 'GET',
        headers: { authorization: 'Bearer cron-secret' },
      }) as any);
      expect(mockSendFallback).toHaveBeenCalledWith(expect.objectContaining({
        from: 'CareLink Support <support@carelink-jp.com>',
      }));
    } finally {
      delete process.env.EMAIL_FROM;
    }
  });
});
