/**
 * @jest-environment node
 *
 * Tests for GET /api/cron/booking-reminder（多段リマインダー版）
 * Key assertions:
 *   - CRON_SECRET validation
 *   - JST 対象日算出（1日後/3日後/7日後）
 *   - 設定（facility_reminder_settings）・エンタイトルメント（facility_entitlements）による送信ゲート
 *   - メール（1d 無料無条件 / 7d 無料設定 / 3d 有料）・LINE（3d/7d 有料）
 *   - Idempotency via sent_reminders (booking_id, reminder_date, kind)
 *   - Race condition handling（upsert(ignoreDuplicates).select() の戻り件数による原子的 CAS 判定）
 *   - 実時間予算ガード（deferred）
 */

jest.mock('@/lib/cron-auth');
jest.mock('@/lib/supabase-server');
jest.mock('@/lib/cron-logger');
jest.mock('@/lib/email');
jest.mock('@/lib/line');
jest.mock('@sentry/nextjs', () => ({
  captureException: jest.fn(),
}), { virtual: true });

import { checkCronAuth } from '@/lib/cron-auth';
import { logCronRun } from '@/lib/cron-logger';
import { GET } from '../route';

// システム時刻 2026-05-15T00:00:00Z = JST 2026-05-15 09:00 → 対象日:
const D1 = '2026-05-16'; // 前日リマインド対象（明日）
const D3 = '2026-05-18'; // 3日前リマインド対象
const D7 = '2026-05-22'; // 7日前リマインド対象

type Booking = {
  id: string; customer_name: string | null; email: string | null;
  booking_date: string; start_time: string; end_time: string;
  facility_id: string; total_price: number | null;
  user_id: string | null; menu_id: string | null;
};

function booking(over: Partial<Booking> = {}): Booking {
  return {
    id: `bk-${Math.abs(JSON.stringify(over).split('').reduce((a, c) => a + c.charCodeAt(0), 0))}-${over.id ?? ''}`,
    customer_name: 'Customer',
    email: 'customer@example.com',
    booking_date: D1,
    start_time: '10:00',
    end_time: '11:00',
    facility_id: 'fac-0',
    total_price: 5000,
    user_id: null,
    menu_id: null,
    ...over,
  };
}

type Cfg = {
  bookings?: { data: Booking[]; error?: unknown };
  facilities?: { data: { id: string; name: string | null }[] | null };
  settings?: { data: Record<string, unknown>[] | null; error?: unknown };
  entitlements?: { data: { facility_id: string; option_key: string }[] | null; error?: unknown };
  lineLinks?: { data: { id: string | null; line_user_id: string | null }[] | null; error?: unknown };
  menus?: { data: { id: string; name: string }[] | null; error?: unknown };
  upsertError?: unknown;
  deleteError?: unknown;
  /**
   * upsert(ignoreDuplicates).select('sent_at') の戻り data。
   * 既定 undefined = 1 行返る（claim 勝ち）。[] = 0 行（claim 負け）。null = 防御的 OR 分岐。
   */
  claimSelectData?: { sent_at: string }[] | null;
};

let mockUpsert: jest.Mock;
let mockDelete: jest.Mock;
let mockEmailReminder: jest.Mock;
let mockLineReminder: jest.Mock;
let bookingsInMock: jest.Mock;

function setup(cfg: Cfg = {}) {
  (checkCronAuth as jest.Mock).mockReturnValue(null);
  (logCronRun as jest.Mock).mockResolvedValue(undefined);

  const bookingsData = cfg.bookings?.data ?? [booking({ id: 'a' }), booking({ id: 'b', facility_id: 'fac-1' })];
  const bookingsError = cfg.bookings?.error ?? null;

  bookingsInMock = jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      order: jest.fn().mockReturnValue({
        range: jest.fn().mockImplementation((from: number, to: number) =>
          Promise.resolve(bookingsError
            ? { data: null, error: bookingsError }
            : { data: bookingsData.slice(from, to + 1), error: null })),
      }),
    }),
  });

  // upsert(...).select('sent_at') → 実際に INSERT された行のみ返る（PostgREST 仕様）。
  // 既定は 1 行（claim 勝ち）。cfg.claimSelectData で上書き可能（[] = 負け、null = 防御的分岐）。
  const claimSelectData = cfg.claimSelectData === undefined
    ? [{ sent_at: new Date().toISOString() }]
    : cfg.claimSelectData;
  mockUpsert = jest.fn().mockReturnValue({
    select: jest.fn().mockImplementation(() => Promise.resolve(
      cfg.upsertError
        ? { data: null, error: cfg.upsertError }
        : { data: claimSelectData, error: null },
    )),
  });
  // F-9 根治: 送信失敗時の claim 解放 .delete().eq().eq().eq() → { error }。
  mockDelete = jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: cfg.deleteError ?? null }),
      }),
    }),
  });

  const { createServiceRoleClient } = require('@/lib/supabase-server');
  createServiceRoleClient.mockReturnValue({
    from: jest.fn((table: string) => {
      if (table === 'bookings') {
        return { select: jest.fn().mockReturnValue({ in: bookingsInMock }) };
      }
      if (table === 'facility_profiles') {
        return {
          select: jest.fn().mockReturnValue({
            in: jest.fn().mockResolvedValue({ data: cfg.facilities?.data === undefined ? [{ id: 'fac-0', name: 'Salon A' }, { id: 'fac-1', name: 'Salon B' }] : cfg.facilities.data, error: null }),
          }),
        };
      }
      if (table === 'facility_reminder_settings') {
        return {
          select: jest.fn().mockReturnValue({
            // cfg.settings 未指定時のみ既定 []。data:null 指定はそのまま null を返す
            // （route 側の ?? [] フォールバック分岐を実際に踏ませるため）。
            in: jest.fn().mockResolvedValue({ data: cfg.settings === undefined ? [] : cfg.settings.data, error: cfg.settings?.error ?? null }),
          }),
        };
      }
      if (table === 'facility_entitlements') {
        return {
          select: jest.fn().mockReturnValue({
            in: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ data: cfg.entitlements?.data ?? [], error: cfg.entitlements?.error ?? null }),
            }),
          }),
        };
      }
      if (table === 'profiles') {
        return {
          select: jest.fn().mockReturnValue({
            in: jest.fn().mockResolvedValue({ data: cfg.lineLinks === undefined ? [] : cfg.lineLinks.data, error: cfg.lineLinks?.error ?? null }),
          }),
        };
      }
      if (table === 'facility_menus') {
        return {
          select: jest.fn().mockReturnValue({
            in: jest.fn().mockResolvedValue({ data: cfg.menus === undefined ? [] : cfg.menus.data, error: cfg.menus?.error ?? null }),
          }),
        };
      }
      if (table === 'sent_reminders') {
        return {
          upsert: mockUpsert,
          delete: mockDelete,
        };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  });

  const emailModule = require('@/lib/email');
  // sendBookingReminder(email) は送達可否を boolean で返す（safeSend 仕様）。既定は送達成功=true。
  mockEmailReminder = jest.fn().mockResolvedValue(true);
  emailModule.sendBookingReminder = mockEmailReminder;

  const lineModule = require('@/lib/line');
  mockLineReminder = jest.fn().mockResolvedValue(true);
  lineModule.sendBookingReminder = mockLineReminder;
}

beforeEach(() => {
  jest.clearAllMocks();
  setup();
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-05-15T00:00:00Z'));
});

afterEach(() => {
  jest.useRealTimers();
});

function makeRequest() {
  return new Request('http://localhost/api/cron/booking-reminder', {
    method: 'GET',
    headers: { Authorization: 'Bearer cron-secret' },
  });
}

describe('GET /api/cron/booking-reminder', () => {
  test('CRON_SECRET check failed → returns error', async () => {
    const errorResponse = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    (checkCronAuth as jest.Mock).mockReturnValue(errorResponse);
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(401);
  });

  test('対象日は JST の 1/3/7 日後（.in に3日付）', async () => {
    await GET(makeRequest() as any);
    expect(bookingsInMock).toHaveBeenCalledWith('booking_date', [D1, D3, D7]);
  });

  test('前日（1d）メールは設定なしでも無条件送信（従来挙動・無料）', async () => {
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.processed).toBe(2);
    // daysBefore=1 が渡る
    expect(mockEmailReminder).toHaveBeenCalledWith(
      expect.objectContaining({ bookingDate: D1, customerEmail: 'customer@example.com' }),
      1,
    );
  });

  test('bookings クエリエラー → 500', async () => {
    setup({ bookings: { data: [], error: { message: 'db down' } } });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
  });

  test('対象予約なし → skipped 0 件で 200', async () => {
    setup({ bookings: { data: [] } });
    const res = await GET(makeRequest() as any);
    const json = await res.json();
    expect(json.sent).toBe(0);
    expect(logCronRun).toHaveBeenCalledWith('booking-reminder', 'skipped', expect.any(Date), expect.any(Object));
  });

  test('CONSIDER_LIMIT 到達で警告ログ', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const many = Array.from({ length: 5000 }, (_, i) => booking({ id: String(i), email: null }));
    setup({ bookings: { data: many } });
    await GET(makeRequest() as any);
    expect(warnSpy).toHaveBeenCalledWith('[booking-reminder] consider limit reached', { limit: 5000 });
    warnSpy.mockRestore();
  });

  test('1d で email なし → 送信プラン対象外（processed 0）', async () => {
    setup({ bookings: { data: [booking({ email: null })] } });
    const json = await (await GET(makeRequest() as any)).json();
    expect(json.planned).toBe(0);
    expect(json.processed).toBe(0);
  });

  test('7d メール: 設定 ON で送信（無料・エンタイトルメント不要）', async () => {
    setup({
      bookings: { data: [booking({ booking_date: D7 })] },
      settings: { data: [{ facility_id: 'fac-0', remind_7d_email: true, remind_3d_email: false, remind_7d_line: false, remind_3d_line: false }] },
    });
    const json = await (await GET(makeRequest() as any)).json();
    expect(json.processed).toBe(1);
    expect(mockEmailReminder).toHaveBeenCalledWith(expect.objectContaining({ bookingDate: D7 }), 7);
  });

  test('7d メール: 設定なし（行なし）→ 送らない', async () => {
    setup({ bookings: { data: [booking({ booking_date: D7 })] } });
    const json = await (await GET(makeRequest() as any)).json();
    expect(json.planned).toBe(0);
  });

  test('3d メール: 設定 ON でもエンタイトルメント無しなら送らない（有料ゲート）', async () => {
    setup({
      bookings: { data: [booking({ booking_date: D3 })] },
      settings: { data: [{ facility_id: 'fac-0', remind_7d_email: false, remind_3d_email: true, remind_7d_line: false, remind_3d_line: false }] },
    });
    const json = await (await GET(makeRequest() as any)).json();
    expect(json.planned).toBe(0);
  });

  test('3d メール: 設定 ON ＋ reminder_email_3d 購入済み → 送信', async () => {
    setup({
      bookings: { data: [booking({ booking_date: D3 })] },
      settings: { data: [{ facility_id: 'fac-0', remind_7d_email: false, remind_3d_email: true, remind_7d_line: false, remind_3d_line: false }] },
      entitlements: { data: [{ facility_id: 'fac-0', option_key: 'reminder_email_3d' }] },
    });
    const json = await (await GET(makeRequest() as any)).json();
    expect(json.processed).toBe(1);
    expect(mockEmailReminder).toHaveBeenCalledWith(expect.objectContaining({ bookingDate: D3 }), 3);
  });

  test('7d LINE: 設定＋reminder_line 購入＋LINE連携あり → LINE送信（メニュー名解決）', async () => {
    setup({
      bookings: { data: [booking({ booking_date: D7, user_id: 'u1', menu_id: 'm1' })] },
      settings: { data: [{ facility_id: 'fac-0', remind_7d_email: false, remind_3d_email: false, remind_7d_line: true, remind_3d_line: false }] },
      entitlements: { data: [{ facility_id: 'fac-0', option_key: 'reminder_line' }] },
      lineLinks: { data: [{ id: 'u1', line_user_id: 'LINE-1' }] },
      menus: { data: [{ id: 'm1', name: 'カット' }] },
    });
    const json = await (await GET(makeRequest() as any)).json();
    expect(json.processed).toBe(1);
    expect(mockLineReminder).toHaveBeenCalledWith('LINE-1', expect.objectContaining({
      facilityName: 'Salon A', menuName: 'カット', date: D7, daysBefore: 7,
    }));
  });

  test('3d LINE: 設定＋購入＋連携 → LINE送信（daysBefore 3）', async () => {
    setup({
      bookings: { data: [booking({ booking_date: D3, user_id: 'u1' })] },
      settings: { data: [{ facility_id: 'fac-0', remind_7d_email: false, remind_3d_email: false, remind_7d_line: false, remind_3d_line: true }] },
      entitlements: { data: [{ facility_id: 'fac-0', option_key: 'reminder_line' }] },
      lineLinks: { data: [{ id: 'u1', line_user_id: 'LINE-1' }] },
    });
    const json = await (await GET(makeRequest() as any)).json();
    expect(json.processed).toBe(1);
    // menu_id null → フォールバック「ご予約」
    expect(mockLineReminder).toHaveBeenCalledWith('LINE-1', expect.objectContaining({ menuName: 'ご予約', daysBefore: 3 }));
  });

  test('LINE: 送信 false → skipped にカウント', async () => {
    setup({
      bookings: { data: [booking({ booking_date: D7, user_id: 'u1' })] },
      settings: { data: [{ facility_id: 'fac-0', remind_7d_email: false, remind_3d_email: false, remind_7d_line: true, remind_3d_line: false }] },
      entitlements: { data: [{ facility_id: 'fac-0', option_key: 'reminder_line' }] },
      lineLinks: { data: [{ id: 'u1', line_user_id: 'LINE-1' }] },
    });
    mockLineReminder.mockResolvedValue(false);
    const json = await (await GET(makeRequest() as any)).json();
    expect(json.skipped).toBe(1);
    expect(json.processed).toBe(0);
    // F-9 根治: 送信失敗時に claim(sent_reminders)を delete で解放する。
    expect(mockDelete).toHaveBeenCalled();
  });

  // 観測性 穴1 根治: email 送達失敗（safeSend が false）→ 従来は戻り値を無視し sent++ で無音＋claim 保持だった。
  // 戻り値で送達可否を判定し、失敗時は claim 解放＋skipped＋run 集約アラート対象にする。
  test('email: 送信 false → skipped・claim 解放（従来の無音恒久 miss を根治）', async () => {
    setup({
      bookings: { data: [booking({ booking_date: D1, user_id: 'u1' })] },
      settings: { data: [{ facility_id: 'fac-0', remind_1d_email: true, remind_3d_email: false, remind_7d_email: false, remind_1d_line: false }] },
    });
    mockEmailReminder.mockResolvedValue(false);
    const json = await (await GET(makeRequest() as any)).json();
    expect(json.skipped).toBe(1);
    expect(json.processed).toBe(0);
    // 送信失敗時に claim(sent_reminders)を delete で解放する（LINE 側と対称）。
    expect(mockDelete).toHaveBeenCalled();
  });

  // F-9 根治: claim 解放(delete)自体が失敗した場合も握り潰さず console.error で可視化する。
  test('LINE: 送信 false かつ claim 解放失敗 → 可視化（本体は継続）', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    setup({
      bookings: { data: [booking({ booking_date: D7, user_id: 'u1' })] },
      settings: { data: [{ facility_id: 'fac-0', remind_7d_email: false, remind_3d_email: false, remind_7d_line: true, remind_3d_line: false }] },
      entitlements: { data: [{ facility_id: 'fac-0', option_key: 'reminder_line' }] },
      lineLinks: { data: [{ id: 'u1', line_user_id: 'LINE-1' }] },
      deleteError: { message: 'delete failed' },
    });
    mockLineReminder.mockResolvedValue(false);
    const json = await (await GET(makeRequest() as any)).json();
    expect(json.skipped).toBe(1);
    expect(consoleSpy).toHaveBeenCalledWith(
      '[booking-reminder] claim release failed',
      expect.objectContaining({ err: { message: 'delete failed' } }),
    );
    consoleSpy.mockRestore();
  });

  test('LINE: user_id なし予約は購入済みでも対象外', async () => {
    setup({
      bookings: { data: [booking({ booking_date: D7, user_id: null })] },
      settings: { data: [{ facility_id: 'fac-0', remind_7d_email: false, remind_3d_email: false, remind_7d_line: true, remind_3d_line: false }] },
      entitlements: { data: [{ facility_id: 'fac-0', option_key: 'reminder_line' }] },
    });
    const json = await (await GET(makeRequest() as any)).json();
    expect(json.planned).toBe(0);
  });

  test('LINE: エンタイトルメント無し（reminder_line 未購入）は設定 ON でも対象外', async () => {
    setup({
      bookings: { data: [booking({ booking_date: D7, user_id: 'u1' })] },
      settings: { data: [{ facility_id: 'fac-0', remind_7d_email: false, remind_3d_email: false, remind_7d_line: true, remind_3d_line: false }] },
      entitlements: { data: [{ facility_id: 'fac-0', option_key: 'reminder_email_3d' }] },
    });
    const json = await (await GET(makeRequest() as any)).json();
    expect(json.planned).toBe(0);
  });

  test('LINE: 連携（profiles.line_user_id）が無いユーザーは対象外', async () => {
    setup({
      bookings: { data: [booking({ booking_date: D7, user_id: 'u1' })] },
      settings: { data: [{ facility_id: 'fac-0', remind_7d_email: false, remind_3d_email: false, remind_7d_line: true, remind_3d_line: false }] },
      entitlements: { data: [{ facility_id: 'fac-0', option_key: 'reminder_line' }] },
      lineLinks: { data: [] },
    });
    const json = await (await GET(makeRequest() as any)).json();
    expect(json.planned).toBe(0);
  });

  // 【監査C2】profiles.id が null の行はマッピングしない（l.id 側の falsy 分岐）。
  test('profiles の id null 行は無視（マッピングしない）', async () => {
    setup({
      bookings: { data: [booking({ booking_date: D7, user_id: 'u1' })] },
      settings: { data: [{ facility_id: 'fac-0', remind_7d_email: false, remind_3d_email: false, remind_7d_line: true, remind_3d_line: false }] },
      entitlements: { data: [{ facility_id: 'fac-0', option_key: 'reminder_line' }] },
      lineLinks: { data: [{ id: null, line_user_id: 'LINE-X' }] },
    });
    const json = await (await GET(makeRequest() as any)).json();
    expect(json.planned).toBe(0);
  });

  // 【監査C2】profiles.line_user_id が null（連携解除済み等）の行もマッピングしない
  // （l.line_user_id 側の falsy 分岐・旧 line_user_links.line_user_id は NOT NULL だったが
  // profiles.line_user_id は nullable のため必須ガード）。
  test('profiles の line_user_id null 行は無視（マッピングしない）', async () => {
    setup({
      bookings: { data: [booking({ booking_date: D7, user_id: 'u1' })] },
      settings: { data: [{ facility_id: 'fac-0', remind_7d_email: false, remind_3d_email: false, remind_7d_line: true, remind_3d_line: false }] },
      entitlements: { data: [{ facility_id: 'fac-0', option_key: 'reminder_line' }] },
      lineLinks: { data: [{ id: 'u1', line_user_id: null }] },
    });
    const json = await (await GET(makeRequest() as any)).json();
    expect(json.planned).toBe(0);
  });

  test('設定取得エラー → fail-safe（1d メールは送る・任意リマインドは送らない）', async () => {
    setup({
      bookings: { data: [booking({ booking_date: D1 }), booking({ booking_date: D7, id: 'x' })] },
      settings: { data: null, error: { message: 'settings down' } },
    });
    const json = await (await GET(makeRequest() as any)).json();
    expect(json.processed).toBe(1); // 1d のみ
  });

  test('設定 data null（エラーなし）→ ?? [] で安全', async () => {
    setup({ settings: { data: null } });
    const json = await (await GET(makeRequest() as any)).json();
    expect(json.processed).toBe(2);
  });

  test('エンタイトルメント取得エラー → fail-safe（未購入扱い・有料リマインドを送らない）', async () => {
    setup({
      bookings: { data: [booking({ booking_date: D3 })] },
      settings: { data: [{ facility_id: 'fac-0', remind_7d_email: false, remind_3d_email: true, remind_7d_line: false, remind_3d_line: false }] },
      entitlements: { data: null, error: { message: 'ent down' } },
    });
    const json = await (await GET(makeRequest() as any)).json();
    // 設定 ON でもエンタイトルメント取得失敗 → 未購入扱い（誤って無料開放しない安全側）
    expect(json.planned).toBe(0);
    expect(json.processed).toBe(0);
  });

  test('profiles(連携) 取得エラー → fail-safe（LINE 送らない）', async () => {
    setup({
      bookings: { data: [booking({ booking_date: D7, user_id: 'u1' })] },
      settings: { data: [{ facility_id: 'fac-0', remind_7d_email: false, remind_3d_email: false, remind_7d_line: true, remind_3d_line: false }] },
      entitlements: { data: [{ facility_id: 'fac-0', option_key: 'reminder_line' }] },
      lineLinks: { data: null, error: { message: 'links down' } },
    });
    const json = await (await GET(makeRequest() as any)).json();
    expect(json.planned).toBe(0);
  });

  test('facility_menus 取得エラー → fail-safe（「ご予約」表記で送る）', async () => {
    setup({
      bookings: { data: [booking({ booking_date: D7, user_id: 'u1', menu_id: 'm1' })] },
      settings: { data: [{ facility_id: 'fac-0', remind_7d_email: false, remind_3d_email: false, remind_7d_line: true, remind_3d_line: false }] },
      entitlements: { data: [{ facility_id: 'fac-0', option_key: 'reminder_line' }] },
      lineLinks: { data: [{ id: 'u1', line_user_id: 'LINE-1' }] },
      menus: { data: null, error: { message: 'menus down' } },
    });
    const json = await (await GET(makeRequest() as any)).json();
    expect(json.processed).toBe(1);
    expect(mockLineReminder).toHaveBeenCalledWith('LINE-1', expect.objectContaining({ menuName: 'ご予約' }));
  });

  test('施設名が引けない場合は空文字で送る（facilities data null）', async () => {
    setup({ bookings: { data: [booking()] }, facilities: { data: null } });
    const json = await (await GET(makeRequest() as any)).json();
    expect(json.processed).toBe(1);
    expect(mockEmailReminder).toHaveBeenCalledWith(expect.objectContaining({ facilityName: '' }), 1);
  });

  test('claim は (booking_id, reminder_date, kind) で upsert される', async () => {
    setup({ bookings: { data: [booking({ id: 'one' })] } });
    await GET(makeRequest() as any);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ reminder_date: D1, kind: 'email_1d' }),
      { onConflict: 'booking_id,reminder_date,kind', ignoreDuplicates: true },
    );
  });

  test('claim upsert エラー → skipped（重複送信より安全側）', async () => {
    setup({ bookings: { data: [booking()] }, upsertError: { message: 'upsert failed' } });
    const json = await (await GET(makeRequest() as any)).json();
    expect(json.skipped).toBe(1);
    expect(json.processed).toBe(0);
  });

  // CAS: upsert(ignoreDuplicates).select('sent_at') が 1 行返す = 実際に INSERT できた
  // （＝claim 勝ち）→ 送信される。
  test('claim 勝ち（upsert().select() が1行返す）→ 送信される', async () => {
    setup({ bookings: { data: [booking()] }, claimSelectData: [{ sent_at: new Date().toISOString() }] });
    const json = await (await GET(makeRequest() as any)).json();
    expect(json.processed).toBe(1);
    expect(json.skipped).toBe(0);
    expect(mockEmailReminder).toHaveBeenCalled();
  });

  // CAS: 空配列 = 競合により INSERT が無視された（他 invocation が先に claim 済み）→ 負け→ skipped。
  // 旧実装の「30秒より古ければ負け」ヒューリスティックはレースを構造的に埋め切れなかった
  // （cron 三重化で両 invocation が『30秒未満だから勝ち』と誤判定し得た）。
  test('claim 負け（upsert().select() が空配列を返す・他 invocation が先取り）→ skipped・送信されない', async () => {
    setup({ bookings: { data: [booking()] }, claimSelectData: [] });
    const json = await (await GET(makeRequest() as any)).json();
    expect(json.skipped).toBe(1);
    expect(json.processed).toBe(0);
    expect(mockEmailReminder).not.toHaveBeenCalled();
  });

  // 防御的 OR 分岐: data が null（PostgREST が空配列ではなく null を返すケースへの保険）も負け扱い。
  test('claim select data が null（防御的分岐）→ skipped', async () => {
    setup({ bookings: { data: [booking()] }, claimSelectData: null });
    const json = await (await GET(makeRequest() as any)).json();
    expect(json.skipped).toBe(1);
    expect(json.processed).toBe(0);
  });

  test('メール送信 throw → skipped（バッチ全体は止めない）', async () => {
    setup({ bookings: { data: [booking()] } });
    mockEmailReminder.mockRejectedValue(new Error('resend down'));
    const json = await (await GET(makeRequest() as any)).json();
    expect(json.skipped).toBe(1);
    expect(json.processed).toBe(0);
  });

  test('実時間予算超過 → 残りを deferred して打ち切り', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    setup({ bookings: { data: [booking({ id: 'p1' }), booking({ id: 'p2' }), booking({ id: 'p3' })] } });
    // 1件目の claim 中に時計を 60 秒進める → 2件目のループ先頭で予算超過
    mockUpsert.mockImplementation(() => ({
      select: jest.fn().mockImplementation(() => {
        jest.advanceTimersByTime(60_000);
        return Promise.resolve({ data: [{ sent_at: new Date().toISOString() }], error: null });
      }),
    }));
    const json = await (await GET(makeRequest() as any)).json();
    expect(json.deferred).toBe(2);
    expect(json.processed).toBe(1);
    warnSpy.mockRestore();
  });

  test('予期しない例外 → 500 + cron error ログ', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockImplementation(() => { throw new Error('boom'); });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
    expect(logCronRun).toHaveBeenCalledWith('booking-reminder', 'error', expect.any(Date), expect.objectContaining({ error_msg: 'boom' }));
  });

  test('Error 以外の throw も文字列化して 500', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockImplementation(() => { throw 'string-error'; });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
    expect(logCronRun).toHaveBeenCalledWith('booking-reminder', 'error', expect.any(Date), expect.objectContaining({ error_msg: 'string-error' }));
  });

  test('profiles(連携) data null（エラーなし）→ ?? [] で安全', async () => {
    setup({
      bookings: { data: [booking({ booking_date: D7, user_id: 'u1' })] },
      settings: { data: [{ facility_id: 'fac-0', remind_7d_email: false, remind_3d_email: false, remind_7d_line: true, remind_3d_line: false }] },
      entitlements: { data: [{ facility_id: 'fac-0', option_key: 'reminder_line' }] },
      lineLinks: { data: null },
    });
    const json = await (await GET(makeRequest() as any)).json();
    expect(json.planned).toBe(0);
  });

  test('facility_menus data null（エラーなし）→ ?? [] で安全（フォールバック表記）', async () => {
    setup({
      bookings: { data: [booking({ booking_date: D7, user_id: 'u1', menu_id: 'm1' })] },
      settings: { data: [{ facility_id: 'fac-0', remind_7d_email: false, remind_3d_email: false, remind_7d_line: true, remind_3d_line: false }] },
      entitlements: { data: [{ facility_id: 'fac-0', option_key: 'reminder_line' }] },
      lineLinks: { data: [{ id: 'u1', line_user_id: 'LINE-1' }] },
      menus: { data: null },
    });
    const json = await (await GET(makeRequest() as any)).json();
    expect(json.processed).toBe(1);
    expect(mockLineReminder).toHaveBeenCalledWith('LINE-1', expect.objectContaining({ menuName: 'ご予約' }));
  });

  test('total_price null → totalPrice undefined で送信', async () => {
    setup({ bookings: { data: [booking({ total_price: null })] } });
    const json = await (await GET(makeRequest() as any)).json();
    expect(json.processed).toBe(1);
    expect(mockEmailReminder).toHaveBeenCalledWith(expect.objectContaining({ totalPrice: undefined }), 1);
  });

  test('7d メール: 設定 ON でも email なし → 送らない', async () => {
    setup({
      bookings: { data: [booking({ booking_date: D7, email: null })] },
      settings: { data: [{ facility_id: 'fac-0', remind_7d_email: true, remind_3d_email: false, remind_7d_line: false, remind_3d_line: false }] },
    });
    const json = await (await GET(makeRequest() as any)).json();
    expect(json.planned).toBe(0);
  });

  test('3d メール: 設定＋購入済みでも email なし → 送らない', async () => {
    setup({
      bookings: { data: [booking({ booking_date: D3, email: null })] },
      settings: { data: [{ facility_id: 'fac-0', remind_7d_email: false, remind_3d_email: true, remind_7d_line: false, remind_3d_line: false }] },
      entitlements: { data: [{ facility_id: 'fac-0', option_key: 'reminder_email_3d' }] },
    });
    const json = await (await GET(makeRequest() as any)).json();
    expect(json.planned).toBe(0);
  });

  test('7d LINE: 設定 OFF（remind_7d_line=false）は購入済み＋連携ありでも送らない', async () => {
    setup({
      bookings: { data: [booking({ booking_date: D7, user_id: 'u1' })] },
      settings: { data: [{ facility_id: 'fac-0', remind_7d_email: false, remind_3d_email: false, remind_7d_line: false, remind_3d_line: true }] },
      entitlements: { data: [{ facility_id: 'fac-0', option_key: 'reminder_line' }] },
      lineLinks: { data: [{ id: 'u1', line_user_id: 'LINE-1' }] },
    });
    const json = await (await GET(makeRequest() as any)).json();
    expect(json.planned).toBe(0);
  });

  test('3d LINE: 設定 OFF（remind_3d_line=false）は購入済みでも送らない', async () => {
    setup({
      bookings: { data: [booking({ booking_date: D3, user_id: 'u1' })] },
      settings: { data: [{ facility_id: 'fac-0', remind_7d_email: false, remind_3d_email: false, remind_7d_line: true, remind_3d_line: false }] },
      entitlements: { data: [{ facility_id: 'fac-0', option_key: 'reminder_line' }] },
      lineLinks: { data: [{ id: 'u1', line_user_id: 'LINE-1' }] },
    });
    const json = await (await GET(makeRequest() as any)).json();
    expect(json.planned).toBe(0);
  });

  test('対象3日付以外の booking_date が混じっても安全に無視（防御的分岐）', async () => {
    setup({ bookings: { data: [booking({ booking_date: '2026-05-20' })] } });
    const json = await (await GET(makeRequest() as any)).json();
    expect(json.planned).toBe(0);
    expect(json.processed).toBe(0);
  });

  test('7d LINE: 設定 ON だがエンタイトルメント行ゼロ（ent undefined）→ 送らない', async () => {
    setup({
      bookings: { data: [booking({ booking_date: D7, user_id: 'u1' })] },
      settings: { data: [{ facility_id: 'fac-0', remind_7d_email: false, remind_3d_email: false, remind_7d_line: true, remind_3d_line: false }] },
      entitlements: { data: [] },
    });
    const json = await (await GET(makeRequest() as any)).json();
    expect(json.planned).toBe(0);
  });

  test('3d LINE: 設定 ON だがエンタイトルメント行ゼロ → 送らない', async () => {
    setup({
      bookings: { data: [booking({ booking_date: D3, user_id: 'u1' })] },
      settings: { data: [{ facility_id: 'fac-0', remind_7d_email: false, remind_3d_email: false, remind_7d_line: false, remind_3d_line: true }] },
      entitlements: { data: [] },
    });
    const json = await (await GET(makeRequest() as any)).json();
    expect(json.planned).toBe(0);
  });

  test('3d: 設定行なし（s undefined）→ 何も送らない', async () => {
    setup({ bookings: { data: [booking({ booking_date: D3, user_id: 'u1' })] } });
    const json = await (await GET(makeRequest() as any)).json();
    expect(json.planned).toBe(0);
  });

  test('対象外日付＋LINE条件が揃った予約も filter 段階で安全に無視', async () => {
    setup({
      bookings: { data: [booking({ booking_date: '2026-05-20', user_id: 'u1' })] },
      settings: { data: [{ facility_id: 'fac-0', remind_7d_email: true, remind_3d_email: true, remind_7d_line: true, remind_3d_line: true }] },
      entitlements: { data: [{ facility_id: 'fac-0', option_key: 'reminder_line' }, { facility_id: 'fac-0', option_key: 'reminder_email_3d' }] },
      lineLinks: { data: [{ id: 'u1', line_user_id: 'LINE-1' }] },
    });
    const json = await (await GET(makeRequest() as any)).json();
    expect(json.planned).toBe(0);
  });

  test('LINE 送信時も施設名が引けなければ空文字で送る', async () => {
    setup({
      bookings: { data: [booking({ booking_date: D7, user_id: 'u1' })] },
      facilities: { data: null },
      settings: { data: [{ facility_id: 'fac-0', remind_7d_email: false, remind_3d_email: false, remind_7d_line: true, remind_3d_line: false }] },
      entitlements: { data: [{ facility_id: 'fac-0', option_key: 'reminder_line' }] },
      lineLinks: { data: [{ id: 'u1', line_user_id: 'LINE-1' }] },
    });
    const json = await (await GET(makeRequest() as any)).json();
    expect(json.processed).toBe(1);
    expect(mockLineReminder).toHaveBeenCalledWith('LINE-1', expect.objectContaining({ facilityName: '' }));
  });

  test('成功時 logCronRun に planned/deferred メタを記録', async () => {
    await GET(makeRequest() as any);
    expect(logCronRun).toHaveBeenCalledWith('booking-reminder', 'success', expect.any(Date), expect.objectContaining({
      processed: 2,
      meta: expect.objectContaining({ total_bookings: 2, planned: 2, deferred: 0 }),
    }));
  });
});
