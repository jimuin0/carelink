/**
 * @jest-environment node
 *
 * Tests for GET /api/alert-check（本番 Slack アラート配線の自己テスト）
 * Key assertions:
 *   - ALERT_CHECK_TOKEN 未設定 → 500
 *   - token 不一致 / 欠落 → 401（timing-safe）
 *   - 正規 token + fire なし → 200 fired:false（dry check）
 *   - 正規 token + fire=1 → alertError 発火 + slackConfigured 可視化
 */

jest.mock('@/lib/alert', () => ({ alertError: jest.fn() }));

import { alertError } from '@/lib/alert';
import { GET } from '../route';

const TOKEN = 'test-alert-token-1234567890';

function req(qs: string): Request {
  return new Request(`https://carelink-jp.com/api/alert-check${qs}`);
}

const ENV_KEYS = [
  'ALERT_CHECK_TOKEN',
  'SLACK_BOT_TOKEN',
  'SLACK_DEFAULT_CHANNEL',
  'VERCEL_GIT_COMMIT_SHA',
  'VERCEL_ENV',
];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  (alertError as jest.Mock).mockClear();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

test('ALERT_CHECK_TOKEN 未設定 → 500', async () => {
  const res = await GET(req('?token=x&fire=1'));
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ ok: false, message: 'ALERT_CHECK_TOKEN not configured' });
  expect(alertError).not.toHaveBeenCalled();
});

test('token 不一致（同長・内容違い）→ 401', async () => {
  process.env.ALERT_CHECK_TOKEN = TOKEN;
  const wrong = 'X'.repeat(TOKEN.length);
  const res = await GET(req(`?token=${wrong}&fire=1`));
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ ok: false, message: 'invalid token' });
  expect(alertError).not.toHaveBeenCalled();
});

test('token 欠落 → 401', async () => {
  process.env.ALERT_CHECK_TOKEN = TOKEN;
  const res = await GET(req('?fire=1'));
  expect(res.status).toBe(401);
  expect(alertError).not.toHaveBeenCalled();
});

test('正規 token + fire なし → 200 fired:false（dry check）', async () => {
  process.env.ALERT_CHECK_TOKEN = TOKEN;
  process.env.SLACK_BOT_TOKEN = 'xoxb-abc';
  process.env.SLACK_DEFAULT_CHANNEL = 'C123';
  const res = await GET(req(`?token=${TOKEN}`));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.fired).toBe(false);
  expect(body.slackConfigured).toBe(true);
  expect(alertError).not.toHaveBeenCalled();
});

test('正規 token + fire=1 + Slack設定あり + commit/env あり → fired:true・alertError発火', async () => {
  process.env.ALERT_CHECK_TOKEN = TOKEN;
  process.env.SLACK_BOT_TOKEN = 'xoxb-abc';
  process.env.SLACK_DEFAULT_CHANNEL = 'C123';
  process.env.VERCEL_GIT_COMMIT_SHA = 'abcdef1234567';
  process.env.VERCEL_ENV = 'production';
  const res = await GET(req(`?token=${TOKEN}&fire=1`));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toMatchObject({ ok: true, fired: true, slackConfigured: true });
  expect(alertError).toHaveBeenCalledTimes(1);
  const [, opts] = (alertError as jest.Mock).mock.calls[0];
  expect(opts).toMatchObject({
    route: '/api/alert-check',
    status: 200,
    commit_sha: 'abcdef1',
    env: 'production',
  });
});

test('fire=1 + SLACK_BOT_TOKEN あり・CHANNEL 欠落 → slackConfigured:false', async () => {
  process.env.ALERT_CHECK_TOKEN = TOKEN;
  process.env.SLACK_BOT_TOKEN = 'xoxb-abc';
  const res = await GET(req(`?token=${TOKEN}&fire=1`));
  const body = await res.json();
  expect(body.fired).toBe(true);
  expect(body.slackConfigured).toBe(false);
  expect(body.message).toContain('未設定');
  expect(alertError).toHaveBeenCalledTimes(1);
});

test('fire=1 + SLACK_BOT_TOKEN 欠落 + commit/env 欠落 → slackConfigured:false・commit_sha=null・env=NODE_ENV', async () => {
  process.env.ALERT_CHECK_TOKEN = TOKEN;
  // SLACK_* 未設定 / VERCEL_* 未設定（NODE_ENV は jest が 'test' を設定）
  const res = await GET(req(`?token=${TOKEN}&fire=1`));
  const body = await res.json();
  expect(body.slackConfigured).toBe(false);
  expect(alertError).toHaveBeenCalledTimes(1);
  const [, opts] = (alertError as jest.Mock).mock.calls[0];
  expect(opts.commit_sha).toBeNull();
  expect(opts.env).toBe('test');
});
