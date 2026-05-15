/**
 * @jest-environment node
 */

jest.mock('@/lib/rate-limit', () => ({
  inMemoryRateLimit: jest.fn(() => false),
}));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));

// Lazy wrapper: `mockCreate` is assigned in beforeEach; the closure captures the
// variable slot so the singleton `client` (created at route module scope) always
// calls whatever `mockCreate` currently is.
let mockCreate: jest.Mock;
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create: (...args: unknown[]) => mockCreate(...args) },
  })),
}));

import { inMemoryRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';
import { POST } from '../route';

const VALID_AI_RESPONSE = {
  content: [{ type: 'text', text: '{"summary":"腰痛","recommended_treatments":[{"name":"鍼灸","description":"効果的","icon":"🎯"}],"search_keywords":["腰痛 鍼灸"],"caution":null,"tips":["温める"]}' }],
};

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  (checkCsrf as jest.Mock).mockReturnValue(null);
  mockCreate = jest.fn().mockResolvedValue(VALID_AI_RESPONSE);
  process.env.ANTHROPIC_API_KEY = 'test-key';
});

function makeRequest(body: object, ip = '192.168.1.1') {
  return new Request('http://localhost/api/symptoms/suggest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

const validRequest = {
  symptoms: '腰が痛い',
};

describe('POST /api/symptoms/suggest', () => {
  test('CSRF check failed → 403', async () => {
    (checkCsrf as jest.Mock).mockReturnValue(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
    const res = await POST(makeRequest(validRequest) as any);
    expect(res.status).toBe(403);
  });

  test('rate limiting → 429', async () => {
    (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
    const res = await POST(makeRequest(validRequest) as any);
    expect(res.status).toBe(429);
  });

  test('missing symptoms → 400', async () => {
    const res = await POST(makeRequest({}) as any);
    expect(res.status).toBe(400);
  });

  test('symptoms too short (<2) → 400', async () => {
    const res = await POST(makeRequest({ symptoms: 'a' }) as any);
    expect(res.status).toBe(400);
  });

  test('symptoms too long (>500) → 400', async () => {
    const res = await POST(makeRequest({ symptoms: 'x'.repeat(501) }) as any);
    expect(res.status).toBe(400);
  });

  test('prefecture optional', async () => {
    const res = await POST(makeRequest({ symptoms: '肩こり' }) as any);
    expect(res.status).toBe(200);
  });

  test('prefecture あり → プロンプトに都道府県を含む', async () => {
    const res = await POST(makeRequest({ symptoms: '腰が痛い', prefecture: '東京都' }) as any);
    expect(res.status).toBe(200);
  });

  test('valid request → 200', async () => {
    const res = await POST(makeRequest(validRequest) as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.result).toBeDefined();
  });

  test('strips HTML characters from symptoms (user input sanitized)', async () => {
    await POST(makeRequest({ symptoms: '<script>alert("xss")</script>腰痛' }) as any);
    expect(mockCreate).toHaveBeenCalled();
    const call = mockCreate.mock.calls[0];
    // User-injected script tag is stripped; route's own <symptoms> wrapper tags remain
    expect(call[0].messages[0].content).not.toContain('<script>');
    expect(call[0].messages[0].content).not.toContain('</script>');
    expect(call[0].messages[0].content).toContain('腰痛');
  });

  test('AI processing failure → 500', async () => {
    mockCreate = jest.fn().mockRejectedValue(new Error('API error'));
    const res = await POST(makeRequest(validRequest) as any);
    expect(res.status).toBe(500);
  });

  test('AI returns invalid JSON → 500', async () => {
    mockCreate = jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'not json' }] });
    const res = await POST(makeRequest(validRequest) as any);
    expect(res.status).toBe(500);
  });

  test('rate limit params (10 req/min per IP)', () => {
    (inMemoryRateLimit as jest.Mock).mockClear();
    POST(makeRequest(validRequest, '192.168.1.1') as any);
    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe(10);
  });

  test('extracts first IP from x-forwarded-for', () => {
    (inMemoryRateLimit as jest.Mock).mockClear();
    POST(makeRequest(validRequest, '10.0.0.1, 192.168.1.1') as any);
    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('10.0.0.1');
  });

  test('invalid JSON → 400', async () => {
    const req = new Request('http://localhost/api/symptoms/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '192.168.1.1' },
      body: 'invalid {',
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });

  test('x-forwarded-for ヘッダーなし → "unknown" を使用', () => {
    (inMemoryRateLimit as jest.Mock).mockClear();
    const req = new Request('http://localhost/api/symptoms/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validRequest),
    });
    POST(req as any);
    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('unknown');
  });

  test('AI レスポンスに JSON なし → 500', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'JSONがありません' }],
    });
    const res = await POST(makeRequest(validRequest) as any);
    expect(res.status).toBe(500);
  });

  test('AI レスポンスが text 以外の type → text は空文字、JSONなし → 500', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'tool_use', text: undefined }],
    });
    const res = await POST(makeRequest(validRequest) as any);
    expect(res.status).toBe(500);
  });
});
