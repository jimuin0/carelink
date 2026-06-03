/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * Tests for lib/line.ts
 * Covers: sendLinePush, sendLineText, sendBookingConfirmation,
 *         sendBookingCancellation, sendBookingReminder,
 *         verifyLineSignature, sendLineReply
 */

import crypto from 'crypto';
import {
  sendLinePush,
  sendLineText,
  sendBookingConfirmation,
  sendBookingCancellation,
  sendBookingReminder,
  verifyLineSignature,
  sendLineReply,
  getLineLoginChannelId,
  verifyLineAccessToken,
} from '../line';

const MOCK_TOKEN = 'test-channel-access-token';
const MOCK_SECRET = 'test-channel-secret';

beforeEach(() => {
  process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK = MOCK_TOKEN;
  process.env.LINE_CHANNEL_SECRET_CARELINK = MOCK_SECRET;
  jest.useFakeTimers();
});

afterEach(() => {
  delete process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK;
  delete process.env.LINE_CHANNEL_SECRET_CARELINK;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function mockFetchOk() {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, text: async () => '' } as Response);
}

function mockFetchFail(status = 400) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status,
    text: async () => 'error body',
  } as unknown as Response);
}

describe('sendLinePush', () => {
  test('returns true on success', async () => {
    mockFetchOk();
    const result = await sendLinePush('user-1', [{ type: 'text', text: 'hello' }]);
    expect(result).toBe(true);
  });

  test('calls LINE API with correct headers', async () => {
    mockFetchOk();
    await sendLinePush('user-1', [{ type: 'text', text: 'hello' }]);
    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('api.line.me');
    expect(opts.headers['Authorization']).toBe(`Bearer ${MOCK_TOKEN}`);
    expect(opts.headers['Content-Type']).toBe('application/json');
  });

  test('sends correct body', async () => {
    mockFetchOk();
    const messages = [{ type: 'text', text: 'hi' }];
    await sendLinePush('line-user-abc', messages);
    const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.to).toBe('line-user-abc');
    expect(body.messages).toEqual(messages);
  });

  test('retries on failure and returns false after maxRetries', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, text: async () => '' } as unknown as Response);
    const promise = sendLinePush('user-1', [{ type: 'text', text: 'hi' }], 2);
    // advance timers to skip retry delays
    await jest.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('throws if token not set', async () => {
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK;
    await expect(sendLinePush('user-1', [])).rejects.toThrow('LINE_CHANNEL_ACCESS_TOKEN_CARELINK');
  });

  test('returns false on fetch exception', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
    const promise = sendLinePush('user-1', [{ type: 'text', text: 'hi' }], 1);
    await jest.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe(false);
  });

  test('res.text() throws → catch callback returns empty string', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: jest.fn().mockRejectedValue(new Error('text() failed')),
    } as unknown as Response);
    const promise = sendLinePush('user-1', [{ type: 'text', text: 'hi' }], 1);
    await jest.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe(false);
  });

  test('fetch throws with maxRetries=2 → retry delay (catch setTimeout) executed', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
    const promise = sendLinePush('user-1', [{ type: 'text', text: 'hi' }], 2);
    await jest.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('sendLineText', () => {
  test('delegates to sendLinePush with text message', async () => {
    mockFetchOk();
    const result = await sendLineText('user-1', 'Hello');
    expect(result).toBe(true);
    const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.messages[0]).toEqual({ type: 'text', text: 'Hello' });
  });
});

describe('sendBookingConfirmation', () => {
  test('returns true and includes facility name in push', async () => {
    mockFetchOk();
    const result = await sendBookingConfirmation('user-1', {
      facilityName: 'Test Salon',
      menuName: 'Cut',
      date: '2024-01-15',
      time: '10:00',
    });
    expect(result).toBe(true);
    const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.messages[0].text).toContain('Test Salon');
  });

  test('includes staffName when provided', async () => {
    mockFetchOk();
    await sendBookingConfirmation('user-1', {
      facilityName: 'Salon',
      menuName: 'Color',
      date: '2024-01-15',
      time: '14:00',
      staffName: 'Tanaka',
    });
    const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(opts.body).messages[0].text).toContain('Tanaka');
  });

  test('omits staff line when no staffName', async () => {
    mockFetchOk();
    await sendBookingConfirmation('user-1', {
      facilityName: 'Salon',
      menuName: 'Cut',
      date: '2024-01-15',
      time: '10:00',
    });
    const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(opts.body).messages[0].text).not.toContain('担当:');
  });
});

describe('sendBookingCancellation', () => {
  test('returns true and includes cancellation text', async () => {
    mockFetchOk();
    const result = await sendBookingCancellation('user-1', {
      facilityName: 'Test Salon',
      menuName: 'Cut',
      date: '2024-01-15',
      time: '10:00',
    });
    expect(result).toBe(true);
    const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(opts.body).messages[0].text).toContain('キャンセル');
  });
});

describe('sendBookingReminder', () => {
  test('returns true and includes reminder text', async () => {
    mockFetchOk();
    const result = await sendBookingReminder('user-1', {
      facilityName: 'Salon',
      menuName: 'Perm',
      date: '2024-01-15',
      time: '11:00',
    });
    expect(result).toBe(true);
    const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(opts.body).messages[0].text).toContain('リマインド');
  });

  test('includes staffName in reminder when provided', async () => {
    mockFetchOk();
    await sendBookingReminder('user-1', {
      facilityName: 'Salon',
      menuName: 'Perm',
      date: '2024-01-15',
      time: '11:00',
      staffName: 'Yamada',
    });
    const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(opts.body).messages[0].text).toContain('Yamada');
  });
});

describe('verifyLineSignature', () => {
  test('returns true for a valid signature', () => {
    const body = '{"events":[]}';
    const signature = crypto
      .createHmac('SHA256', MOCK_SECRET)
      .update(body)
      .digest('base64');
    expect(verifyLineSignature(body, signature)).toBe(true);
  });

  test('returns false for an invalid signature', () => {
    expect(verifyLineSignature('{"events":[]}', 'badsignature')).toBe(false);
  });

  test('throws if secret not set', () => {
    delete process.env.LINE_CHANNEL_SECRET_CARELINK;
    expect(() => verifyLineSignature('body', 'sig')).toThrow('LINE_CHANNEL_SECRET_CARELINK');
  });

  test('returns false when lengths differ (prevents Buffer exception)', () => {
    const body = 'test';
    // Very short signature (length mismatch with SHA256 base64)
    expect(verifyLineSignature(body, 'abc')).toBe(false);
  });
});

describe('getLineLoginChannelId', () => {
  afterEach(() => {
    delete process.env.LINE_LOGIN_CHANNEL_ID;
    delete process.env.NEXT_PUBLIC_LINE_CHANNEL_ID;
  });

  test('LINE_LOGIN_CHANNEL_ID を最優先で返す', () => {
    process.env.LINE_LOGIN_CHANNEL_ID = 'login-channel';
    process.env.NEXT_PUBLIC_LINE_CHANNEL_ID = 'public-channel';
    expect(getLineLoginChannelId()).toBe('login-channel');
  });

  test('LINE_LOGIN_CHANNEL_ID 未設定なら NEXT_PUBLIC_LINE_CHANNEL_ID にフォールバック', () => {
    delete process.env.LINE_LOGIN_CHANNEL_ID;
    process.env.NEXT_PUBLIC_LINE_CHANNEL_ID = 'public-channel';
    expect(getLineLoginChannelId()).toBe('public-channel');
  });

  test('両方未設定なら null', () => {
    delete process.env.LINE_LOGIN_CHANNEL_ID;
    delete process.env.NEXT_PUBLIC_LINE_CHANNEL_ID;
    expect(getLineLoginChannelId()).toBeNull();
  });

  test('空白のみの値は無効 → null', () => {
    process.env.LINE_LOGIN_CHANNEL_ID = '   ';
    delete process.env.NEXT_PUBLIC_LINE_CHANNEL_ID;
    expect(getLineLoginChannelId()).toBeNull();
  });
});

describe('verifyLineAccessToken', () => {
  beforeEach(() => {
    process.env.LINE_LOGIN_CHANNEL_ID = 'my-channel-id';
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.LINE_LOGIN_CHANNEL_ID;
    delete process.env.NEXT_PUBLIC_LINE_CHANNEL_ID;
  });

  function mockVerify(body: object, ok = true) {
    global.fetch = jest.fn().mockResolvedValue({
      ok,
      json: async () => body,
    } as unknown as Response);
  }

  test('チャネルID未設定 → fail-closed { ok: false }', async () => {
    delete process.env.LINE_LOGIN_CHANNEL_ID;
    global.fetch = jest.fn();
    const result = await verifyLineAccessToken('any-token');
    expect(result).toEqual({ ok: false });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('accessToken が空文字 → { ok: false }', async () => {
    const result = await verifyLineAccessToken('');
    expect(result).toEqual({ ok: false });
  });

  test('accessToken が string でない → { ok: false }', async () => {
    const result = await verifyLineAccessToken(123 as unknown as string);
    expect(result).toEqual({ ok: false });
  });

  test('verify が HTTP非200 → { ok: false }', async () => {
    mockVerify({}, false);
    const result = await verifyLineAccessToken('tok');
    expect(result).toEqual({ ok: false });
  });

  test('client_id 一致 & expires_in > 0 → { ok: true }', async () => {
    mockVerify({ client_id: 'my-channel-id', expires_in: 3600 });
    const result = await verifyLineAccessToken('tok');
    expect(result).toEqual({ ok: true });
  });

  test('client_id 不一致（他チャネル発行）→ { ok: false }', async () => {
    mockVerify({ client_id: 'foreign-channel', expires_in: 3600 });
    const result = await verifyLineAccessToken('tok');
    expect(result).toEqual({ ok: false });
  });

  test('expires_in が number でない → { ok: false }', async () => {
    mockVerify({ client_id: 'my-channel-id', expires_in: undefined });
    const result = await verifyLineAccessToken('tok');
    expect(result).toEqual({ ok: false });
  });

  test('expires_in <= 0（期限切れ）→ { ok: false }', async () => {
    mockVerify({ client_id: 'my-channel-id', expires_in: 0 });
    const result = await verifyLineAccessToken('tok');
    expect(result).toEqual({ ok: false });
  });

  test('verify URL に access_token を encode して付与', async () => {
    mockVerify({ client_id: 'my-channel-id', expires_in: 3600 });
    await verifyLineAccessToken('a b&c');
    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('access_token=a%20b%26c');
  });

  test('fetch 例外 → catch で { ok: false }', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network'));
    const result = await verifyLineAccessToken('tok');
    expect(result).toEqual({ ok: false });
  });
});

describe('sendLineReply', () => {
  test('returns true on success', async () => {
    mockFetchOk();
    const result = await sendLineReply('reply-token', [{ type: 'text', text: 'hi' }]);
    expect(result).toBe(true);
  });

  test('sends correct body to reply endpoint', async () => {
    mockFetchOk();
    await sendLineReply('my-token', [{ type: 'text', text: 'ok' }]);
    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('reply');
    const body = JSON.parse(opts.body);
    expect(body.replyToken).toBe('my-token');
  });

  test('returns false on fetch failure', async () => {
    mockFetchFail(500);
    const result = await sendLineReply('token', [{ type: 'text', text: 'hi' }]);
    expect(result).toBe(false);
  });

  test('returns false on exception', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
    const result = await sendLineReply('token', [{ type: 'text', text: 'hi' }]);
    expect(result).toBe(false);
  });

  test('throws if token not set', async () => {
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK;
    await expect(sendLineReply('token', [])).rejects.toThrow('LINE_CHANNEL_ACCESS_TOKEN_CARELINK');
  });
});
