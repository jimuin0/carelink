/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * Tests for src/lib/admin-heartbeat.ts
 * - ADMIN_HEARTBEAT_URL/TOKEN 未設定時は no-op（fetch を呼ばない）
 * - 成功時は1回で解決
 * - 非2xx / 例外時はリトライし、上限到達で console.error
 * - 常に reject しない（fire-and-forget）
 */

import { pushAdminHeartbeat, _internal } from '../admin-heartbeat';

describe('pushAdminHeartbeat', () => {
  let originalFetch: typeof fetch;
  let mockFetch: jest.Mock;
  let originalSleep: typeof _internal.sleep;
  const ORIGINAL_URL = process.env.ADMIN_HEARTBEAT_URL;
  const ORIGINAL_TOKEN = process.env.ADMIN_HEARTBEAT_TOKEN;

  beforeEach(() => {
    originalFetch = global.fetch;
    originalSleep = _internal.sleep;
    _internal.sleep = jest.fn().mockResolvedValue(undefined);
    process.env.ADMIN_HEARTBEAT_URL = 'https://admin-dashboard-cnpq.onrender.com/api/heartbeat';
    process.env.ADMIN_HEARTBEAT_TOKEN = 'test-token';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    _internal.sleep = originalSleep;
    process.env.ADMIN_HEARTBEAT_URL = ORIGINAL_URL;
    process.env.ADMIN_HEARTBEAT_TOKEN = ORIGINAL_TOKEN;
    jest.restoreAllMocks();
  });

  test('URL未設定なら fetch を呼ばず即解決する', async () => {
    delete process.env.ADMIN_HEARTBEAT_URL;
    mockFetch = jest.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
    await expect(pushAdminHeartbeat('booking-reminder', 'ok')).resolves.toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('TOKEN未設定なら fetch を呼ばず即解決する', async () => {
    delete process.env.ADMIN_HEARTBEAT_TOKEN;
    mockFetch = jest.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
    await expect(pushAdminHeartbeat('booking-reminder', 'ok')).resolves.toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('jobId が空文字なら fetch を呼ばず即解決する', async () => {
    mockFetch = jest.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
    await expect(pushAdminHeartbeat('', 'ok')).resolves.toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('成功時は1回のfetchで解決し、正しいbody/headerを送る', async () => {
    mockFetch = jest.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    global.fetch = mockFetch as unknown as typeof fetch;
    await pushAdminHeartbeat('booking-reminder', 'ok');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://admin-dashboard-cnpq.onrender.com/api/heartbeat');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe('Bearer test-token');
    expect(JSON.parse(opts.body)).toEqual({
      project_id: 'carelink',
      job_id: 'booking-reminder',
      status: 'ok',
    });
  });

  test('degraded/fail ステータスもそのまま送信される', async () => {
    mockFetch = jest.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    global.fetch = mockFetch as unknown as typeof fetch;
    await pushAdminHeartbeat('webhook-retry', 'degraded');
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual(
      expect.objectContaining({ status: 'degraded' }),
    );
  });

  test('非2xx応答時はMAX_ATTEMPTS回まで再試行し、上限到達でconsole.errorする', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    mockFetch = jest.fn().mockResolvedValue(new Response('{}', { status: 500 }));
    global.fetch = mockFetch as unknown as typeof fetch;
    await pushAdminHeartbeat('booking-reminder', 'fail');
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(consoleSpy).toHaveBeenCalledWith(
      '[admin-heartbeat] 送信失敗(リトライ上限)',
      expect.objectContaining({ job_id: 'booking-reminder', status: 'fail', http_status: 500, attempts: 3 }),
    );
  });

  test('2回目の再試行で成功すれば3回目は呼ばれない', async () => {
    mockFetch = jest
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    global.fetch = mockFetch as unknown as typeof fetch;
    await pushAdminHeartbeat('booking-reminder', 'ok');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('fetch が例外を投げた場合もリトライし、上限到達でconsole.errorする', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    mockFetch = jest.fn().mockRejectedValue(new Error('network down'));
    global.fetch = mockFetch as unknown as typeof fetch;
    await pushAdminHeartbeat('booking-reminder', 'fail');
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(consoleSpy).toHaveBeenCalledWith(
      '[admin-heartbeat] 送信失敗(リトライ上限)',
      expect.objectContaining({ job_id: 'booking-reminder', status: 'fail', error: 'network down', attempts: 3 }),
    );
  });

  test('fetch が非Errorをrejectした場合も文字列化してconsole.errorする', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    mockFetch = jest.fn().mockRejectedValue('string rejection');
    global.fetch = mockFetch as unknown as typeof fetch;
    await pushAdminHeartbeat('booking-reminder', 'fail');
    expect(consoleSpy).toHaveBeenCalledWith(
      '[admin-heartbeat] 送信失敗(リトライ上限)',
      expect.objectContaining({ error: 'string rejection' }),
    );
  });

  test('fetch が未設定(non-function)なら早期returnで解決する', async () => {
    // @ts-expect-error 意図的に不正な型を代入して typeof fetch !== 'function' 分岐を発火させる
    global.fetch = undefined;
    await expect(pushAdminHeartbeat('booking-reminder', 'ok')).resolves.toBeUndefined();
  });

  test('try ブロック内で同期例外が発生しても reject せず、console.error で可視化する（外側catch）', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    mockFetch = jest.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
    const jsonSpy = jest.spyOn(JSON, 'stringify').mockImplementationOnce(() => {
      throw new Error('circular structure');
    });
    await expect(pushAdminHeartbeat('booking-reminder', 'ok')).resolves.toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      '[admin-heartbeat] 送信スキップ（内部例外）',
      expect.objectContaining({ job_id: 'booking-reminder', error: 'circular structure' }),
    );
    jsonSpy.mockRestore();
  });

  test('外側catchで非Errorがthrowされた場合も文字列化してconsole.errorする', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    const jsonSpy = jest.spyOn(JSON, 'stringify').mockImplementationOnce(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'string throw';
    });
    await expect(pushAdminHeartbeat('booking-reminder', 'ok')).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalledWith(
      '[admin-heartbeat] 送信スキップ（内部例外）',
      expect.objectContaining({ error: 'string throw' }),
    );
    jsonSpy.mockRestore();
  });
});
