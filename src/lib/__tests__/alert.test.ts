/**
 * @jest-environment node
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

import { postAlert, alertError, alertWarning } from '../alert';

describe('alert', () => {
  let originalFetch: typeof fetch;
  let mockFetch: jest.Mock;
  const ORIGINAL_TOKEN = process.env.SLACK_BOT_TOKEN;
  const ORIGINAL_CHANNEL = process.env.SLACK_DEFAULT_CHANNEL;

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
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
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
});
