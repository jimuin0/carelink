/**
 * @jest-environment node
 *
 * Tests for POST /api/symptoms/suggest
 * Key assertions:
 *   - CSRF check → returns checkCsrf result
 *   - Rate limiting → 429
 *   - Invalid schema → 400
 *   - Valid request → calls Anthropic API
 *   - JSON extraction from response
 *   - HTML/XML stripping from symptoms
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

import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { POST } from '../route';

let mockCreate: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  (checkCsrf as jest.Mock).mockReturnValue(null);
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  process.env.ANTHROPIC_API_KEY = 'test-key';

  const Anthropic = require('@anthropic-ai/sdk');
  mockCreate = Anthropic.__mockCreate;
});

function makeRequest(body: object) {
  return new Request('http://localhost/api/symptoms/suggest', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': '192.168.1.1',
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/symptoms/suggest', () => {
  test('CSRF check failed → returns error', async () => {
    const csrfError = new Response(JSON.stringify({ error: 'CSRF failed' }), { status: 403 });
    (checkCsrf as jest.Mock).mockReturnValue(csrfError);

    const res = await POST(makeRequest({
      symptoms: '頭痛',
    }));

    expect(res.status).toBe(403);
    (checkCsrf as jest.Mock).mockReturnValue(null);
  });

  test('rate limiting → 429', async () => {
    (inMemoryRateLimit as jest.Mock).mockReturnValue(true);

    const res = await POST(makeRequest({
      symptoms: '頭痛',
    }));

    expect(res.status).toBe(429);
  });

  test('missing symptoms → 400', async () => {
    const res = await POST(makeRequest({}));

    expect(res.status).toBe(400);
  });

  test('symptoms too short → 400', async () => {
    const res = await POST(makeRequest({
      symptoms: 'a',
    }));

    expect(res.status).toBe(400);
  });

  test('symptoms too long → 400', async () => {
    const res = await POST(makeRequest({
      symptoms: 'a'.repeat(501),
    }));

    expect(res.status).toBe(400);
  });

  test('prefecture too long → 400', async () => {
    const res = await POST(makeRequest({
      symptoms: '頭痛',
      prefecture: 'a'.repeat(51),
    }));

    expect(res.status).toBe(400);
  });

  test('invalid JSON → 400', async () => {
    const req = new Request('http://localhost/api/symptoms/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'invalid json {',
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  test('valid symptoms → calls Anthropic', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: '{"summary":"頭痛","recommended_treatments":[],"search_keywords":[],"caution":null,"tips":[]}',
        },
      ],
    });

    const res = await POST(makeRequest({
      symptoms: '頭痛が続いている',
    }));

    expect(res.status).toBe(200);
    expect(mockCreate).toHaveBeenCalled();
  });

  test('extracts JSON from response', async () => {
    const validJson = { summary: 'Test', recommended_treatments: [], search_keywords: [], caution: null, tips: [] };

    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: `Some text before\n${JSON.stringify(validJson)}\nSome text after`,
        },
      ],
    });

    const res = await POST(makeRequest({
      symptoms: '症状について',
    }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.result).toEqual(validJson);
  });

  test('strips HTML/XML tags from symptoms', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: '{"summary":"Test","recommended_treatments":[],"search_keywords":[],"caution":null,"tips":[]}',
        },
      ],
    });

    await POST(makeRequest({
      symptoms: '頭痛<script>alert("xss")</script>',
    }));

    const args = mockCreate.mock.calls[0][0];
    expect(args.messages[0].content).not.toContain('<script>');
    expect(args.messages[0].content).toContain('頭痛');
  });

  test('strips angle brackets from prefecture', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: '{"summary":"Test","recommended_treatments":[],"search_keywords":[],"caution":null,"tips":[]}',
        },
      ],
    });

    await POST(makeRequest({
      symptoms: '症状',
      prefecture: '東京都<injection>',
    }));

    const args = mockCreate.mock.calls[0][0];
    expect(args.messages[0].content).not.toContain('<injection>');
  });

  test('no JSON in response → 500', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: 'Just plain text without JSON',
        },
      ],
    });

    const res = await POST(makeRequest({
      symptoms: '症状',
    }));

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain('解析');
  });

  test('Anthropic exception → 500', async () => {
    mockCreate.mockRejectedValue(new Error('API error'));

    const res = await POST(makeRequest({
      symptoms: '症状',
    }));

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain('AI処理');
  });

  test('uses correct Anthropic model', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: '{"summary":"Test","recommended_treatments":[],"search_keywords":[],"caution":null,"tips":[]}',
        },
      ],
    });

    await POST(makeRequest({
      symptoms: '症状',
    }));

    const args = mockCreate.mock.calls[0][0];
    expect(args.model).toBe('claude-haiku-4-5-20251001');
  });

  test('includes prefecture in message when provided', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: '{"summary":"Test","recommended_treatments":[],"search_keywords":[],"caution":null,"tips":[]}',
        },
      ],
    });

    await POST(makeRequest({
      symptoms: '症状',
      prefecture: '東京都',
    }));

    const args = mockCreate.mock.calls[0][0];
    expect(args.messages[0].content).toContain('東京都');
    expect(args.messages[0].content).toContain('<prefecture>');
  });

  test('does not include prefecture when not provided', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: '{"summary":"Test","recommended_treatments":[],"search_keywords":[],"caution":null,"tips":[]}',
        },
      ],
    });

    await POST(makeRequest({
      symptoms: '症状',
    }));

    const args = mockCreate.mock.calls[0][0];
    expect(args.messages[0].content).not.toContain('<prefecture>');
  });
});
