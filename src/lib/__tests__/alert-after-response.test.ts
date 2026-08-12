/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * Slack 通知が「レスポンス後に消えない形」で登録されることを固定する（2026年8月12日 新設）。
 *
 * 🔴 【なぜ必要か】`alertCaughtError` は withRoute の catch から呼ばれる＝【全 500 応答の
 * Slack 通知】がこの経路。従来は `void (async () => { … })()` の浮いた Promise だったため、
 * サーバーレスがレスポンス後にインスタンスを凍結すると通知ごと失われうる。障害に気づけない。
 *
 * 【このテストが守るもの】alert.test.ts は「Slack へ投稿されること」を検証しているが、
 * リクエストスコープ外では after() が throw してフォールバック実行に落ちるため、
 * `void (async…)()` へ戻しても【緑のまま通る】。それでは配線を守れない。
 * ここでは after() が使える文脈を再現し、
 *   ・登録されること
 *   ・登録した時点ではまだ投稿しないこと（応答を遅らせない）
 *   ・ランタイムがコールバックを呼ぶと投稿されること
 * の3点で「after() に載っている」ことを直接固定する。
 */
const mockAfter = jest.fn();
jest.mock('next/server', () => ({
  after: (task: () => Promise<unknown>) => mockAfter(task),
}));

const mockPost = jest.fn();
jest.mock('@/lib/slack', () => ({
  postToSlackWithThreadGrouping: (args: unknown) => mockPost(args),
}));

jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: jest.fn(() => ({
    rpc: jest.fn().mockResolvedValue({ data: [], error: null }),
  })),
}));

import { alertCaughtError } from '../alert';

const ORIGINAL_TOKEN = process.env.SLACK_BOT_TOKEN;
const ORIGINAL_CHANNEL = process.env.SLACK_DEFAULT_CHANNEL;

beforeEach(() => {
  mockAfter.mockReset();
  mockPost.mockReset();
  mockPost.mockResolvedValue({ ok: true });
  process.env.SLACK_BOT_TOKEN = 'xoxb-test';
  process.env.SLACK_DEFAULT_CHANNEL = 'C123';
});

afterAll(() => {
  process.env.SLACK_BOT_TOKEN = ORIGINAL_TOKEN;
  process.env.SLACK_DEFAULT_CHANNEL = ORIGINAL_CHANNEL;
});

test('alertCaughtError は after() に登録し、その時点では投稿しない', async () => {
  alertCaughtError('with-route', new Error('boom'), '/api/profile');

  expect(mockAfter).toHaveBeenCalledTimes(1);
  // マイクロタスクを流しても投稿されない＝応答を遅らせていない
  await Promise.resolve();
  expect(mockPost).not.toHaveBeenCalled();
});

test('ランタイムが登録済みコールバックを呼ぶと Slack へ投稿される', async () => {
  alertCaughtError('with-route', new Error('boom'), '/api/profile');
  await (mockAfter.mock.calls[0][0] as () => Promise<unknown>)();

  expect(mockPost).toHaveBeenCalledTimes(1);
  const arg = mockPost.mock.calls[0][0] as { text: string; thread_key: string };
  expect(arg.text).toContain('[with-route] boom');
  expect(arg.text).toContain('/api/profile');
});

test('Slack 未設定なら after() にも登録しない（無通知が正常系）', () => {
  delete process.env.SLACK_BOT_TOKEN;
  alertCaughtError('with-route', new Error('boom'), '/api/profile');
  expect(mockAfter).not.toHaveBeenCalled();
});
