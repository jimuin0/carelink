/**
 * @jest-environment node
 *
 * Tests for GET /api/cron/birthday-coupon
 * Key assertions:
 *   - CRON_SECRET validation
 *   - Finds profiles with today's birth_date (MM-DD)
 *   - Awards 100 points via user_points insert
 *   - Handles 23505 (already awarded) - falls through to notification retry
 *   - Sends birthday email (if RESEND_API_KEY) and records in birthday_notifications
 *   - Sends LINE notification (if LINE_CHANNEL_ACCESS_TOKEN_CARELINK) and records
 *   - Skips notification channels already recorded in birthday_notifications
 *   - Notification failure does NOT insert into birthday_notifications (→ retry next run)
 *   - Idempotency via year-based reason (birthday_YYYY)
 *   - Logs cron execution
 */

jest.mock('@/lib/cron-auth', () => ({
  checkCronAuth: jest.fn(() => null),
}));
jest.mock('@/lib/cron-logger');
jest.mock('@/lib/line');
jest.mock('resend');

// Module-level supabase = createClient(...) — use wrapper so from() is lazily resolved
const mockFrom = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: (...args: any[]) => mockFrom(...args),
  })),
}));

import { checkCronAuth } from '@/lib/cron-auth';
import { logCronRun } from '@/lib/cron-logger';
import { sendLineText } from '@/lib/line';
import { GET } from '../route';

let mockProfilesSelect: jest.Mock;
let mockProfilesFilter: jest.Mock;
let mockPointsInsert: jest.Mock;
let mockLineLinkSelect: jest.Mock;
let mockNotifSelect: jest.Mock;
let mockNotifInsert: jest.Mock;

function setupDefaultMocks(
  birthdayProfiles: number = 2,
  pointsInsertFails: number = 0,
  lineLinkFound: boolean = true,
  resendAvailable: boolean = true,
  existingNotifications: Array<{ user_id: string; channel: string }> = []
) {
  (checkCronAuth as jest.Mock).mockReturnValue(null);
  (logCronRun as jest.Mock).mockResolvedValue(undefined);
  (sendLineText as jest.Mock).mockResolvedValue(true); // 送達成功（boolean 仕様）。失敗テストで上書き。

  const profileData =
    birthdayProfiles > 0
      ? Array.from({ length: birthdayProfiles }, (_, i) => ({
          id: `user-${i}`,
          email: `user${i}@example.com`,
          display_name: `Birthday User ${i}`,
          email_unsubscribed: false,
        }))
      : [];
  const lineLinkData = lineLinkFound ? { line_user_id: 'line-user-123' } : null;

  // filter を変数化して呼び出し引数（'birth_date','like','%-MM-DD'）を検証可能にする。
  mockProfilesFilter = jest.fn().mockReturnValue({
    range: jest.fn().mockResolvedValue({ data: profileData }),
  });
  mockProfilesSelect = jest.fn().mockReturnValue({
    not: jest.fn().mockReturnValue({
      filter: mockProfilesFilter,
    }),
  });

  mockPointsInsert = jest.fn((data) => {
    if (pointsInsertFails > 0 && data.user_id === 'user-0') {
      return Promise.resolve({
        error: { code: '23505', message: 'Unique violation' },
      });
    }
    return Promise.resolve({ error: null });
  });

  mockLineLinkSelect = jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      maybeSingle: jest.fn().mockResolvedValue({ data: lineLinkData }),
    }),
  });

  // birthday_notifications: select (batch fetch at start of run)
  mockNotifSelect = jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      in: jest.fn().mockResolvedValue({ data: existingNotifications }),
    }),
  });

  // birthday_notifications: insert (record successful delivery)
  mockNotifInsert = jest.fn().mockResolvedValue({ error: null });

  mockFrom.mockImplementation((table: string) => {
    if (table === 'profiles') {
      return { select: mockProfilesSelect };
    } else if (table === 'user_points') {
      return { insert: mockPointsInsert };
    } else if (table === 'line_user_links') {
      return { select: mockLineLinkSelect };
    } else if (table === 'birthday_notifications') {
      return { select: mockNotifSelect, insert: mockNotifInsert };
    }
    return {};
  });

  if (resendAvailable) {
    const { Resend } = require('resend');
    Resend.mockImplementation(() => ({
      emails: {
        send: jest.fn().mockResolvedValue({ success: true }),
      },
    }));
  }

  if (resendAvailable) {
    process.env.RESEND_API_KEY = 'resend-key';
  } else {
    delete process.env.RESEND_API_KEY;
  }
  process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK = 'line-token';
}

beforeEach(() => {
  jest.clearAllMocks();
  // システム時刻を固定して todayMD（JST 月日）を決定的にする。
  // 2026-06-15T03:00:00Z → JST +9h = 2026-06-15T12:00 → todayMD='06-15'（日跨ぎしない正午で固定）。
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-06-15T03:00:00Z'));
  setupDefaultMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  process.env.CRON_SECRET = 'cron-secret';
  process.env.NEXT_PUBLIC_SITE_URL = 'https://carelink-jp.com';
});

afterEach(() => {
  jest.useRealTimers();
});

function makeRequest(cronSecret: string = 'cron-secret') {
  return new Request('http://localhost/api/cron/birthday-coupon', {
    method: 'GET',
    headers: { authorization: `Bearer ${cronSecret}` },
  });
}

describe('GET /api/cron/birthday-coupon', () => {
  test('invalid CRON_SECRET → returns auth error', async () => {
    (checkCronAuth as jest.Mock).mockReturnValue(
      new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    );

    const res = await GET(makeRequest('invalid') as any);

    expect(res.status).toBe(401);
  });

  test('profiles 取得が DB エラー → error ログ＋500（無音スキップにしない）', async () => {
    mockProfilesSelect.mockReturnValue({
      not: jest.fn().mockReturnValue({
        filter: jest.fn().mockReturnValue({
          range: jest.fn().mockResolvedValue({ data: null, error: { message: 'db down' } }),
        }),
      }),
    });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
    expect((logCronRun as jest.Mock).mock.calls.some((c: any[]) => c[1] === 'error')).toBe(true);
  });

  test('no birthday profiles today → 200 with sent=0', async () => {
    setupDefaultMocks(0);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sent).toBe(0);
  });

  test('birthday profiles found → 200 with sent count', async () => {
    setupDefaultMocks(2);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.processed).toBe(2);
    expect(json.total).toBe(2);
  });

  test('searches profiles by birth_date (MM-DD today)', async () => {
    setupDefaultMocks(2);

    await GET(makeRequest() as any);

    expect(mockProfilesSelect).toHaveBeenCalled();
    // 固定時刻(JST 2026-06-15)から導かれる todayMD='06-15' で正しくフィルタしているか引数まで検証。
    // 旧テストは toHaveBeenCalled() のみで、todayMD 生成にバグが入っても気付けない偽陽性だった。
    expect(mockProfilesFilter).toHaveBeenCalledWith('birth_date::text', 'like', '%-06-15');
  });

  test('inserts 100 points per user with reason=birthday_YYYY', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    const insertCalls = mockPointsInsert.mock.calls;
    expect(insertCalls.length).toBeGreaterThan(0);
    expect(insertCalls[0][0]).toMatchObject({
      points: 100,
      reason: expect.stringMatching(/^birthday_\d{4}$/),
    });
  });

  test('idempotency: 23505 error (already awarded) → skipped count increments', async () => {
    setupDefaultMocks(2, 1);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.skipped).toBeGreaterThanOrEqual(1);
  });

  test('23505 (already awarded) → 通知未送達なら通知を再試行する', async () => {
    // user-0 が 23505 だが birthday_notifications は空 → email/LINE を試みる
    setupDefaultMocks(1, 1, true, true, []);

    await GET(makeRequest() as any);

    // email と LINE が試みられる（送達済み記録なし）
    const { Resend } = require('resend');
    expect(Resend).toHaveBeenCalled();
    expect(sendLineText).toHaveBeenCalled();
  });

  test('sends birthday email when RESEND_API_KEY available', async () => {
    setupDefaultMocks(1, 0, true, true);

    const { Resend } = require('resend');

    await GET(makeRequest() as any);

    expect(Resend).toHaveBeenCalled();
  });

  test('skips email when RESEND_API_KEY unavailable', async () => {
    setupDefaultMocks(1, 0, false, false);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('email includes 100pt amount in subject', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    // Email should include "100ポイント" or similar
  });

  test('email includes points confirmation link', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    // Email should include mypage/points link
  });

  test('sends LINE notification when LINE_CHANNEL_ACCESS_TOKEN available', async () => {
    setupDefaultMocks(1, 0, true);

    await GET(makeRequest() as any);

    expect(sendLineText).toHaveBeenCalledWith(
      'line-user-123',
      expect.stringContaining('100ポイント')
    );
  });

  test('skips LINE notification when line_user_id not found', async () => {
    setupDefaultMocks(1, 0, false);

    (sendLineText as jest.Mock).mockClear();

    await GET(makeRequest() as any);

    expect(sendLineText).not.toHaveBeenCalled();
  });

  test('uses display_name in email and LINE message', async () => {
    setupDefaultMocks(1, 0, true);

    await GET(makeRequest() as any);

    expect(sendLineText).toHaveBeenCalled();
  });

  test('fallback to お客様 when display_name is null', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: jest.fn().mockReturnValue({
            not: jest.fn().mockReturnValue({
              filter: jest.fn().mockReturnValue({
                range: jest.fn().mockResolvedValue({
                  data: [{ id: 'user-1', email: 'user@example.com', display_name: null }],
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'user_points') return { insert: jest.fn().mockResolvedValue({ error: null }) };
      if (table === 'line_user_links') return { select: mockLineLinkSelect };
      if (table === 'birthday_notifications') return { select: mockNotifSelect, insert: mockNotifInsert };
      return {};
    });

    await GET(makeRequest() as any);

    expect(sendLineText).toHaveBeenCalled();
  });

  test('配信停止者にはメール送らないがポイントは付与する', async () => {
    const pointsInsert = jest.fn().mockResolvedValue({ error: null });
    const emailSend = jest.fn().mockResolvedValue({ success: true });
    const { Resend } = require('resend');
    Resend.mockImplementation(() => ({ emails: { send: emailSend } }));
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: jest.fn().mockReturnValue({
            not: jest.fn().mockReturnValue({
              filter: jest.fn().mockReturnValue({
                range: jest.fn().mockResolvedValue({ data: [{ id: 'user-unsub', email: 'u@e.com', display_name: 'U', email_unsubscribed: true }] }),
              }),
            }),
          }),
        };
      }
      if (table === 'user_points') return { insert: pointsInsert };
      if (table === 'line_user_links') return { select: mockLineLinkSelect };
      if (table === 'birthday_notifications') return { select: mockNotifSelect, insert: mockNotifInsert };
      return {};
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    expect(pointsInsert).toHaveBeenCalled();      // ポイントは付与
    expect(emailSend).not.toHaveBeenCalled();     // メールは送らない
  });

  test('limits profile query to 500', async () => {
    setupDefaultMocks(500);

    await GET(makeRequest() as any);

    // Should process up to 500 profiles
  });

  test('email send failure → 通知記録をしない（翌 run で再送される）', async () => {
    // setupDefaultMocks の後に Resend を上書きして失敗を注入する
    setupDefaultMocks(1, 0, false, true, []); // LINE なし、email あり
    const { Resend } = require('resend');
    Resend.mockImplementation(() => ({
      emails: {
        send: jest.fn().mockRejectedValue(new Error('Email failed')),
      },
    }));
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: mockProfilesSelect };
      if (table === 'user_points') return { insert: mockPointsInsert };
      if (table === 'line_user_links') return { select: mockLineLinkSelect };
      if (table === 'birthday_notifications') return { select: mockNotifSelect, insert: mockNotifInsert };
      return {};
    });

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    // email 失敗時は birthday_notifications に email チャンネルを insert しない
    const emailInsertCalls = mockNotifInsert.mock.calls.filter(
      (c: any[]) => c[0]?.channel === 'email'
    );
    expect(emailInsertCalls).toHaveLength(0);
  });

  test('email send success → birthday_notifications に email チャンネルを insert する', async () => {
    setupDefaultMocks(1, 0, false, true, []); // LINE なし・email のみ

    await GET(makeRequest() as any);

    const emailInsertCalls = mockNotifInsert.mock.calls.filter(
      (c: any[]) => c[0]?.channel === 'email'
    );
    expect(emailInsertCalls).toHaveLength(1);
    expect(emailInsertCalls[0][0]).toMatchObject({
      user_id: 'user-0',
      channel: 'email',
      year: expect.any(Number),
    });
  });

  test('LINE send success → birthday_notifications に line チャンネルを insert する', async () => {
    setupDefaultMocks(1, 0, true, false, []); // email なし・LINE のみ

    await GET(makeRequest() as any);

    const lineInsertCalls = mockNotifInsert.mock.calls.filter(
      (c: any[]) => c[0]?.channel === 'line'
    );
    expect(lineInsertCalls).toHaveLength(1);
    expect(lineInsertCalls[0][0]).toMatchObject({
      user_id: 'user-0',
      channel: 'line',
      year: expect.any(Number),
    });
  });

  test('LINE send failure → 通知記録をしない（翌 run で再送される）', async () => {
    (sendLineText as jest.Mock).mockRejectedValueOnce(new Error('LINE failed'));

    setupDefaultMocks(1, 0, true);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    // LINE 失敗時は birthday_notifications に line チャンネルを insert しない
    const lineInsertCalls = mockNotifInsert.mock.calls.filter(
      (c: any[]) => c[0]?.channel === 'line'
    );
    expect(lineInsertCalls).toHaveLength(0);
  });

  test('LINE send が false（リトライ枯渇・throwなし）→ 通知記録をしない（翌 run で再送）', async () => {
    setupDefaultMocks(1, 0, true);
    (sendLineText as jest.Mock).mockResolvedValue(false); // setupDefaultMocks の後に上書き（true で潰されるため）
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const lineInsertCalls = mockNotifInsert.mock.calls.filter(
      (c: any[]) => c[0]?.channel === 'line'
    );
    expect(lineInsertCalls).toHaveLength(0);
  });

  test('email 送達済み（notifiedSet）→ email を再送しない', async () => {
    setupDefaultMocks(1, 0, true, true, [{ user_id: 'user-0', channel: 'email' }]);

    const { Resend } = require('resend');
    const emailSend = jest.fn().mockResolvedValue({ success: true });
    Resend.mockImplementation(() => ({ emails: { send: emailSend } }));
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: mockProfilesSelect };
      if (table === 'user_points') return { insert: mockPointsInsert };
      if (table === 'line_user_links') return { select: mockLineLinkSelect };
      if (table === 'birthday_notifications') return { select: mockNotifSelect, insert: mockNotifInsert };
      return {};
    });

    await GET(makeRequest() as any);

    expect(emailSend).not.toHaveBeenCalled();
  });

  test('LINE 送達済み（notifiedSet）→ LINE を再送しない', async () => {
    setupDefaultMocks(1, 0, true, false, [{ user_id: 'user-0', channel: 'line' }]);
    (sendLineText as jest.Mock).mockClear();

    await GET(makeRequest() as any);

    expect(sendLineText).not.toHaveBeenCalled();
  });

  test('email・LINE 両方送達済み → 通知チャネルとも再送しない', async () => {
    const notifications = [
      { user_id: 'user-0', channel: 'email' },
      { user_id: 'user-0', channel: 'line' },
    ];
    setupDefaultMocks(1, 0, true, true, notifications);
    const { Resend } = require('resend');
    const emailSend = jest.fn().mockResolvedValue({ success: true });
    Resend.mockImplementation(() => ({ emails: { send: emailSend } }));
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: mockProfilesSelect };
      if (table === 'user_points') return { insert: mockPointsInsert };
      if (table === 'line_user_links') return { select: mockLineLinkSelect };
      if (table === 'birthday_notifications') return { select: mockNotifSelect, insert: mockNotifInsert };
      return {};
    });
    (sendLineText as jest.Mock).mockClear();

    await GET(makeRequest() as any);

    expect(emailSend).not.toHaveBeenCalled();
    expect(sendLineText).not.toHaveBeenCalled();
  });

  test('logs cron execution with success', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    expect(logCronRun).toHaveBeenCalledWith(
      'birthday-coupon',
      'success',
      expect.any(Date),
      expect.objectContaining({
        processed: expect.any(Number),
      })
    );
  });

  test('exception during processing → 500 with error log', async () => {
    mockFrom.mockImplementation(() => {
      throw new Error('Fatal error');
    });

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(500);
  });

  test('points insert non-23505 error → skipped (notification not attempted)', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockPointsInsert = jest.fn().mockResolvedValue({
      error: { code: '99999', message: 'other db error' },
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: mockProfilesSelect };
      if (table === 'user_points') return { insert: mockPointsInsert };
      if (table === 'line_user_links') return { select: mockLineLinkSelect };
      if (table === 'birthday_notifications') return { select: mockNotifSelect, insert: mockNotifInsert };
      return {};
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.skipped).toBeGreaterThan(0);
    // 非23505エラー時は通知を試みない
    expect(mockNotifInsert).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test('profile.email null → no email send', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: jest.fn().mockReturnValue({
            not: jest.fn().mockReturnValue({
              filter: jest.fn().mockReturnValue({
                range: jest.fn().mockResolvedValue({
                  data: [{ id: 'u1', email: null, display_name: 'No Email' }],
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'user_points') return { insert: jest.fn().mockResolvedValue({ error: null }) };
      if (table === 'line_user_links') return { select: mockLineLinkSelect };
      if (table === 'birthday_notifications') return { select: mockNotifSelect, insert: mockNotifInsert };
      return {};
    });
    const { Resend } = require('resend');
    const sendSpy = jest.fn().mockResolvedValue({ success: true });
    Resend.mockImplementation(() => ({ emails: { send: sendSpy } }));

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  test('LINE token unset → skip LINE block', async () => {
    setupDefaultMocks(1);
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK; // setupDefaultMocks 後に削除
    (sendLineText as jest.Mock).mockClear();

    await GET(makeRequest() as any);
    expect(sendLineText).not.toHaveBeenCalled();
  });

  test('non-Error throw → String fallback in catch', async () => {
    mockFrom.mockImplementation(() => { throw 'plain string error'; });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
  });

  test('points reason includes current year for idempotency', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    const insertCall = mockPointsInsert.mock.calls[0];
    const year = new Date().getUTCFullYear();
    expect(insertCall[0].reason).toBe(`birthday_${year}`);
  });

  test('birthday_notifications 一括取得: 当年・当該 user_id で eq/in を呼ぶ', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    expect(mockNotifSelect).toHaveBeenCalledWith('user_id, channel');
  });

  test('existingNotifications が null → 空の notifiedSet で全通知を試みる', async () => {
    setupDefaultMocks(1, 0, true, true);
    // select result = null
    mockNotifSelect = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        in: jest.fn().mockResolvedValue({ data: null }),
      }),
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: mockProfilesSelect };
      if (table === 'user_points') return { insert: mockPointsInsert };
      if (table === 'line_user_links') return { select: mockLineLinkSelect };
      if (table === 'birthday_notifications') return { select: mockNotifSelect, insert: mockNotifInsert };
      return {};
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    // null の場合でも通知を試みる（空集合扱い）
    expect(sendLineText).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // デプロイ順序非依存フォールバック: birthday_notifications 取得失敗（migration 未適用）
  // -----------------------------------------------------------------------
  test('select error（テーブル未適用）+ 初回付与 → 通知は送るが記録 insert は呼ばない（旧来動作）', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    setupDefaultMocks(1, 0, true, true, []); // 初回付与（insertErr=null）
    // notif select が error を返す（テーブル不在）
    mockNotifSelect = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        in: jest.fn().mockResolvedValue({ data: null, error: { code: '42P01', message: 'relation "birthday_notifications" does not exist' } }),
      }),
    });
    const { Resend } = require('resend');
    const emailSend = jest.fn().mockResolvedValue({ success: true });
    Resend.mockImplementation(() => ({ emails: { send: emailSend } }));
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: mockProfilesSelect };
      if (table === 'user_points') return { insert: mockPointsInsert };
      if (table === 'line_user_links') return { select: mockLineLinkSelect };
      if (table === 'birthday_notifications') return { select: mockNotifSelect, insert: mockNotifInsert };
      return {};
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    // 初回付与なので通知は送る（旧来動作と同じ＝重複なし）
    expect(emailSend).toHaveBeenCalled();
    expect(sendLineText).toHaveBeenCalled();
    // テーブル未適用なので記録 insert は呼ばない
    expect(mockNotifInsert).not.toHaveBeenCalled();
    // 警告ログを出す
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('select error（テーブル未適用）+ 23505（既付与）→ 再送せずスキップ（旧来の冪等動作・重複防止）', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    setupDefaultMocks(1, 1, true, true, []); // user-0 が 23505
    mockNotifSelect = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        in: jest.fn().mockResolvedValue({ data: null, error: { code: '42P01', message: 'relation "birthday_notifications" does not exist' } }),
      }),
    });
    const { Resend } = require('resend');
    const emailSend = jest.fn().mockResolvedValue({ success: true });
    Resend.mockImplementation(() => ({ emails: { send: emailSend } }));
    (sendLineText as jest.Mock).mockClear();
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: mockProfilesSelect };
      if (table === 'user_points') return { insert: mockPointsInsert };
      if (table === 'line_user_links') return { select: mockLineLinkSelect };
      if (table === 'birthday_notifications') return { select: mockNotifSelect, insert: mockNotifInsert };
      return {};
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.skipped).toBeGreaterThanOrEqual(1);
    // テーブル未適用 + 既付与 → 旧来どおりスキップ（重複送信しない）
    expect(emailSend).not.toHaveBeenCalled();
    expect(sendLineText).not.toHaveBeenCalled();
    expect(mockNotifInsert).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
