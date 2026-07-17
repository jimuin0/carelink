/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * Tests for src/lib/alert.ts (Phase 7a: Bot Token 経由に更新)
 * - SLACK_BOT_TOKEN/SLACK_DEFAULT_CHANNEL 未設定時は無投稿
 * - level / route / status / extra を含む構造化メッセージ
 * - 秘密 key 自動 redact
 * - postToSlack 失敗で throw しない（fire-and-forget）
 */

// Phase 7c: alert.ts は postToSlackWithThreadGrouping 経由
// supabase-server を mock し、RPC は空配列を返す（既存スレッドなし → 通常投稿）
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: jest.fn(() => ({
    rpc: jest.fn().mockResolvedValue({ data: [], error: null }),
  })),
}));

import { postAlert, alertError, alertWarning, alertCaughtError, alertDeliveryFailures } from '../alert';

describe('alert', () => {
  let originalFetch: typeof fetch;
  let mockFetch: jest.Mock;
  const ORIGINAL_TOKEN = process.env.SLACK_BOT_TOKEN;
  const ORIGINAL_CHANNEL = process.env.SLACK_DEFAULT_CHANNEL;
  const ORIGINAL_COMMIT = process.env.VERCEL_GIT_COMMIT_SHA;
  const ORIGINAL_VERCEL_ENV = process.env.VERCEL_ENV;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  beforeEach(() => {
    originalFetch = global.fetch;
    mockFetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, ts: '123.456', channel: 'C0TESTCHAN' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    );
    global.fetch = mockFetch as unknown as typeof fetch;
    process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';
    process.env.SLACK_DEFAULT_CHANNEL = 'C0TESTCHAN';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (ORIGINAL_TOKEN === undefined) delete process.env.SLACK_BOT_TOKEN;
    else process.env.SLACK_BOT_TOKEN = ORIGINAL_TOKEN;
    if (ORIGINAL_CHANNEL === undefined) delete process.env.SLACK_DEFAULT_CHANNEL;
    else process.env.SLACK_DEFAULT_CHANNEL = ORIGINAL_CHANNEL;
    if (ORIGINAL_COMMIT === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
    else process.env.VERCEL_GIT_COMMIT_SHA = ORIGINAL_COMMIT;
    if (ORIGINAL_VERCEL_ENV === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = ORIGINAL_VERCEL_ENV;
    if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  });

  test('SLACK_BOT_TOKEN 未設定 → 投稿しない', async () => {
    delete process.env.SLACK_BOT_TOKEN;
    postAlert({ level: 'error', message: 'test' });
    await new Promise((r) => setTimeout(r, 50));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('SLACK_DEFAULT_CHANNEL 未設定 → 投稿しない', async () => {
    delete process.env.SLACK_DEFAULT_CHANNEL;
    postAlert({ level: 'error', message: 'test' });
    await new Promise((r) => setTimeout(r, 50));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('error level → 🔴 を含む', async () => {
    alertError('something broke', { route: '/api/profile', status: 500 });
    await new Promise((r) => setTimeout(r, 50));
    expect(mockFetch).toHaveBeenCalled();
    const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.text).toContain('🔴');
    expect(body.text).toContain('ERROR');
    expect(body.text).toContain('/api/profile');
    expect(body.text).toContain('500');
  });

  test('warning level → 🟡 を含む', async () => {
    alertWarning('be careful');
    await new Promise((r) => setTimeout(r, 50));
    const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.text).toContain('🟡');
    expect(body.text).toContain('WARNING');
  });

  test('chat.postMessage エンドポイント宛 + Authorization Bearer ヘッダ', async () => {
    alertError('msg');
    await new Promise((r) => setTimeout(r, 50));
    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toBe('https://slack.com/api/chat.postMessage');
    const init = mockFetch.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer xoxb-test-token');
    const body = JSON.parse(init.body as string);
    expect(body.channel).toBe('C0TESTCHAN');
  });

  test('extra の秘密 key を redact する', async () => {
    postAlert({
      level: 'error',
      message: 'leak test',
      extra: {
        api_token: 'super-secret-value',
        password: 'p@ssw0rd',
        AUTHORIZATION: 'Bearer xxx',
        public_field: 'visible',
      },
    });
    await new Promise((r) => setTimeout(r, 50));
    const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.text).toContain('****REDACTED****');
    expect(body.text).toContain('visible');
    expect(body.text).not.toContain('super-secret-value');
    expect(body.text).not.toContain('p@ssw0rd');
    expect(body.text).not.toContain('Bearer xxx');
  });

  test('fetch 失敗で throw しない（fire-and-forget）', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Slack down'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    expect(() => alertError('test', {})).not.toThrow();
    await new Promise((r) => setTimeout(r, 50));
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[alert] Slack post failed'),
      expect.anything()
    );
    consoleSpy.mockRestore();
  });

  test('Slack API が ok:false 応答 → console.error のみ', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error: 'channel_not_found' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    expect(() => alertError('test')).not.toThrow();
    await new Promise((r) => setTimeout(r, 50));
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[alert] Slack post failed'),
      expect.stringContaining('channel_not_found')
    );
    consoleSpy.mockRestore();
  });

  test('長文 extra は 200 文字で切り詰める', async () => {
    postAlert({
      level: 'info',
      message: 'long extra',
      extra: { huge: 'x'.repeat(500) },
    });
    await new Promise((r) => setTimeout(r, 50));
    const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.text).toContain('...');
    expect(body.text).not.toContain('x'.repeat(300));
  });

  test('extra が空オブジェクト {} → コードブロック非追加', async () => {
    postAlert({ level: 'info', message: 'no-extra', extra: {} });
    await new Promise((r) => setTimeout(r, 50));
    const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.text).not.toContain('```');
  });

  test('route/status/commit_sha/env/request_id 全て省略時もメッセージのみ送信', async () => {
    postAlert({ level: 'info', message: 'minimal' });
    await new Promise((r) => setTimeout(r, 50));
    const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.text).toContain('minimal');
    expect(body.text).not.toContain('*route:*');
    expect(body.text).not.toContain('*status:*');
    expect(body.text).not.toContain('*commit:*');
    expect(body.text).not.toContain('*env:*');
    expect(body.text).not.toContain('*request_id:*');
  });

  test('request_id を含む', async () => {
    postAlert({ level: 'error', message: 'msg', request_id: 'req-abc123' });
    await new Promise((r) => setTimeout(r, 50));
    const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.text).toContain('req-abc123');
  });

  test('extra 文字列 200 文字以下は切り詰めなし', async () => {
    postAlert({ level: 'info', message: 'short extra', extra: { short: 'abc' } });
    await new Promise((r) => setTimeout(r, 50));
    const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.text).toContain('"short": "abc"');
  });

  test('非エラーオブジェクト throw 時の最終フォールバック (postToSlackWithThreadGrouping reject with string)', async () => {
    // Force fetch to reject with non-Error
    mockFetch.mockRejectedValueOnce('string-error');
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    postAlert({ level: 'error', message: 'string-throw' });
    await new Promise((r) => setTimeout(r, 50));
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test('commit_sha / env を含む', async () => {
    alertError('msg', {
      commit_sha: 'abc1234',
      env: 'production',
      route: '/api/health',
    });
    await new Promise((r) => setTimeout(r, 50));
    const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.text).toContain('abc1234');
    expect(body.text).toContain('production');
  });

  // Branch coverage: line 95 (true branch) — e instanceof Error → e.message
  // postToSlackWithThreadGrouping が Error を throw したときに catch が `e.message` を使う
  test('postToSlackWithThreadGrouping が Error を throw → catch の e.message ブランチ', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockImplementation(() => {
      throw new Error('supabase-error');
    });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    postAlert({ level: 'error', message: 'crash-test' });
    await new Promise((r) => setTimeout(r, 100));
    // consoleSpy should have been called via the catch block using e.message
    consoleSpy.mockRestore();
    // Restore default mock
    createServiceRoleClient.mockImplementation(() => ({
      rpc: jest.fn().mockResolvedValue({ data: [], error: null }),
    }));
  });

  // Branch coverage: line 95 (false branch) — !(e instanceof Error) → String(e)
  // postToSlackWithThreadGrouping が非 Error 値を throw したときに String(e) を使う
  test('postToSlackWithThreadGrouping が非 Error 値を throw → catch の String(e) ブランチ', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockImplementation(() => {
      throw 'non-error-string';
    });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    postAlert({ level: 'error', message: 'string-throw-test' });
    await new Promise((r) => setTimeout(r, 100));
    consoleSpy.mockRestore();
    // Restore default mock
    createServiceRoleClient.mockImplementation(() => ({
      rpc: jest.fn().mockResolvedValue({ data: [], error: null }),
    }));
  });

  describe('alertCaughtError（catch 経路の Slack 通知ヘルパー）', () => {
    test('Error+stack / route 省略 / commit・VERCEL_ENV 設定済 → 全 truthy ブランチ', async () => {
      process.env.VERCEL_GIT_COMMIT_SHA = 'abcdef1234567';
      process.env.VERCEL_ENV = 'production';
      alertCaughtError('with-route', new Error('boom'));
      await new Promise((r) => setTimeout(r, 50));
      expect(mockFetch).toHaveBeenCalled();
      const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.text).toContain('[with-route] boom');
      expect(body.text).toContain('500');
      expect(body.text).toContain('abcdef1'); // 先頭7文字
      expect(body.text).toContain('production');
    });

    test('非 Error / route 指定 / commit 未設定 / VERCEL_ENV 未設定・NODE_ENV 設定 → falsy 側ブランチ', async () => {
      delete process.env.VERCEL_GIT_COMMIT_SHA;
      delete process.env.VERCEL_ENV;
      process.env.NODE_ENV = 'test';
      alertCaughtError('tag', 'string-error', '/api/x');
      await new Promise((r) => setTimeout(r, 50));
      expect(mockFetch).toHaveBeenCalled();
      const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.text).toContain('[tag] string-error');
      expect(body.text).toContain('/api/x');
      expect(body.text).toContain('test'); // NODE_ENV フォールバック
      expect(body.text).not.toContain('*commit:*');
    });

    test('Error（stack 無し）/ VERCEL_ENV・NODE_ENV 両未設定 → stack null・env null ブランチ', async () => {
      delete process.env.VERCEL_GIT_COMMIT_SHA;
      delete process.env.VERCEL_ENV;
      delete process.env.NODE_ENV;
      const err = new Error('no-stack');
      delete err.stack;
      alertCaughtError('tag2', err);
      await new Promise((r) => setTimeout(r, 50));
      expect(mockFetch).toHaveBeenCalled();
      const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.text).toContain('[tag2] no-stack');
      expect(body.text).not.toContain('*env:*');
    });
  });

  describe('alertDeliveryFailures', () => {
    test('failures = 0 → 何も投稿しない（no-op）', async () => {
      alertDeliveryFailures('booking-reminder', 0, { sent: 5 });
      await new Promise((r) => setTimeout(r, 50));
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test('failures < 0 → 何も投稿しない（no-op）', async () => {
      alertDeliveryFailures('booking-reminder', -1);
      await new Promise((r) => setTimeout(r, 50));
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test('failures > 0 → run 集約の warning を1本投稿（route/件数/extra を含む）', async () => {
      process.env.VERCEL_GIT_COMMIT_SHA = 'abcdef1234567';
      alertDeliveryFailures('onboarding-followup', 3, { sent: 7, skipped: 2 });
      await new Promise((r) => setTimeout(r, 50));
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.text).toContain('WARNING');
      expect(body.text).toContain('[onboarding-followup] 送達失敗 3件');
      expect(body.text).toContain('/api/cron/onboarding-followup');
      expect(body.text).toContain('deliveryFailures');
      expect(body.text).toContain('abcdef1'); // commit 7桁
    });

    test('failures > 0・commit/env 全未設定 → commit・env は null（フォールバック分岐）', async () => {
      delete process.env.VERCEL_GIT_COMMIT_SHA;
      delete process.env.VERCEL_ENV;
      delete process.env.NODE_ENV;
      alertDeliveryFailures('webhook-retry', 2, { success: 4 });
      await new Promise((r) => setTimeout(r, 50));
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.text).toContain('[webhook-retry] 送達失敗 2件');
      expect(body.text).not.toContain('*commit:*');
      expect(body.text).not.toContain('*env:*');
    });

    // 【2026年7月17日 dead-letter 文言追加】webhook-retry の scheduleRetry は再送上限到達時に
    // status='failed'（dead-letter・二度と自動再送されない）に倒すが、旧文言は固定で
    // 「翌runで再送」と表示し、dead-letter でも「再送します」と嘘をつく無音バグだった。
    // 第4引数 deadLettered を省略・0 の場合は既存文言のまま（他 cron の呼び出し元 9 箇所は
    // 全て3引数のまま呼んでおり挙動不変であることをここで固定する）。
    test('deadLettered 省略（3引数呼び出し）→ 既存文言のまま（他cron呼び出し元の挙動不変）', async () => {
      alertDeliveryFailures('booking-reminder', 3, { sent: 1 });
      await new Promise((r) => setTimeout(r, 50));
      const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.text).toContain('[booking-reminder] 送達失敗 3件（run集約・翌runで再送）');
      expect(body.text).not.toContain('dead-letter');
    });

    test('deadLettered=0（明示的に4引数目0）→ 既存文言のまま', async () => {
      alertDeliveryFailures('webhook-retry', 3, { success: 1 }, 0);
      await new Promise((r) => setTimeout(r, 50));
      const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.text).toContain('[webhook-retry] 送達失敗 3件（run集約・翌runで再送）');
      expect(body.text).not.toContain('dead-letter');
    });

    test('deadLettered>0 → 文言が dead-letter 向けに差し替わる（再送されない旨を明示）', async () => {
      alertDeliveryFailures('webhook-retry', 3, { success: 1 }, 2);
      await new Promise((r) => setTimeout(r, 50));
      const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.text).toContain('[webhook-retry] 送達失敗 3件（うち2件は再送上限到達=dead-letter・自動再送されない）');
      expect(body.text).not.toContain('翌runで再送');
    });
  });
});
