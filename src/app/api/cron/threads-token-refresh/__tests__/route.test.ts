/**
 * @jest-environment node
 *
 * Tests for GET /api/cron/threads-token-refresh
 * Key assertions:
 *   - CRON_SECRET validation
 *   - 未設定（threads_credentials 行なし）は skipped 扱い（error と混同しない）
 *   - 更新成功は success として記録される
 *   - 更新失敗は cronError 経由で 500・失敗が記録される
 *   - 残り日数が閾値未満で更新失敗した場合のみ alertError が追加で呼ばれる
 *     （負の対照: 閾値以上なら alertError は呼ばれない）
 */

jest.mock('@/lib/cron-auth');
jest.mock('@/lib/cron-logger', () => {
  const logCronRun = jest.fn().mockResolvedValue(undefined);
  const cronError = jest.fn(async (
    jobName: string,
    startedAt: Date,
    cause: unknown,
    opts: { message?: string; extraLog?: Record<string, unknown>; extraBody?: Record<string, unknown> } = {},
  ) => {
    const error_msg = cause instanceof Error
      ? cause.message
      : (cause && typeof cause === 'object' && 'message' in cause && typeof (cause as any).message === 'string')
        ? (cause as any).message
        : String(cause);
    await logCronRun(jobName, 'error', startedAt, { error_msg, ...opts.extraLog });
    return {
      status: 500,
      json: async () => ({ error: opts.message ?? 'Internal error', ...opts.extraBody }),
    };
  });
  return { logCronRun, cronError };
});
jest.mock('@/lib/supabase-server');
jest.mock('@/lib/threads', () => ({
  refreshThreadsToken: jest.fn(),
}));
jest.mock('@/lib/alert', () => ({ alertError: jest.fn() }));

import { checkCronAuth } from '@/lib/cron-auth';
import { logCronRun, cronError } from '@/lib/cron-logger';
import { refreshThreadsToken } from '@/lib/threads';
import { alertError } from '@/lib/alert';
import { GET } from '../route';

function mockRequest(): Request {
  return new Request('https://carelink-jp.com/api/cron/threads-token-refresh', {
    headers: { authorization: 'Bearer test-secret' },
  });
}

function setupSupabase(credsResult: { data: unknown; error: unknown } | null) {
  const maybeSingle = jest.fn().mockResolvedValue(
    credsResult ?? { data: null, error: null }
  );
  const select = jest.fn().mockReturnValue({ maybeSingle });
  const { createServiceRoleClient } = require('@/lib/supabase-server');
  createServiceRoleClient.mockReturnValue({
    from: jest.fn(() => ({ select })),
  });
  return { select, maybeSingle };
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkCronAuth as jest.Mock).mockReturnValue(null);
});

describe('GET /api/cron/threads-token-refresh', () => {
  it('CRON_SECRET が不正なら checkCronAuth の応答をそのまま返す', async () => {
    const unauthorized = { status: 401, json: async () => ({ error: 'Unauthorized' }) };
    (checkCronAuth as jest.Mock).mockReturnValue(unauthorized);
    setupSupabase({ data: null, error: null });

    const res = await GET(mockRequest());

    expect(res).toBe(unauthorized);
  });

  it('threads_credentials 行が無い場合は skipped として正常終了する（未設定=正常）', async () => {
    setupSupabase({ data: null, error: null });

    const res = await GET(mockRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ status: 'skipped', reason: 'not_configured' });
    expect(logCronRun).toHaveBeenCalledWith(
      'threads-token-refresh',
      'skipped',
      expect.any(Date),
      { processed: 0, skipped: 0 }
    );
    expect(refreshThreadsToken).not.toHaveBeenCalled();
    expect(cronError).not.toHaveBeenCalled();
  });

  it('threads_credentials の取得自体が DB エラーなら cronError で 500', async () => {
    setupSupabase({ data: null, error: { message: 'db down' } });

    const res = await GET(mockRequest());

    expect(res.status).toBe(500);
    expect(cronError).toHaveBeenCalledWith(
      'threads-token-refresh',
      expect.any(Date),
      { message: 'db down' },
      { message: 'Internal Server Error' }
    );
    expect(refreshThreadsToken).not.toHaveBeenCalled();
  });

  it('更新成功なら success として記録し expiresAt を返す', async () => {
    const futureExpiry = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000).toISOString();
    setupSupabase({ data: { expires_at: futureExpiry }, error: null });
    (refreshThreadsToken as jest.Mock).mockResolvedValue({
      ok: true,
      expiresAt: '2026-10-20T00:00:00.000Z',
    });

    const res = await GET(mockRequest());
    const body = await res.json();

    expect(body).toEqual({ status: 'ok', expiresAt: '2026-10-20T00:00:00.000Z' });
    expect(logCronRun).toHaveBeenCalledWith(
      'threads-token-refresh',
      'success',
      expect.any(Date),
      { processed: 1, skipped: 0, meta: { expiresAt: '2026-10-20T00:00:00.000Z' } }
    );
    expect(alertError).not.toHaveBeenCalled();
    expect(cronError).not.toHaveBeenCalled();
  });

  it('更新成功時に expiresAt が省略されていても null で記録される（オプショナル分岐）', async () => {
    const futureExpiry = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000).toISOString();
    setupSupabase({ data: { expires_at: futureExpiry }, error: null });
    (refreshThreadsToken as jest.Mock).mockResolvedValue({ ok: true });

    const res = await GET(mockRequest());
    const body = await res.json();

    expect(body).toEqual({ status: 'ok', expiresAt: null });
    expect(logCronRun).toHaveBeenCalledWith(
      'threads-token-refresh',
      'success',
      expect.any(Date),
      { processed: 1, skipped: 0, meta: { expiresAt: null } }
    );
  });

  it('残り日数が十分（閾値以上）な更新失敗では、通常の cronError のみで alertError は呼ばれない', async () => {
    // 14日閾値を大きく超える残り40日
    const futureExpiry = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000).toISOString();
    setupSupabase({ data: { expires_at: futureExpiry }, error: null });
    (refreshThreadsToken as jest.Mock).mockResolvedValue({ ok: false, reason: 'transient network error' });

    const res = await GET(mockRequest());

    expect(res.status).toBe(500);
    expect(alertError).not.toHaveBeenCalled();
    expect(cronError).toHaveBeenCalledWith(
      'threads-token-refresh',
      expect.any(Date),
      expect.objectContaining({ message: 'transient network error' }),
      expect.objectContaining({ extraLog: expect.objectContaining({ meta: expect.any(Object) }) })
    );
  });

  it('🔴 残り日数が閾値未満での更新失敗は、通常通知に加え明示的な緊急アラートを追加で出す', async () => {
    // 残り5日強（閾値14日を下回る・floor 計算の境界で 4→5 にぶれないよう余裕を持たせる）
    const soonExpiry = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000 + 60 * 1000).toISOString();
    setupSupabase({ data: { expires_at: soonExpiry }, error: null });
    (refreshThreadsToken as jest.Mock).mockResolvedValue({ ok: false, reason: 'refresh failed: 401' });

    const res = await GET(mockRequest());

    expect(res.status).toBe(500);
    expect(alertError).toHaveBeenCalledTimes(1);
    const [message, opts] = (alertError as jest.Mock).mock.calls[0];
    expect(message).toContain('残り5日');
    expect(message).toContain('refresh failed: 401');
    expect(opts).toEqual({ route: '/api/cron/threads-token-refresh' });
  });

  it('既に失効済み（残り日数が負）での更新失敗でも緊急アラートが出る（境界: 0日未満は0でクランプ表示）', async () => {
    const pastExpiry = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    setupSupabase({ data: { expires_at: pastExpiry }, error: null });
    (refreshThreadsToken as jest.Mock).mockResolvedValue({
      ok: false,
      reason: 'token already expired; manual re-authorization required',
    });

    const res = await GET(mockRequest());

    expect(res.status).toBe(500);
    expect(alertError).toHaveBeenCalledTimes(1);
    const [message] = (alertError as jest.Mock).mock.calls[0];
    expect(message).toContain('残り0日');
  });

  it('緊急アラート対象で reason が無い場合は "unknown" を文言に使う', async () => {
    const soonExpiry = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000 + 60 * 1000).toISOString();
    setupSupabase({ data: { expires_at: soonExpiry }, error: null });
    (refreshThreadsToken as jest.Mock).mockResolvedValue({ ok: false });

    const res = await GET(mockRequest());

    expect(res.status).toBe(500);
    expect(alertError).toHaveBeenCalledTimes(1);
    const [message] = (alertError as jest.Mock).mock.calls[0];
    expect(message).toContain('unknown');
  });

  it('更新失敗の reason が無い場合は既定文言で cronError に渡す', async () => {
    const futureExpiry = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000).toISOString();
    setupSupabase({ data: { expires_at: futureExpiry }, error: null });
    (refreshThreadsToken as jest.Mock).mockResolvedValue({ ok: false });

    const res = await GET(mockRequest());

    expect(res.status).toBe(500);
    expect(cronError).toHaveBeenCalledWith(
      'threads-token-refresh',
      expect.any(Date),
      expect.objectContaining({ message: 'Threads token refresh failed' }),
      expect.any(Object)
    );
  });

  it('未捕捉の例外は cronError で 500 になる', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockImplementation(() => {
      throw new Error('boom');
    });

    const res = await GET(mockRequest());

    expect(res.status).toBe(500);
    expect(cronError).toHaveBeenCalledWith(
      'threads-token-refresh',
      expect.any(Date),
      expect.any(Error)
    );
  });
});
