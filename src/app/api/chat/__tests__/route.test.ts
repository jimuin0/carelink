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

jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/chat-rate-limit', () => ({ ...jest.requireActual('@/lib/chat-rate-limit'), checkChatLimit: jest.fn() }));
jest.mock('@/lib/recaptcha', () => ({ verifyRecaptcha: jest.fn() }));
// Use closure so module-level `new Anthropic()` in route always delegates to current mockMessagesCreate
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
import { checkChatLimit } from '@/lib/chat-rate-limit';
import { verifyRecaptcha } from '@/lib/recaptcha';
import { POST } from '../route';
import Anthropic from '@anthropic-ai/sdk';
const originalNodeEnv = process.env.NODE_ENV;
let logSpy: jest.SpyInstance;
beforeEach(() => { logSpy = jest.spyOn(console, 'info').mockImplementation(() => {}); });
afterEach(() => { logSpy.mockRestore(); (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv; delete process.env.RECAPTCHA_SECRET_KEY; delete process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY; });

function setupDefaultMocks(aiSucceeds: boolean = true) {
  (checkCsrf as jest.Mock).mockReturnValue(null);

  mockMessagesCreate = jest.fn();
  if (aiSucceeds) {
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'これは回答です。' }],
    });
  } else {
    mockMessagesCreate.mockRejectedValue(new Error('API error'));
  }

  process.env.ANTHROPIC_API_KEY = 'test-key';
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkChatLimit as jest.Mock).mockResolvedValue('allowed');
  (verifyRecaptcha as jest.Mock).mockResolvedValue({ success: true, score: 0.9 });
  delete process.env.AI_CHAT_DAILY_REQUEST_LIMIT;
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
  test('provider setup exceeding the deadline cannot start a paid call', async () => {
    jest.useFakeTimers();
    try {
      const started=Date.now();
      (Anthropic as jest.Mock).mockImplementationOnce(()=> {
        jest.setSystemTime(started+10000);return {messages:{create:mockMessagesCreate}};
      });
      const response=await POST(makeRequest({messages:[{role:'user',content:'Synthetic'}]}));
      expect(response.status).toBe(503);expect(mockMessagesCreate).not.toHaveBeenCalled();
      expect(checkChatLimit).toHaveBeenCalledTimes(2);expect(jest.getTimerCount()).toBe(0);
    } finally {jest.useRealTimers();}
  });
  test.each([10000,10001])('provider elapsed %ims cannot become a reply before its timer callback', async elapsed => {
    jest.useFakeTimers();
    try {
      const started=Date.now();
      mockMessagesCreate.mockImplementation(async()=> {
        jest.setSystemTime(started+elapsed);
        return {content:[{type:'text',text:'late synthetic reply'}],usage:{input_tokens:1,output_tokens:1}};
      });
      const response=await POST(makeRequest({messages:[{role:'user',content:'Synthetic'}]}));
      expect(response.status).toBe(503); expect(await response.json()).not.toHaveProperty('reply');
      expect(mockMessagesCreate).toHaveBeenCalledTimes(1); expect(checkChatLimit).toHaveBeenCalledTimes(2);
      expect(logSpy).toHaveBeenCalledWith('[chat] provider_call',{outcome:'unavailable'});
      expect(logSpy.mock.calls).not.toEqual(expect.arrayContaining([expect.arrayContaining(['late synthetic reply'])]));
      expect(jest.getTimerCount()).toBe(0);
    } finally { jest.useRealTimers(); }
  });
  test('provider completing before the deadline is still confirmed with no retry', async () => {
    jest.useFakeTimers();
    try {
      const started=Date.now();
      mockMessagesCreate.mockImplementation(async()=> {jest.setSystemTime(started+9999);return {content:[{type:'text',text:'Confirmed'}]};});
      const response=await POST(makeRequest({messages:[{role:'user',content:'Synthetic'}]}));
      expect(response.status).toBe(200);expect(await response.json()).toEqual({reply:'Confirmed'});
      expect(mockMessagesCreate).toHaveBeenCalledTimes(1);expect(jest.getTimerCount()).toBe(0);
    } finally {jest.useRealTimers();}
  });
  test('stalled parsed reply is bounded including after HTTP headers; no retry/refund', async () => {
    jest.useFakeTimers();
    try {
      mockMessagesCreate.mockReturnValue(new Promise(()=>{}));
      const pending=POST(makeRequest({messages:[{role:'user',content:'Test'}]}));
      await jest.advanceTimersByTimeAsync(10000);
      expect((await pending).status).toBe(503);
      expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
      expect(mockMessagesCreate.mock.calls[0][1].signal.aborted).toBe(true);
      expect(checkChatLimit).toHaveBeenCalledTimes(2);
    } finally {jest.useRealTimers();}
  });
  test.each([null, false, [], 'text'])('invalid envelope %j is rejected without provider', async value => {
    const res = await POST(makeRequest(value as any));
    expect(res.status).toBe(400); expect(mockMessagesCreate).not.toHaveBeenCalled();
  });
  test('distributed burst is unavailable →503 without provider', async () => {
    (checkChatLimit as jest.Mock).mockResolvedValue('unavailable');
    expect((await POST(makeRequest({ messages: [{ role: 'user', content: 'Test' }] }))).status).toBe(503);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });
  test.each(['unavailable', 'limited'])('global quota %s cannot issue provider call', async state => {
    (checkChatLimit as jest.Mock).mockResolvedValueOnce('allowed').mockResolvedValueOnce(state);
    const res = await POST(makeRequest({ messages: [{ role: 'user', content: 'Test' }] }));
    expect(res.status).toBe(state === 'limited' ? 429 : 503);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
    expect(checkChatLimit).toHaveBeenLastCalledWith('chat-daily:global', 100, 86400000);
  });
  test('bad configured daily limit and missing API key stop before bot/provider', async () => {
    process.env.AI_CHAT_DAILY_REQUEST_LIMIT = '0';
    expect((await POST(makeRequest({ messages: [{ role: 'user', content: 'Test' }] }))).status).toBe(503);
    delete process.env.AI_CHAT_DAILY_REQUEST_LIMIT; delete process.env.ANTHROPIC_API_KEY;
    expect((await POST(makeRequest({ messages: [{ role: 'user', content: 'Test' }] }))).status).toBe(503);
    expect(verifyRecaptcha).not.toHaveBeenCalled(); expect(mockMessagesCreate).not.toHaveBeenCalled();
  });
  test('production missing bot configuration stops without shared helper alerts', async () => {
    (process.env as Record<string,string|undefined>).NODE_ENV = 'production';
    const request = () => makeRequest({ messages: [{ role: 'user', content: 'Test' }] });
    expect((await POST(request())).status).toBe(503);
    process.env.RECAPTCHA_SECRET_KEY = 'synthetic-secret';
    expect((await POST(request())).status).toBe(503);
    expect(verifyRecaptcha).not.toHaveBeenCalled(); expect(mockMessagesCreate).not.toHaveBeenCalled();
  });
  test.each([{ success: false }, { success: true }, { success: true, score: Infinity }, { success: true, score: 'secret' }])('production bot proof is authoritative %j', async proof => {
    (process.env as Record<string,string|undefined>).NODE_ENV = 'production';
    process.env.RECAPTCHA_SECRET_KEY = 'synthetic-secret'; process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY = 'synthetic-site';
    (verifyRecaptcha as jest.Mock).mockResolvedValue(proof);
    const res = await POST(makeRequest({ messages: [{ role: 'user', content: 'Test' }], recaptcha_token: 7 }));
    expect(res.status).toBe(403); expect(mockMessagesCreate).not.toHaveBeenCalled();
    expect(checkChatLimit).toHaveBeenCalledTimes(1);
  });
  test('token/action verified, positive production proof and finite quota permit one bounded call', async () => {
    (process.env as Record<string,string|undefined>).NODE_ENV = 'production';
    process.env.RECAPTCHA_SECRET_KEY = 'synthetic-secret'; process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY = 'synthetic-site';
    process.env.AI_CHAT_DAILY_REQUEST_LIMIT = '25';
    mockMessagesCreate.mockResolvedValue({ content: [{ type: 'text', text: 'Confirmed reply' }], usage: { input_tokens: 12, output_tokens: 4 } });
    const res = await POST(makeRequest({ messages: [{ role: 'user', content: 'private synthetic input' }], recaptcha_token: 'synthetic-token' }));
    expect(res.status).toBe(200); expect(verifyRecaptcha).toHaveBeenCalledWith('synthetic-token', 'chat');
    expect(checkChatLimit).toHaveBeenLastCalledWith('chat-daily:global', 25, 86400000);
    expect(Anthropic).toHaveBeenCalledWith({ apiKey: 'test-key', timeout: 10000, maxRetries: 0 });
    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith('[chat] provider_call', { outcome: 'completed', inputTokens: 12, outputTokens: 4 });
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain('private synthetic input');
  });
  test.each([null, {}, '   ', ''])('unconfirmed reply %j returns503; no auto retry or quota refund', async text => {
    mockMessagesCreate.mockResolvedValue({ content: [{ type: 'text', text }] });
    const res = await POST(makeRequest({ messages: [{ role: 'user', content: 'Test' }] }));
    expect(res.status).toBe(503); expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    expect(checkChatLimit).toHaveBeenCalledTimes(2);
  });
  test('CSRF check failed → returns error', async () => {
    const csrfError = new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 });
    (checkCsrf as jest.Mock).mockReturnValue(csrfError);

    const res = await POST(
      makeRequest({ messages: [{ role: 'user', content: 'Hello' }] }) as any
    );

    expect(res.status).toBe(403);
  });

  test('rate limiting → 429', async () => {
    (checkChatLimit as jest.Mock).mockResolvedValue('limited');

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
    (checkChatLimit as jest.Mock).mockClear();

    await POST(
      makeRequest(
        { messages: [{ role: 'user', content: 'Test' }] },
        '192.168.1.1'
      ) as any
    );

    const call = (checkChatLimit as jest.Mock).mock.calls[0];
    expect(call).toEqual(['chat:192.168.1.1', 5, 60000]);
  });

  test('extracts last (trusted) IP from x-forwarded-for', async () => {
    (checkChatLimit as jest.Mock).mockClear();

    await POST(
      makeRequest(
        { messages: [{ role: 'user', content: 'Test' }] },
        '10.0.0.1, 192.168.1.1'
      ) as any
    );

    const call = (checkChatLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('chat:192.168.1.1');
  });

  test('missing x-forwarded-for → uses "unknown" IP', async () => {
    (checkChatLimit as jest.Mock).mockClear();
    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }] }),
    });
    await POST(req as any);
    const call = (checkChatLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('chat:unknown');
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

  test('AI response without confirmed text →503', async () => {
    mockMessagesCreate.mockResolvedValue({ content: [] });
    const res = await POST(
      makeRequest({ messages: [{ role: 'user', content: 'Test' }] }) as any
    );
    const json = await res.json();
    expect(res.status).toBe(503); expect(json.reply).toBeUndefined();
  });

  test('AI response with non-text content →503', async () => {
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'image' }],
    });

    const res = await POST(
      makeRequest({ messages: [{ role: 'user', content: 'Test' }] }) as any
    );

    const json = await res.json();
    expect(res.status).toBe(503); expect(json.reply).toBeUndefined();
  });
});
