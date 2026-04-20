/**
 * @jest-environment node
 *
 * Tests for POST /api/chat
 * Key assertions:
 *   - CSRF check → returns checkCsrf result
 *   - Rate limiting → 429
 *   - Invalid JSON → 400
 *   - Missing messages → 400
 *   - Empty messages array → 400
 *   - Invalid message roles → filtered
 *   - Valid messages → calls Anthropic API
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));

jest.mock('@anthropic-ai/sdk', () => {
  const mockCreate = jest.fn();
  const AnthropicClass = jest.fn(() => ({
    messages: {
      create: mockCreate,
    },
  }));
  AnthropicClass.__mockCreate = mockCreate;
  return AnthropicClass;
});

let mockCreate: jest.Mock;

import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { POST } from '../route';

beforeEach(() => {
  jest.clearAllMocks();
  (checkCsrf as jest.Mock).mockReturnValue(null);
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  process.env.ANTHROPIC_API_KEY = 'test-key';

  const Anthropic = require('@anthropic-ai/sdk');
  mockCreate = Anthropic.__mockCreate;
});

function makeRequest(body: object) {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': '192.168.1.1',
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/chat', () => {
  test('CSRF check failed → returns error', async () => {
    const csrfError = new Response(JSON.stringify({ error: 'CSRF failed' }), { status: 403 });
    (checkCsrf as jest.Mock).mockReturnValue(csrfError);

    const res = await POST(makeRequest({
      messages: [{ role: 'user', content: 'Hello' }],
    }));

    expect(res.status).toBe(403);
    (checkCsrf as jest.Mock).mockReturnValue(null);
  });

  test('rate limiting → 429', async () => {
    (inMemoryRateLimit as jest.Mock).mockReturnValue(true);

    const res = await POST(makeRequest({
      messages: [{ role: 'user', content: 'Hello' }],
    }));

    expect(res.status).toBe(429);
  });

  test('invalid JSON → 400', async () => {
    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'invalid json {',
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Invalid JSON');
  });

  test('missing messages → 400', async () => {
    const res = await POST(makeRequest({}));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('required');
  });

  test('messages is not array → 400', async () => {
    const res = await POST(makeRequest({
      messages: 'not an array',
    }));

    expect(res.status).toBe(400);
  });

  test('empty messages array → 400', async () => {
    const res = await POST(makeRequest({
      messages: [],
    }));

    expect(res.status).toBe(400);
  });

  test('message with invalid role filtered out', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Response text' }],
    });

    const res = await POST(makeRequest({
      messages: [
        { role: 'invalid', content: 'This should be filtered' },
        { role: 'user', content: 'Valid message' },
      ],
    }));

    expect(res.status).toBe(200);
    expect(mockCreate).toHaveBeenCalled();
    const args = mockCreate.mock.calls[0][0];
    expect(args.messages).toHaveLength(1);
    expect(args.messages[0].role).toBe('user');
  });

  test('message with non-string content filtered out', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Response' }],
    });

    const res = await POST(makeRequest({
      messages: [
        { role: 'user', content: 123 },
        { role: 'user', content: 'Valid' },
      ],
    }));

    expect(mockCreate).toHaveBeenCalled();
    const args = mockCreate.mock.calls[0][0];
    expect(args.messages).toHaveLength(1);
  });

  test('valid user message → 200', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'AI Response' }],
    });

    const res = await POST(makeRequest({
      messages: [{ role: 'user', content: 'Hello AI' }],
    }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.reply).toBe('AI Response');
  });

  test('multiple messages → passes all to API', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Response' }],
    });

    const res = await POST(makeRequest({
      messages: [
        { role: 'user', content: 'First' },
        { role: 'assistant', content: 'Reply' },
        { role: 'user', content: 'Second' },
      ],
    }));

    expect(res.status).toBe(200);
    const args = mockCreate.mock.calls[0][0];
    expect(args.messages).toHaveLength(3);
  });

  test('takes last 10 messages if more provided', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Response' }],
    });

    const messages = Array(15)
      .fill(null)
      .map((_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: `Message ${i}` }));

    const res = await POST(makeRequest({ messages }));

    expect(res.status).toBe(200);
    const args = mockCreate.mock.calls[0][0];
    expect(args.messages).toHaveLength(10);
  });

  test('filters out messages over 2000 chars', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Response' }],
    });

    const longContent = 'a'.repeat(2001);
    const res = await POST(makeRequest({
      messages: [{ role: 'user', content: longContent }],
    }));

    // Should return 400 because no valid messages after filtering
    expect(res.status).toBe(400);
  });

  test('calls Anthropic with correct model', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Response' }],
    });

    await POST(makeRequest({
      messages: [{ role: 'user', content: 'Hello' }],
    }));

    const args = mockCreate.mock.calls[0][0];
    expect(args.model).toBe('claude-haiku-4-5-20251001');
  });

  test('calls Anthropic with max_tokens 512', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Response' }],
    });

    await POST(makeRequest({
      messages: [{ role: 'user', content: 'Hello' }],
    }));

    const args = mockCreate.mock.calls[0][0];
    expect(args.max_tokens).toBe(512);
  });

  test('Anthropic exception → 503', async () => {
    mockCreate.mockRejectedValue(new Error('API error'));

    const res = await POST(makeRequest({
      messages: [{ role: 'user', content: 'Hello' }],
    }));

    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toContain('AIサービス');
  });

  test('response with non-text content → empty reply', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'tool_use', name: 'test' }],
    });

    const res = await POST(makeRequest({
      messages: [{ role: 'user', content: 'Hello' }],
    }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.reply).toBe('');
  });

  test('rate limit params', async () => {
    (inMemoryRateLimit as jest.Mock).mockClear();

    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Response' }],
    });

    await POST(makeRequest({
      messages: [{ role: 'user', content: 'Hello' }],
    }));

    expect(inMemoryRateLimit).toHaveBeenCalledWith('192.168.1.1', 5, 60000, 'chat');
  });
});
