/**
 * @jest-environment node
 *
 * Tests for POST /api/chat
 * Key assertions:
 *   - CSRF check required
 *   - Rate limiting (5 req/min per IP)
 *   - Messages array validation (role, content length)
 *   - Takes last 10 messages only
 *   - Claude Haiku API integration
 *   - Error handling (rate limit, invalid JSON, AI service error)
 */

import { createHmac } from 'crypto';

jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({
  checkRateLimitStrict: jest.fn(() => false),
}));
jest.mock('@/lib/recaptcha', () => ({ verifyRecaptcha: jest.fn() }));
// Use a closure so request-scoped Anthropic clients always delegate to current mockMessagesCreate
let mockMessagesCreate: jest.Mock = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: {
      create: (...args: any[]) => mockMessagesCreate(...args),
    },
  })),
}));

import { checkCsrf } from '@/lib/csrf';
import { checkRateLimitStrict } from '@/lib/rate-limit';
import { verifyRecaptcha } from '@/lib/recaptcha';
import { POST } from '../route';

function setupDefaultMocks(aiSucceeds: boolean = true) {
  (checkCsrf as jest.Mock).mockReturnValue(null);

  mockMessagesCreate = jest.fn();
  if (aiSucceeds) {
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'これは回答です。' }],
      usage: { input_tokens: 12, output_tokens: 7 },
    });
  } else {
    mockMessagesCreate.mockRejectedValue(new Error('API error'));
  }

  process.env.ANTHROPIC_API_KEY = 'test-key';
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.RECAPTCHA_SECRET_KEY;
  delete process.env.VERCEL_ENV;
  delete process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-secret';
  process.env.AI_CHAT_DAILY_REQUEST_LIMIT = '20';
  (verifyRecaptcha as jest.Mock).mockResolvedValue({ success: true });
  (checkRateLimitStrict as jest.Mock).mockReturnValue(false);
  setupDefaultMocks();
});

function makeRequest(body: object, ip = '192.168.1.1') {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/chat', () => {
  test('CSRF check failed → returns error', async () => {
    const csrfError = new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 });
    (checkCsrf as jest.Mock).mockReturnValue(csrfError);

    const res = await POST(
      makeRequest({ messages: [{ role: 'user', content: 'Hello' }] }) as any
    );

    expect(res.status).toBe(403);
  });

  test('rate limiting → 429', async () => {
    (checkRateLimitStrict as jest.Mock).mockReturnValue(true);

    const res = await POST(
      makeRequest({ messages: [{ role: 'user', content: 'Hello' }] }) as any
    );

    expect(res.status).toBe(429);
  });

  test('invalid JSON → 400', async () => {
    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '192.168.1.1' },
      body: 'invalid {',
    });

    const res = await POST(req as any);

    expect(res.status).toBe(400);
  });

  test('missing messages → 400', async () => {
    const res = await POST(makeRequest({}) as any);

    expect(res.status).toBe(400);
  });

  test('empty messages array → 400', async () => {
    const res = await POST(makeRequest({ messages: [] }) as any);

    expect(res.status).toBe(400);
  });

  test('messages not array → 400', async () => {
    const res = await POST(
      makeRequest({ messages: 'not-array' }) as any
    );

    expect(res.status).toBe(400);
  });

  test('message without role → filtered out', async () => {
    await POST(
      makeRequest({
        messages: [
          { content: 'No role' },
          { role: 'user', content: 'Valid' },
        ],
      }) as any
    );

    const call = mockMessagesCreate.mock.calls[0];
    expect(call[0].messages.length).toBe(1);
  });

  test('invalid role → filtered out', async () => {
    await POST(
      makeRequest({
        messages: [
          { role: 'admin', content: 'Invalid role' },
          { role: 'user', content: 'Valid' },
        ],
      }) as any
    );

    const call = mockMessagesCreate.mock.calls[0];
    expect(call[0].messages.length).toBe(1);
  });

  test('valid roles: user and assistant', async () => {
    const res = await POST(
      makeRequest({
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there' },
          { role: 'user', content: 'How are you?' },
        ],
      }) as any
    );

    expect(res.status).toBe(200);
    const call = mockMessagesCreate.mock.calls[0];
    expect(call[0].messages.length).toBe(3);
  });

  test('content > 2000 chars → filtered out', async () => {
    await POST(
      makeRequest({
        messages: [
          { role: 'user', content: 'x'.repeat(2001) },
          { role: 'user', content: 'Valid' },
        ],
      }) as any
    );

    const call = mockMessagesCreate.mock.calls[0];
    expect(call[0].messages.length).toBe(1);
  });

  test('content exactly 2000 chars → included', async () => {
    await POST(
      makeRequest({
        messages: [
          { role: 'user', content: 'x'.repeat(2000) },
        ],
      }) as any
    );

    const call = mockMessagesCreate.mock.calls[0];
    expect(call[0].messages.length).toBe(1);
  });

  test('takes last 10 messages only', async () => {
    const messages = Array.from({ length: 15 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}`,
    }));

    await POST(makeRequest({ messages }) as any);

    const call = mockMessagesCreate.mock.calls[0];
    expect(call[0].messages.length).toBe(10);
    expect(call[0].messages[0].content).toBe('Message 5');
  });

  test('正規化後の総文字数が12,000を超える場合は413', async () => {
    const messages = Array.from({ length: 10 }, () => ({ role: 'user', content: 'x'.repeat(2000) }));

    const res = await POST(makeRequest({ messages }) as any);

    expect(res.status).toBe(413);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  test('calls Claude Haiku model', async () => {
    await POST(
      makeRequest({ messages: [{ role: 'user', content: 'Test' }] }) as any
    );

    const call = mockMessagesCreate.mock.calls[0];
    expect(call[0].model).toBe('claude-haiku-4-5-20251001');
  });

  test('sets max_tokens to 512', async () => {
    await POST(
      makeRequest({ messages: [{ role: 'user', content: 'Test' }] }) as any
    );

    const call = mockMessagesCreate.mock.calls[0];
    expect(call[0].max_tokens).toBe(512);
  });

  test('includes system prompt', async () => {
    await POST(
      makeRequest({ messages: [{ role: 'user', content: 'Test' }] }) as any
    );

    const call = mockMessagesCreate.mock.calls[0];
    expect(call[0].system).toContain('CareLink');
    expect(call[0].system).toContain('AI');
  });

  test('valid request → 200 with reply', async () => {
    const res = await POST(
      makeRequest({ messages: [{ role: 'user', content: 'こんにちは' }] }) as any
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.reply).toBe('これは回答です。');
  });

  test('AI service error → 503', async () => {
    setupDefaultMocks(false);

    const res = await POST(
      makeRequest({ messages: [{ role: 'user', content: 'Test' }] }) as any
    );

    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toContain('AIサービス');
  });

  test('content type not string → filtered out', async () => {
    await POST(
      makeRequest({
        messages: [
          { role: 'user', content: 123 },
          { role: 'user', content: 'Valid' },
        ],
      }) as any
    );

    const call = mockMessagesCreate.mock.calls[0];
    expect(call[0].messages.length).toBe(1);
  });

  test('message content exactly 2000 chars → included as-is', async () => {
    await POST(
      makeRequest({
        messages: [
          { role: 'user', content: 'x'.repeat(2000) },
        ],
      }) as any
    );

    const call = mockMessagesCreate.mock.calls[0];
    expect(call[0].messages[0].content.length).toBeLessThanOrEqual(2000);
  });

  test('rate limit params (5 req/min per IP)', async () => {
    (checkRateLimitStrict as jest.Mock).mockClear();

    await POST(
      makeRequest(
        { messages: [{ role: 'user', content: 'Test' }] },
        '192.168.1.1'
      ) as any
    );

    const calls = (checkRateLimitStrict as jest.Mock).mock.calls;
    const expectedIdentity = createHmac('sha256', 'test-service-role-secret')
      .update('carelink:ai-chat-rate-limit:v1:192.168.1.1')
      .digest('hex');
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual([null, expectedIdentity, 5, 60_000, 'chat-burst']);
    expect(calls[1]).toEqual([null, expectedIdentity, 20, 24 * 60 * 60_000, 'chat-daily']);
    expect(JSON.stringify(calls)).not.toContain('192.168.1.1');
  });

  test('extracts last (trusted) IP from x-forwarded-for', async () => {
    (checkRateLimitStrict as jest.Mock).mockClear();

    await POST(
      makeRequest(
        { messages: [{ role: 'user', content: 'Test' }] },
        '10.0.0.1, 192.168.1.1'
      ) as any
    );

    const call = (checkRateLimitStrict as jest.Mock).mock.calls[0];
    const expectedIdentity = createHmac('sha256', 'test-service-role-secret')
      .update('carelink:ai-chat-rate-limit:v1:192.168.1.1')
      .digest('hex');
    expect(call[1]).toBe(expectedIdentity);
  });

  test('missing x-forwarded-for → uses "unknown" IP', async () => {
    (checkRateLimitStrict as jest.Mock).mockClear();
    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }] }),
    });
    await POST(req as any);
    const call = (checkRateLimitStrict as jest.Mock).mock.calls[0];
    const expectedIdentity = createHmac('sha256', 'test-service-role-secret')
      .update('carelink:ai-chat-rate-limit:v1:unknown')
      .digest('hex');
    expect(call[1]).toBe(expectedIdentity);
  });

  test('null entry in messages array → filtered out', async () => {
    await POST(
      makeRequest({
        messages: [
          null,
          { role: 'user', content: 'Valid' },
        ],
      }) as any
    );
    const call = mockMessagesCreate.mock.calls[0];
    expect(call[0].messages.length).toBe(1);
  });

  test('all messages filtered out → 400 No valid messages', async () => {
    const res = await POST(
      makeRequest({
        messages: [
          { role: 'admin', content: 'bad' },
          { role: 'user', content: 123 },
        ],
      }) as any
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('No valid messages');
  });

  test('AI response content[0] undefined → empty reply', async () => {
    mockMessagesCreate.mockResolvedValue({ content: [] });
    const res = await POST(
      makeRequest({ messages: [{ role: 'user', content: 'Test' }] }) as any
    );
    const json = await res.json();
    expect(json.reply).toBe('');
  });

  test('AI response with non-text content → empty reply', async () => {
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'image' }],
    });

    const res = await POST(
      makeRequest({ messages: [{ role: 'user', content: 'Test' }] }) as any
    );

    const json = await res.json();
    expect(json.reply).toBe('');
  });

  test('reCAPTCHA secret 設定時に token なし → 403', async () => {
    process.env.RECAPTCHA_SECRET_KEY = 'configured-for-test';
    process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY = 'site-key-for-test';

    const res = await POST(
      makeRequest({ messages: [{ role: 'user', content: 'Test' }] }) as any
    );

    expect(res.status).toBe(403);
    expect(verifyRecaptcha).not.toHaveBeenCalled();
  });

  test('reCAPTCHA 検証失敗 → 403', async () => {
    process.env.RECAPTCHA_SECRET_KEY = 'configured-for-test';
    process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY = 'site-key-for-test';
    (verifyRecaptcha as jest.Mock).mockResolvedValue({ success: false });

    const res = await POST(
      makeRequest({
        messages: [{ role: 'user', content: 'Test' }],
        recaptcha_token: 'token',
      }) as any
    );

    expect(res.status).toBe(403);
    expect(verifyRecaptcha).toHaveBeenCalledWith('token', 'chat', 0.4);
  });

  test('reCAPTCHA 検証成功 → AI処理へ進む', async () => {
    process.env.RECAPTCHA_SECRET_KEY = 'configured-for-test';
    process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY = 'site-key-for-test';
    (verifyRecaptcha as jest.Mock).mockResolvedValue({ success: true });

    const res = await POST(
      makeRequest({
        messages: [{ role: 'user', content: 'Test' }],
        recaptcha_token: 'token',
      }) as any
    );

    expect(res.status).toBe(200);
    expect(mockMessagesCreate).toHaveBeenCalled();
  });

  test('daily quota reached → 429 and paid provider is not called', async () => {
    (checkRateLimitStrict as jest.Mock)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    const res = await POST(makeRequest({ messages: [{ role: 'user', content: 'Test' }] }) as any);

    expect(res.status).toBe(429);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  test('shared quota failure → 503 and paid provider is not called', async () => {
    (checkRateLimitStrict as jest.Mock).mockRejectedValue(new Error('private backend detail'));

    const res = await POST(makeRequest({ messages: [{ role: 'user', content: 'Test' }] }) as any);

    expect(res.status).toBe(503);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  test('daily quota failure after burst check → 503 and paid provider is not called', async () => {
    (checkRateLimitStrict as jest.Mock)
      .mockReturnValueOnce(false)
      .mockRejectedValueOnce(new Error('private backend detail'));

    const res = await POST(makeRequest({ messages: [{ role: 'user', content: 'Test' }] }) as any);

    expect(res.status).toBe(503);
    expect(checkRateLimitStrict).toHaveBeenCalledTimes(2);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  test('production with missing daily policy → 503 before rate-limit or provider calls', async () => {
    process.env.VERCEL_ENV = 'production';
    delete process.env.AI_CHAT_DAILY_REQUEST_LIMIT;

    const res = await POST(makeRequest({ messages: [{ role: 'user', content: 'Test' }] }) as any);

    expect(res.status).toBe(503);
    expect(checkRateLimitStrict).not.toHaveBeenCalled();
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  test('production with an out-of-range daily policy → 503 before provider calls', async () => {
    process.env.VERCEL_ENV = 'production';
    process.env.AI_CHAT_DAILY_REQUEST_LIMIT = '2147483648';

    const res = await POST(makeRequest({ messages: [{ role: 'user', content: 'Test' }] }) as any);

    expect(res.status).toBe(503);
    expect(checkRateLimitStrict).not.toHaveBeenCalled();
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  test('production with missing reCAPTCHA configuration → 503 before provider calls', async () => {
    process.env.VERCEL_ENV = 'production';

    const res = await POST(makeRequest({ messages: [{ role: 'user', content: 'Test' }] }) as any);

    expect(res.status).toBe(503);
    expect(verifyRecaptcha).not.toHaveBeenCalled();
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  test('production with reCAPTCHA secret but no public site key → 503 before provider calls', async () => {
    process.env.VERCEL_ENV = 'production';
    process.env.RECAPTCHA_SECRET_KEY = 'configured-for-test';

    const res = await POST(makeRequest({ messages: [{ role: 'user', content: 'Test' }] }) as any);

    expect(res.status).toBe(503);
    expect(checkRateLimitStrict).not.toHaveBeenCalled();
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  test('missing privacy HMAC key → 503 without shared quota or provider calls', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const res = await POST(makeRequest({ messages: [{ role: 'user', content: 'Test' }] }) as any);

    expect(res.status).toBe(503);
    expect(checkRateLimitStrict).not.toHaveBeenCalled();
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  test('development without a business-selected daily cap keeps only burst limiting', async () => {
    delete process.env.AI_CHAT_DAILY_REQUEST_LIMIT;

    const res = await POST(makeRequest({ messages: [{ role: 'user', content: 'Test' }] }) as any);

    expect(res.status).toBe(200);
    expect(checkRateLimitStrict).toHaveBeenCalledTimes(1);
    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
  });

  test('missing Anthropic key → 503 without provider call', async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const res = await POST(makeRequest({ messages: [{ role: 'user', content: 'Test' }] }) as any);

    expect(res.status).toBe(503);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  test('provider usage telemetry contains token counts but no request content', async () => {
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});
    try {
      await POST(makeRequest({ messages: [{ role: 'user', content: 'private prompt marker' }] }) as any);

      expect(info).toHaveBeenCalledWith('[chat] provider usage', {
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        inputTokens: 12,
        outputTokens: 7,
      });
      expect(JSON.stringify(info.mock.calls)).not.toContain('private prompt marker');
    } finally {
      info.mockRestore();
    }
  });

  test('non-Error provider failures return a safe response and log only the error type', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockMessagesCreate.mockRejectedValue('private provider detail');
    try {
      const res = await POST(makeRequest({ messages: [{ role: 'user', content: 'Test' }] }) as any);

      expect(res.status).toBe(503);
      expect(errorSpy).toHaveBeenCalledWith('[chat] provider request failed', {
        provider: 'anthropic',
        errorType: 'unknown',
      });
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('private provider detail');
    } finally {
      errorSpy.mockRestore();
    }
  });
});
