/**
 * @jest-environment node
 *
 * Tests for src/lib/slack.ts (Phase 7a)
 * - chat.postMessage を Bearer token 付きで叩く
 * - SLACK_BOT_TOKEN / SLACK_DEFAULT_CHANNEL 未設定時の安全な失敗
 * - thread_ts / blocks / username / icon_emoji の透過
 * - Block Kit ヘルパー（section / button / actions / header）
 * - 失敗時 throw しない（fire-and-forget 安全）
 */

// Phase 7c: postToSlackWithThreadGrouping は supabase RPC を呼ぶ
// テストでは RPC 戻り値を差し替えて挙動を検証する
const mockRpc = jest.fn();
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ rpc: mockRpc }),
}));

import {
  postToSlack,
  replyInThread,
  postToSlackWithThreadGrouping,
  sectionBlock,
  dividerBlock,
  buttonElement,
  linkButtonElement,
  actionsBlock,
  headerBlock,
  contextBlock,
} from '../slack';

describe('postToSlack', () => {
  let originalFetch: typeof fetch;
  let mockFetch: jest.Mock;
  const ORIGINAL_TOKEN = process.env.SLACK_BOT_TOKEN;
  const ORIGINAL_CHANNEL = process.env.SLACK_DEFAULT_CHANNEL;

  beforeEach(() => {
    originalFetch = global.fetch;
    mockFetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, ts: '1234.5678', channel: 'C0TESTCHAN' }), {
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

  test('テキスト投稿が chat.postMessage を呼ぶ', async () => {
    const res = await postToSlack({ text: 'hello' });
    expect(res.ok).toBe(true);
    expect(res.ts).toBe('1234.5678');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://slack.com/api/chat.postMessage',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer xoxb-test-token',
          'Content-Type': 'application/json; charset=utf-8',
        }),
      })
    );
    const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.channel).toBe('C0TESTCHAN');
    expect(body.text).toBe('hello');
  });

  test('SLACK_BOT_TOKEN 未設定 → ok:false, error: not_configured', async () => {
    delete process.env.SLACK_BOT_TOKEN;
    const res = await postToSlack({ text: 'x' });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('not_configured');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('SLACK_DEFAULT_CHANNEL 未設定 + channel 引数なし → ok:false, error: no_channel', async () => {
    delete process.env.SLACK_DEFAULT_CHANNEL;
    const res = await postToSlack({ text: 'x' });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('no_channel');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('channel 引数で env を上書きできる', async () => {
    await postToSlack({ text: 'hi', channel: 'C0OVERRIDE' });
    const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.channel).toBe('C0OVERRIDE');
  });

  test('text/blocks 両方未指定 → ok:false, error: empty_payload', async () => {
    const res = await postToSlack({});
    expect(res.ok).toBe(false);
    expect(res.error).toBe('empty_payload');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('blocks を渡すと body に含まれる', async () => {
    const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: 'b' } }];
    await postToSlack({ text: 'fallback', blocks });
    const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.blocks).toEqual(blocks);
    expect(body.text).toBe('fallback');
  });

  test('thread_ts / reply_broadcast / username / icon_emoji を透過', async () => {
    await postToSlack({
      text: 'reply',
      thread_ts: '999.111',
      reply_broadcast: true,
      username: 'Alert Bot',
      icon_emoji: ':warning:',
    });
    const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.thread_ts).toBe('999.111');
    expect(body.reply_broadcast).toBe(true);
    expect(body.username).toBe('Alert Bot');
    expect(body.icon_emoji).toBe(':warning:');
  });

  test('Slack API が ok:false 応答 → result.error にコードを格納', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error: 'channel_not_found' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const res = await postToSlack({ text: 'x' });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('channel_not_found');
  });

  test('HTTP エラーレスポンス → result.error に http_<status>', async () => {
    mockFetch.mockResolvedValueOnce(new Response('', { status: 500 }));
    const res = await postToSlack({ text: 'x' });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('http_500');
  });

  test('fetch 自体が throw → result.ok:false で吸収（throw しない）', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network down'));
    const res = await postToSlack({ text: 'x' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('network down');
  });
});

describe('replyInThread', () => {
  let originalFetch: typeof fetch;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    originalFetch = global.fetch;
    mockFetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, ts: 'r1' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    );
    global.fetch = mockFetch as unknown as typeof fetch;
    process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('channel と thread_ts を必ず付与する', async () => {
    await replyInThread('C0AAAA', '999.000', 'follow-up');
    const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.channel).toBe('C0AAAA');
    expect(body.thread_ts).toBe('999.000');
    expect(body.text).toBe('follow-up');
  });
});

describe('postToSlackWithThreadGrouping (Phase 7c)', () => {
  let originalFetch: typeof fetch;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    originalFetch = global.fetch;
    mockFetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, ts: '999.111', channel: 'C0TESTCHAN' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    );
    global.fetch = mockFetch as unknown as typeof fetch;
    process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';
    process.env.SLACK_DEFAULT_CHANNEL = 'C0TESTCHAN';
    mockRpc.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('既存スレッド無し → 親メッセージとして post + record_incident_thread を呼ぶ', async () => {
    // get_incident_thread → 空（既存なし）
    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    // record_incident_thread → 成功
    mockRpc.mockResolvedValueOnce({ data: null, error: null });

    const res = await postToSlackWithThreadGrouping({
      thread_key: 'alert:error:route=/api/profile:commit=abc1234',
      text: 'first 500',
    });

    expect(res.ok).toBe(true);
    expect(res.ts).toBe('999.111');

    // 1 回目: get_incident_thread
    expect(mockRpc).toHaveBeenNthCalledWith(1, 'get_incident_thread', {
      p_key: 'alert:error:route=/api/profile:commit=abc1234',
    });
    // 2 回目: record_incident_thread
    expect(mockRpc).toHaveBeenNthCalledWith(2, 'record_incident_thread', {
      p_key: 'alert:error:route=/api/profile:commit=abc1234',
      p_channel: 'C0TESTCHAN',
      p_thread_ts: '999.111',
    });

    // 親 post なので thread_ts は付かない
    const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.thread_ts).toBeUndefined();
  });

  test('既存スレッド有り → reply (thread_ts 付与)、record は呼ばない', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ channel: 'C0TESTCHAN', thread_ts: '555.222' }],
      error: null,
    });

    const res = await postToSlackWithThreadGrouping({
      thread_key: 'alert:error:route=/api/profile:commit=abc1234',
      text: 'second 500',
    });

    expect(res.ok).toBe(true);
    // RPC は get_incident_thread のみ（record は呼ばれない）
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('get_incident_thread', {
      p_key: 'alert:error:route=/api/profile:commit=abc1234',
    });

    // thread_ts 付き reply
    const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.thread_ts).toBe('555.222');
  });

  test('RPC 失敗 → 通常投稿にフォールバック', async () => {
    mockRpc.mockRejectedValueOnce(new Error('RPC down'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    const res = await postToSlackWithThreadGrouping({
      thread_key: 'alert:error',
      text: 'fallback test',
    });

    expect(res.ok).toBe(true);
    const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.thread_ts).toBeUndefined();
    consoleSpy.mockRestore();
  });

  test('チャンネル env 未設定 → no_channel', async () => {
    delete process.env.SLACK_DEFAULT_CHANNEL;
    const res = await postToSlackWithThreadGrouping({
      thread_key: 'x',
      text: 'no channel',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('no_channel');
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('Block Kit ヘルパー', () => {
  test('sectionBlock(text)', () => {
    expect(sectionBlock('hi')).toEqual({
      type: 'section',
      text: { type: 'mrkdwn', text: 'hi' },
    });
  });

  test('sectionBlock(text, fields)', () => {
    const b = sectionBlock('hi', ['*a*', '*b*']);
    expect(b.fields).toEqual([
      { type: 'mrkdwn', text: '*a*' },
      { type: 'mrkdwn', text: '*b*' },
    ]);
  });

  test('dividerBlock', () => {
    expect(dividerBlock()).toEqual({ type: 'divider' });
  });

  test('buttonElement: minimal', () => {
    expect(buttonElement('Click', 'do_thing')).toEqual({
      type: 'button',
      text: { type: 'plain_text', text: 'Click', emoji: true },
      action_id: 'do_thing',
    });
  });

  test('buttonElement: with value and style', () => {
    const b = buttonElement('Yes', 'confirm', 'payload-1', 'primary') as Record<string, unknown>;
    expect(b.value).toBe('payload-1');
    expect(b.style).toBe('primary');
  });

  test('linkButtonElement', () => {
    const b = linkButtonElement('Open', 'https://example.com') as Record<string, unknown>;
    expect(b.url).toBe('https://example.com');
    expect((b.text as { text: string }).text).toBe('Open');
  });

  test('actionsBlock', () => {
    const els = [buttonElement('A', 'a'), buttonElement('B', 'b')];
    expect(actionsBlock(els)).toEqual({ type: 'actions', elements: els });
  });

  test('headerBlock', () => {
    expect(headerBlock('Title')).toEqual({
      type: 'header',
      text: { type: 'plain_text', text: 'Title', emoji: true },
    });
  });

  test('contextBlock', () => {
    expect(contextBlock(['a', 'b'])).toEqual({
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: 'a' },
        { type: 'mrkdwn', text: 'b' },
      ],
    });
  });
});
