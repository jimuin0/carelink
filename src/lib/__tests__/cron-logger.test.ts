/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * Tests for lib/cron-logger.ts
 * Covers: logCronRun, withCronLog
 */

const mockInsert = jest.fn().mockResolvedValue({});
const mockFrom = jest.fn().mockReturnValue({ insert: mockInsert });

jest.mock('../supabase-server', () => ({
  createServiceRoleClient: jest.fn(() => ({ from: mockFrom })),
}));

// cron 失敗時の Slack 通報を検証するため alert をモック化（実投稿させない）
jest.mock('../alert', () => ({
  alertCaughtError: jest.fn(),
}));

// admin-dashboard heartbeat 送信を検証するためモック化（実送信させない）
jest.mock('../admin-heartbeat', () => ({
  pushAdminHeartbeat: jest.fn().mockResolvedValue(undefined),
}));

import { logCronRun, withCronLog, cronError } from '../cron-logger';
import { alertCaughtError } from '../alert';
import { pushAdminHeartbeat } from '../admin-heartbeat';

beforeEach(() => {
  jest.clearAllMocks();
  mockInsert.mockResolvedValue({});
});

describe('logCronRun', () => {
  test('inserts success log with all fields', async () => {
    const startedAt = new Date('2026-04-01T10:00:00.000Z');
    await logCronRun('booking-reminder', 'success', startedAt, { processed: 5, skipped: 2 });
    expect(mockFrom).toHaveBeenCalledWith('cron_logs');
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      job_name: 'booking-reminder',
      status: 'success',
      processed: 5,
      skipped: 2,
    }));
  });

  test('uses defaults for missing result fields', async () => {
    const startedAt = new Date();
    await logCronRun('test-job', 'skipped', startedAt);
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      processed: 0,
      skipped: 0,
      error_msg: null,
      meta: null,
    }));
  });

  test('inserts error log with error_msg', async () => {
    const startedAt = new Date();
    await logCronRun('test-job', 'error', startedAt, { error_msg: 'Something went wrong' });
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      status: 'error',
      error_msg: 'Something went wrong',
    }));
  });

  test('error → Slack alert (alertCaughtError) を発火する', async () => {
    await logCronRun('test-job', 'error', new Date(), { error_msg: 'boom' });
    expect(alertCaughtError).toHaveBeenCalledTimes(1);
    const [tag, err, route] = (alertCaughtError as jest.Mock).mock.calls[0];
    expect(tag).toBe('cron:test-job');
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('boom');
    expect(route).toBe('/api/cron/test-job');
  });

  test('error_msg 未指定 → unknown error で通報する', async () => {
    await logCronRun('test-job', 'error', new Date());
    const [, err] = (alertCaughtError as jest.Mock).mock.calls[0];
    expect((err as Error).message).toBe('unknown error');
  });

  test('success → Slack alert を発火しない（誤通報防止）', async () => {
    await logCronRun('test-job', 'success', new Date(), { processed: 1 });
    expect(alertCaughtError).not.toHaveBeenCalled();
  });

  test('skipped → Slack alert を発火しない', async () => {
    await logCronRun('test-job', 'skipped', new Date());
    expect(alertCaughtError).not.toHaveBeenCalled();
  });

  test('DB insert 失敗時でも error は通報する（記録失敗こそ通報必要）', async () => {
    mockInsert.mockRejectedValue(new Error('DB error'));
    await logCronRun('test-job', 'error', new Date(), { error_msg: 'x' });
    expect(alertCaughtError).toHaveBeenCalledTimes(1);
  });

  test('does not throw when DB insert fails (fire-and-forget)', async () => {
    mockInsert.mockRejectedValue(new Error('DB error'));
    await expect(logCronRun('test-job', 'success', new Date())).resolves.toBeUndefined();
  });

  // C-5 根治: insert() は例外を投げず戻り値の { error } にDBレベル失敗を格納する
  // （RLS拒否・制約違反等）。この戻り値を無視すると catch{} に到達せず insert 失敗が
  // 完全に不可視化される（実際に「配信は成功したのに cron_logs にログが無い」と
  // 誤解される事案があった）。console.error で可視化されることを検証する。
  test('DB insert が戻り値の error を返す(reject しない)場合も console.error で可視化する', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    mockInsert.mockResolvedValue({ error: { message: 'RLS violation' } });
    await logCronRun('test-job', 'success', new Date());
    expect(consoleSpy).toHaveBeenCalledWith(
      '[cron-logger] cron_logs insert failed — this run will be invisible in monitoring',
      expect.objectContaining({ jobName: 'test-job', status: 'success' }),
    );
    consoleSpy.mockRestore();
  });

  test('例外(reject)時も console.error で可視化する', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    mockInsert.mockRejectedValue(new Error('network down'));
    await logCronRun('test-job', 'success', new Date());
    expect(consoleSpy).toHaveBeenCalledWith(
      '[cron-logger] cron_logs insert threw',
      expect.objectContaining({ jobName: 'test-job', status: 'success' }),
    );
    consoleSpy.mockRestore();
  });

  test('includes meta when provided', async () => {
    const startedAt = new Date();
    await logCronRun('test-job', 'success', startedAt, { meta: { count: 10, source: 'api' } });
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      meta: { count: 10, source: 'api' },
    }));
  });

  // toJsonValue の Array.isArray 分岐（配列は map で再帰変換してそのまま配列として返す）を
  // 実際に通す。meta に配列値を含めても構造・要素が保たれたまま挿入されることを固定する。
  test('meta に配列を含む → Array.isArray 分岐を通り配列のまま挿入される', async () => {
    const startedAt = new Date();
    await logCronRun('test-job', 'success', startedAt, { meta: { ids: ['a', 'b'] } });
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      meta: { ids: ['a', 'b'] },
    }));
  });

  // toJsonValue の安全側フォールバック（JSON化不能な値は null に変換される）を固定する。
  // 関数値は typeof が 'object' でも配列でもないため toJsonValue の最終 `return null` に
  // 到達する。コメントで主張している契約なので、実際にその挙動をテストで検証する。
  test('meta に JSON化不能な値（関数）を含む → 該当キーは null に変換されて挿入される', async () => {
    const startedAt = new Date();
    await logCronRun('test-job', 'success', startedAt, { meta: { fn: () => {} } });
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      meta: { fn: null },
    }));
  });

  // toJsonValue の `if (v !== undefined)` 分岐（undefined 値のキーは出力オブジェクトに
  // 含めない）の false 側（＝値が undefined でキーごと落とす経路）を通す。
  // JSON.stringify も undefined プロパティを省略するため、これは既存の JSON 化の常識に
  // 合わせた意図的な仕様（Json 型が undefined を許容しないための整合）。
  test('meta にキーの値が undefined のプロパティを含む → そのキーごと出力から除外される', async () => {
    const startedAt = new Date();
    await logCronRun('test-job', 'success', startedAt, { meta: { kept: 1, dropped: undefined } });
    const insertedMeta = mockInsert.mock.calls[0][0].meta;
    expect(insertedMeta).toEqual({ kept: 1 });
    expect(Object.prototype.hasOwnProperty.call(insertedMeta, 'dropped')).toBe(false);
  });

  test('success → admin heartbeat を ok で送信する', async () => {
    await logCronRun('booking-reminder', 'success', new Date());
    expect(pushAdminHeartbeat).toHaveBeenCalledWith('booking-reminder', 'ok');
  });

  test('skipped → admin heartbeat を degraded で送信する', async () => {
    await logCronRun('test-job', 'skipped', new Date());
    expect(pushAdminHeartbeat).toHaveBeenCalledWith('test-job', 'degraded');
  });

  test('error → admin heartbeat を fail で送信する', async () => {
    await logCronRun('test-job', 'error', new Date(), { error_msg: 'boom' });
    expect(pushAdminHeartbeat).toHaveBeenCalledWith('test-job', 'fail');
  });

  test('DB insert 失敗時でも admin heartbeat は送信される（記録失敗と無関係に本体結果を通知）', async () => {
    mockInsert.mockRejectedValue(new Error('DB error'));
    await logCronRun('test-job', 'success', new Date());
    expect(pushAdminHeartbeat).toHaveBeenCalledWith('test-job', 'ok');
  });
});

describe('cronError', () => {
  // cronError() は「logCronRun('error', ...) を呼ぶ」と「500 の NextResponse を返す」を
  // 1回の呼び出しに束ねる（片方だけを行うことを構造的に不可能にする）ためのヘルパー。
  // ここでは cron ルート側（自動 mock 経由で cronError 自体を差し替えている）ではなく、
  // cron-logger.ts 内の実装そのものを検証する（route.ts 側のテストは cronError をモック化
  // しているため、実装の分岐カバレッジはここでしか取れない）。

  test('opts 省略 → error_msg はメッセージそのまま・body は既定の Internal error', async () => {
    const startedAt = new Date('2026-04-01T10:00:00.000Z');
    const res = await cronError('my-job', startedAt, new Error('boom'));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: 'Internal error' });

    expect(mockFrom).toHaveBeenCalledWith('cron_logs');
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      job_name: 'my-job',
      status: 'error',
      error_msg: 'boom',
    }));
  });

  test('cause が Error でない（PostgrestError 相当・非Error）→ errorMessage() 経由で .message を拾う', async () => {
    const startedAt = new Date();
    // PostgrestError は実際には Error を継承するが、cronError の error_msg 生成は
    // errorMessage() を経由するため「Error を継承しないが .message を持つ」値でも
    // 同じ結果になることを固定する（instanceof のみに狭めた実装への回帰防止）。
    const pseudoPostgrestError = { message: 'db exploded', code: '42P01' };
    await cronError('my-job', startedAt, pseudoPostgrestError);

    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      error_msg: 'db exploded',
    }));
  });

  test('opts.message / extraLog / extraBody を指定 → body とログの両方に反映される', async () => {
    const startedAt = new Date();
    const res = await cronError('flag-reviews', startedAt, new Error('boom'), {
      message: 'error',
      extraLog: { error_msg: 'overridden by extraLog' },
      extraBody: { flagged: 3 },
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: 'error', flagged: 3 });

    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      job_name: 'flag-reviews',
      status: 'error',
      // extraLog の error_msg が cause から計算した既定値より優先される
      // （固定文字列の error_msg を渡していた既存呼び出しの再現に使う仕組み）。
      error_msg: 'overridden by extraLog',
    }));
  });

  test('error → Slack 通知（logCronRun 経由の alertCaughtError）が1回だけ発火する', async () => {
    await cronError('my-job', new Date(), new Error('boom'));
    expect(alertCaughtError).toHaveBeenCalledTimes(1);
    const [tag, err] = (alertCaughtError as jest.Mock).mock.calls[0];
    expect(tag).toBe('cron:my-job');
    expect((err as Error).message).toBe('boom');
  });
});

describe('withCronLog', () => {
  test('success: calls fn, logs success, returns result with _logged', async () => {
    const fn = jest.fn().mockResolvedValue({ processed: 3, skipped: 1 });
    const result = await withCronLog('my-job', fn);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.processed).toBe(3);
    expect(result.skipped).toBe(1);
    expect(result._logged).toBe(true);
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      job_name: 'my-job',
      status: 'success',
    }));
  });

  test('error: catches fn error, logs error, re-throws', async () => {
    const err = new Error('Job failed');
    const fn = jest.fn().mockRejectedValue(err);

    await expect(withCronLog('failing-job', fn)).rejects.toThrow('Job failed');
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      job_name: 'failing-job',
      status: 'error',
      error_msg: 'Job failed',
    }));
  });

  test('error: non-Error thrown → logs string representation', async () => {
    const fn = jest.fn().mockRejectedValue('string error');
    await expect(withCronLog('test-job', fn)).rejects.toBe('string error');
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      error_msg: 'string error',
    }));
  });
});
