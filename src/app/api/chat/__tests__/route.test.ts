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
jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(() => false),
}));
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
import { checkRateLimit } from '@/lib/rate-limit';
import { POST } from '../route';

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
  (checkRateLimit as jest.Mock).mockReturnValue(false);
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
    (checkRateLimit as jest.Mock).mockReturnValue(true);

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
    const res = await POST(
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
    const res = await POST(
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
    const res = await POST(
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
    const res = await POST(
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

    const res = await POST(makeRequest({ messages }) as any);

    const call = mockMessagesCreate.mock.calls[0];
    expect(call[0].messages.length).toBe(10);
    expect(call[0].messages[0].content).toBe('Message 5');
  });

  test('calls Claude Haiku model', async () => {
    const res = await POST(
      makeRequest({ messages: [{ role: 'user', content: 'Test' }] }) as any
    );

    const call = mockMessagesCreate.mock.calls[0];
    expect(call[0].model).toBe('claude-haiku-4-5-20251001');
  });

  test('sets max_tokens to 512', async () => {
    const res = await POST(
      makeRequest({ messages: [{ role: 'user', content: 'Test' }] }) as any
    );

    const call = mockMessagesCreate.mock.calls[0];
    expect(call[0].max_tokens).toBe(512);
  });

  test('includes system prompt', async () => {
    const res = await POST(
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
    const res = await POST(
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
    const res = await POST(
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
    (checkRateLimit as jest.Mock).mockClear();

    await POST(
      makeRequest(
        { messages: [{ role: 'user', content: 'Test' }] },
        '192.168.1.1'
      ) as any
    );

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
    expect(call[2]).toBe(5);
    expect(call[3]).toBe(60000);
    expect(call[4]).toBe('chat');
  });

  test('extracts last (trusted) IP from x-forwarded-for', async () => {
    (checkRateLimit as jest.Mock).mockClear();

    await POST(
      makeRequest(
        { messages: [{ role: 'user', content: 'Test' }] },
        '10.0.0.1, 192.168.1.1'
      ) as any
    );

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
  });

  test('missing x-forwarded-for → uses "unknown" IP', async () => {
    (checkRateLimit as jest.Mock).mockClear();
    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }] }),
    });
    await POST(req as any);
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('unknown');
  });

  test('null entry in messages array → filtered out', async () => {
    const res = await POST(
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
});
