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

import {
  postToSlack,
  replyInThread,
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
