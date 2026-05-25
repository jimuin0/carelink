/**
 * @jest-environment node
 *
 * Tests for src/lib/alert.ts
 * - SLACK_WEBHOOK_URL 未設定時は無投稿
 * - level / route / status / extra を含む構造化メッセージ
 * - 秘密 key 自動 redact
 * - fetch 失敗で throw しない（fire-and-forget）
 */

import { postAlert, alertError, alertWarning } from '../alert';

describe('alert', () => {
  let originalFetch: typeof fetch;
  let mockFetch: jest.Mock;
  const ORIGINAL_URL = process.env.SLACK_WEBHOOK_URL;

  beforeEach(() => {
    originalFetch = global.fetch;
    mockFetch = jest.fn().mockResolvedValue(new Response('ok'));
    global.fetch = mockFetch as unknown as typeof fetch;
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/TEST/TEST/TEST';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (ORIGINAL_URL === undefined) delete process.env.SLACK_WEBHOOK_URL;
    else process.env.SLACK_WEBHOOK_URL = ORIGINAL_URL;
  });

  test('SLACK_WEBHOOK_URL 未設定 → 投稿しない', async () => {
    delete process.env.SLACK_WEBHOOK_URL;
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

  test('長文 extra は 200 文字で切り詰める', async () => {
    postAlert({
      level: 'info',
      message: 'long extra',
      extra: { huge: 'x'.repeat(500) },
    });
    await new Promise((r) => setTimeout(r, 50));
    const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
    // 切り詰め後は 200 文字 + '...' を含む
    expect(body.text).toContain('...');
    expect(body.text).not.toContain('x'.repeat(300));
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
});
