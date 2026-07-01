/**
 * @jest-environment node
 *
 * birthday-coupon/route.ts 行23 の FROM 定数フォールバック専用テスト。
 * `const FROM = process.env.EMAIL_FROM || 'CareLink <noreply@carelink-jp.com>'`
 *
 * FROM はモジュールスコープ定数のため、EMAIL_FROM 未設定の状態でモジュールをロードする必要がある。
 * jest.setup.js は setupFiles で先に評価されて EMAIL_FROM を設定するため、
 * import（静的 ESM）では FROM が setupFiles 後に評価されてしまう。
 * jest.resetModules() + require() で明示的に再ロードし、EMAIL_FROM 未設定状態での評価を実現する。
 */

const mockSendFallback = jest.fn().mockResolvedValue({ success: true });
const localMockFrom2 = jest.fn();

// モックはホイストされるため、最初に定義する
jest.mock('@/lib/cron-auth', () => ({ checkCronAuth: jest.fn(() => null) }));
jest.mock('@/lib/cron-logger', () => ({ logCronRun: jest.fn().mockResolvedValue(undefined) }));
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

describe('birthday-coupon FROM 定数フォールバック（行23・EMAIL_FROM 未設定時）', () => {
  test('EMAIL_FROM 未設定 → デフォルト差出人 CareLink <noreply@carelink-jp.com> でメール送信', async () => {
    // jest.resetModules() で全モジュールキャッシュをクリアし、
    // EMAIL_FROM 未設定状態で route.ts を再 require する（FROM 定数の再評価）。
    delete process.env.EMAIL_FROM;
    jest.resetModules();

    // jest.resetModules() 後はモックが再設定必要（モジュールキャッシュが消えるため）。
    jest.mock('@/lib/cron-auth', () => ({ checkCronAuth: jest.fn(() => null) }));
    jest.mock('@/lib/cron-logger', () => ({ logCronRun: jest.fn().mockResolvedValue(undefined) }));
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

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { GET: freshGET } = require('../route');

    const req = new Request('http://localhost/api/cron/birthday-coupon', {
      method: 'GET',
      headers: { authorization: 'Bearer cron-secret' },
    });

    await freshGET(req as any);

    // EMAIL_FROM 未設定 → FROM = 'CareLink <noreply@carelink-jp.com>' でメール送信
    expect(mockSendFallback).toHaveBeenCalledWith(expect.objectContaining({
      from: 'CareLink <noreply@carelink-jp.com>',
    }));
  });
});
