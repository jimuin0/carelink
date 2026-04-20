/**
 * @jest-environment node
 *
 * Tests for POST /api/contact
 * Key assertions:
 *   - CSRF check → returns checkCsrf result
 *   - Rate limiting → 429
 *   - Schema validation (name, email, phone, inquiry_type, message)
 *   - Invalid email format → 400
 *   - Supabase insert error → 500
 *   - Slack notification fire-and-forget
 *   - Success → 200
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => Promise.resolve(false)) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@supabase/supabase-js');
jest.mock('node-fetch', () => jest.fn());
global.fetch = jest.fn();

import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { POST } from '../route';

let mockInsert: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  (checkCsrf as jest.Mock).mockReturnValue(null);
  (checkRateLimit as jest.Mock).mockResolvedValue(false);

  mockInsert = jest.fn().mockResolvedValue({ error: null });
  const { createClient } = require('@supabase/supabase-js');
  createClient.mockReturnValue({
    from: jest.fn((table: string) => {
      if (table === 'contacts') {
        return { insert: mockInsert };
      }
    }),
  });

  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => ({}),
  });

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

function makeRequest(body: object, ip = '192.168.1.1') {
  return new Request('http://localhost/api/contact', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/contact', () => {
  test('CSRF check failed → returns error', async () => {
    const csrfError = new Response(JSON.stringify({ error: 'CSRF failed' }), { status: 403 });
    (checkCsrf as jest.Mock).mockReturnValue(csrfError);

    const res = await POST(makeRequest({
      name: 'Test User',
      email: 'test@example.com',
      inquiry_type: 'General',
      message: 'Test message',
    }));

    expect(res.status).toBe(403);
    (checkCsrf as jest.Mock).mockReturnValue(null);
  });

  test('rate limiting → 429', async () => {
    (checkRateLimit as jest.Mock).mockResolvedValue(true);

    const res = await POST(makeRequest({
      name: 'Test User',
      email: 'test@example.com',
      inquiry_type: 'General',
      message: 'Test message',
    }));

    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toContain('リクエストが多すぎます');
  });

  test('missing name → 400', async () => {
    const res = await POST(makeRequest({
      email: 'test@example.com',
      inquiry_type: 'General',
      message: 'Test message',
    }));

    expect(res.status).toBe(400);
  });

  test('name too short → 400', async () => {
    const res = await POST(makeRequest({
      name: '',
      email: 'test@example.com',
      inquiry_type: 'General',
      message: 'Test message',
    }));

    expect(res.status).toBe(400);
  });

  test('name too long → 400', async () => {
    const res = await POST(makeRequest({
      name: 'a'.repeat(101),
      email: 'test@example.com',
      inquiry_type: 'General',
      message: 'Test message',
    }));

    expect(res.status).toBe(400);
  });

  test('missing email → 400', async () => {
    const res = await POST(makeRequest({
      name: 'Test User',
      inquiry_type: 'General',
      message: 'Test message',
    }));

    expect(res.status).toBe(400);
  });

  test('invalid email format → 400', async () => {
    const res = await POST(makeRequest({
      name: 'Test User',
      email: 'not-an-email',
      inquiry_type: 'General',
      message: 'Test message',
    }));

    expect(res.status).toBe(400);
  });

  test('email too long → 400', async () => {
    const res = await POST(makeRequest({
      name: 'Test User',
      email: 'a'.repeat(250) + '@test.com',
      inquiry_type: 'General',
      message: 'Test message',
    }));

    expect(res.status).toBe(400);
  });

  test('missing inquiry_type → 400', async () => {
    const res = await POST(makeRequest({
      name: 'Test User',
      email: 'test@example.com',
      message: 'Test message',
    }));

    expect(res.status).toBe(400);
  });

  test('inquiry_type too short → 400', async () => {
    const res = await POST(makeRequest({
      name: 'Test User',
      email: 'test@example.com',
      inquiry_type: '',
      message: 'Test message',
    }));

    expect(res.status).toBe(400);
  });

  test('inquiry_type too long → 400', async () => {
    const res = await POST(makeRequest({
      name: 'Test User',
      email: 'test@example.com',
      inquiry_type: 'a'.repeat(101),
      message: 'Test message',
    }));

    expect(res.status).toBe(400);
  });

  test('missing message → 400', async () => {
    const res = await POST(makeRequest({
      name: 'Test User',
      email: 'test@example.com',
      inquiry_type: 'General',
    }));

    expect(res.status).toBe(400);
  });

  test('message too short → 400', async () => {
    const res = await POST(makeRequest({
      name: 'Test User',
      email: 'test@example.com',
      inquiry_type: 'General',
      message: '',
    }));

    expect(res.status).toBe(400);
  });

  test('message too long → 400', async () => {
    const res = await POST(makeRequest({
      name: 'Test User',
      email: 'test@example.com',
      inquiry_type: 'General',
      message: 'a'.repeat(5001),
    }));

    expect(res.status).toBe(400);
  });

  test('phone too long → 400', async () => {
    const res = await POST(makeRequest({
      name: 'Test User',
      email: 'test@example.com',
      inquiry_type: 'General',
      message: 'Test message',
      phone: 'a'.repeat(21),
    }));

    expect(res.status).toBe(400);
  });

  test('invalid JSON → 400', async () => {
    const req = new Request('http://localhost/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '192.168.1.1' },
      body: 'invalid json {',
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  test('valid minimal request → 200', async () => {
    const res = await POST(makeRequest({
      name: 'Test User',
      email: 'test@example.com',
      inquiry_type: 'General',
      message: 'Test message',
    }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  test('valid request with phone → 200', async () => {
    const res = await POST(makeRequest({
      name: 'Test User',
      email: 'test@example.com',
      inquiry_type: 'Billing',
      message: 'I have a billing question',
      phone: '09012345678',
    }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  test('phone nullable → 200', async () => {
    const res = await POST(makeRequest({
      name: 'Test User',
      email: 'test@example.com',
      inquiry_type: 'General',
      message: 'Test message',
      phone: null,
    }));

    expect(res.status).toBe(200);
  });

  test('Supabase insert error → 500', async () => {
    mockInsert.mockResolvedValue({ error: { message: 'Insert failed' } });

    const res = await POST(makeRequest({
      name: 'Test User',
      email: 'test@example.com',
      inquiry_type: 'General',
      message: 'Test message',
    }));

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain('失敗');
  });


  test('inserts data with correct format', async () => {
    await POST(makeRequest({
      name: 'John Doe',
      email: 'john@example.com',
      inquiry_type: 'Support',
      message: 'Need help with X',
      phone: '09012345678',
    }));

    expect(mockInsert).toHaveBeenCalledWith({
      name: 'John Doe',
      email: 'john@example.com',
      inquiry_type: 'Support',
      message: 'Need help with X',
      phone: '09012345678',
    });
  });

  test('converts null phone to null in insert', async () => {
    await POST(makeRequest({
      name: 'Jane Doe',
      email: 'jane@example.com',
      inquiry_type: 'General',
      message: 'Test',
      phone: null,
    }));

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: null,
      })
    );
  });

  test('sends Slack notification fire-and-forget', async () => {
    await POST(makeRequest({
      name: 'Test User',
      email: 'test@example.com',
      inquiry_type: 'General',
      message: 'Test message',
    }));

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/notify'),
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });

  test('Slack notification failure does not affect response', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Slack failed'));

    const res = await POST(makeRequest({
      name: 'Test User',
      email: 'test@example.com',
      inquiry_type: 'General',
      message: 'Test message',
    }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  test('rate limit params (3 req/min per IP)', async () => {
    (checkRateLimit as jest.Mock).mockClear();

    await POST(makeRequest({
      name: 'Test User',
      email: 'test@example.com',
      inquiry_type: 'General',
      message: 'Test message',
    }));

    expect(checkRateLimit).toHaveBeenCalled();
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
    expect(call[2]).toBe(3);
    expect(call[3]).toBe(60_000);
    expect(call[4]).toBe('contact');
  });

  test('extracts first IP from x-forwarded-for', async () => {
    (checkRateLimit as jest.Mock).mockClear();

    await POST(makeRequest({
      name: 'Test User',
      email: 'test@example.com',
      inquiry_type: 'General',
      message: 'Test message',
    }, '10.0.0.1, 192.168.1.1'));

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('10.0.0.1');
  });

  test('uses unknown IP when x-forwarded-for missing', async () => {
    (checkRateLimit as jest.Mock).mockClear();

    const req = new Request('http://localhost/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test User',
        email: 'test@example.com',
        inquiry_type: 'General',
        message: 'Test message',
      }),
    });

    await POST(req);

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('unknown');
  });

  test('email with valid format accepted', async () => {
    const validEmails = [
      'test@example.com',
      'user+tag@domain.co.jp',
      'info@my-domain.com',
    ];

    for (const email of validEmails) {
      const res = await POST(makeRequest({
        name: 'Test User',
        email,
        inquiry_type: 'General',
        message: 'Test message',
      }));

      expect(res.status).toBe(200);
    }
  });

  test('boundary: name exactly 1 char → 200', async () => {
    const res = await POST(makeRequest({
      name: 'a',
      email: 'test@example.com',
      inquiry_type: 'General',
      message: 'Test message',
    }));

    expect(res.status).toBe(200);
  });

  test('boundary: name exactly 100 chars → 200', async () => {
    const res = await POST(makeRequest({
      name: 'a'.repeat(100),
      email: 'test@example.com',
      inquiry_type: 'General',
      message: 'Test message',
    }));

    expect(res.status).toBe(200);
  });

  test('boundary: message exactly 1 char → 200', async () => {
    const res = await POST(makeRequest({
      name: 'Test User',
      email: 'test@example.com',
      inquiry_type: 'General',
      message: 'a',
    }));

    expect(res.status).toBe(200);
  });

  test('boundary: message exactly 5000 chars → 200', async () => {
    const res = await POST(makeRequest({
      name: 'Test User',
      email: 'test@example.com',
      inquiry_type: 'General',
      message: 'a'.repeat(5000),
    }));

    expect(res.status).toBe(200);
  });
});
