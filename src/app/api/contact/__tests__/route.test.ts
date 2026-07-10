/**
 * @jest-environment node
 *
 * Tests for POST /api/contact
 * Key assertions:
 *   - CSRF check required
 *   - Rate limiting (3 req/min per IP)
 *   - Schema validation (name, email, inquiry_type, message)
 *   - Email format validation
 *   - Inserts to contacts table
 *   - Fire-and-forget Slack notification via /api/notify
 */

jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({
  mutationRateLimit: 'mutationLimit',
  checkRateLimit: jest.fn(),
}));
jest.mock('@supabase/supabase-js');
// Slack 通知は同一サーバー内の sendNotify を直接呼ぶ（HTTP 往復しない）。
// server-to-server fetch は CSRF で 403 になるため fetch 経由をやめた回帰の検証。
jest.mock('@/lib/notify', () => ({ sendNotify: jest.fn() }));
jest.mock('@/lib/recaptcha', () => ({ verifyRecaptcha: jest.fn() }));

import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { sendNotify } from '@/lib/notify';
import { verifyRecaptcha } from '@/lib/recaptcha';
import { POST } from '../route';

let mockInsert: jest.Mock;

function setupDefaultMocks(insertSucceeds: boolean = true) {
  (checkCsrf as jest.Mock).mockReturnValue(null);

  mockInsert = jest.fn().mockResolvedValue({
    error: insertSucceeds ? null : { message: 'Insert failed' },
  });

  const { createClient } = require('@supabase/supabase-js');
  createClient.mockReturnValue({
    from: jest.fn().mockReturnValue({
      insert: mockInsert,
    }),
  });

  (sendNotify as jest.Mock).mockResolvedValue({ ok: true, ts: '123.456' });
  (verifyRecaptcha as jest.Mock).mockResolvedValue({ success: true });

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  process.env.RECAPTCHA_SECRET_KEY = 'test-secret-key';
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockResolvedValue(false);
  setupDefaultMocks();
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
    const csrfError = new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 });
    (checkCsrf as jest.Mock).mockReturnValue(csrfError);

    const res = await POST(
      makeRequest({
        name: 'Test',
        email: 'test@example.com',
        inquiry_type: 'support',
        message: 'Help',
      }) as any
    );

    expect(res.status).toBe(403);
  });

  test('rate limiting → 429', async () => {
    (checkRateLimit as jest.Mock).mockResolvedValue(true);

    const res = await POST(
      makeRequest({
        name: 'Test',
        email: 'test@example.com',
        inquiry_type: 'support',
        message: 'Help',
      }) as any
    );

    expect(res.status).toBe(429);
  });

  test('invalid JSON → 400', async () => {
    const req = new Request('http://localhost/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '192.168.1.1' },
      body: 'invalid {',
    });

    const res = await POST(req as any);

    expect(res.status).toBe(400);
  });

  test('missing name → 400', async () => {
    const res = await POST(
      makeRequest({
        email: 'test@example.com',
        inquiry_type: 'support',
        message: 'Help',
      }) as any
    );

    expect(res.status).toBe(400);
  });

  test('empty name → 400', async () => {
    const res = await POST(
      makeRequest({
        name: '',
        email: 'test@example.com',
        inquiry_type: 'support',
        message: 'Help',
      }) as any
    );

    expect(res.status).toBe(400);
  });

  test('name > 100 chars → 400', async () => {
    const res = await POST(
      makeRequest({
        name: 'x'.repeat(101),
        email: 'test@example.com',
        inquiry_type: 'support',
        message: 'Help',
      }) as any
    );

    expect(res.status).toBe(400);
  });

  test('missing email → 400', async () => {
    const res = await POST(
      makeRequest({
        name: 'Test',
        inquiry_type: 'support',
        message: 'Help',
      }) as any
    );

    expect(res.status).toBe(400);
  });

  test('invalid email format → 400', async () => {
    const res = await POST(
      makeRequest({
        name: 'Test',
        email: 'not-an-email',
        inquiry_type: 'support',
        message: 'Help',
      }) as any
    );

    expect(res.status).toBe(400);
  });

  test('email > 254 chars → 400', async () => {
    const res = await POST(
      makeRequest({
        name: 'Test',
        email: 'x'.repeat(245) + '@example.com',
        inquiry_type: 'support',
        message: 'Help',
      }) as any
    );

    expect(res.status).toBe(400);
  });

  test('missing inquiry_type → 400', async () => {
    const res = await POST(
      makeRequest({
        name: 'Test',
        email: 'test@example.com',
        message: 'Help',
      }) as any
    );

    expect(res.status).toBe(400);
  });

  test('missing message → 400', async () => {
    const res = await POST(
      makeRequest({
        name: 'Test',
        email: 'test@example.com',
        inquiry_type: 'support',
      }) as any
    );

    expect(res.status).toBe(400);
  });

  test('empty message → 400', async () => {
    const res = await POST(
      makeRequest({
        name: 'Test',
        email: 'test@example.com',
        inquiry_type: 'support',
        message: '',
      }) as any
    );

    expect(res.status).toBe(400);
  });

  test('message > 5000 chars → 400', async () => {
    const res = await POST(
      makeRequest({
        name: 'Test',
        email: 'test@example.com',
        inquiry_type: 'support',
        message: 'x'.repeat(5001),
      }) as any
    );

    expect(res.status).toBe(400);
  });

  test('valid request → 200 with success', async () => {
    const res = await POST(
      makeRequest({
        name: 'Test User',
        email: 'test@example.com',
        inquiry_type: 'support',
        message: 'I need help with something',
        phone: '09012345678',
        recaptcha_token: 'valid-token',
      }) as any
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  test('inserts to contacts table', async () => {
    await POST(
      makeRequest({
        name: 'Test User',
        email: 'test@example.com',
        inquiry_type: 'support',
        message: 'Help needed',
        recaptcha_token: 'valid-token',
      }) as any
    );

    expect(mockInsert).toHaveBeenCalledWith({
      name: 'Test User',
      email: 'test@example.com',
      phone: null,
      inquiry_type: 'support',
      message: 'Help needed',
    });
  });

  test('optional phone field included when provided', async () => {
    await POST(
      makeRequest({
        name: 'Test',
        email: 'test@example.com',
        inquiry_type: 'support',
        message: 'Help',
        phone: '09012345678',
        recaptcha_token: 'valid-token',
      }) as any
    );

    const call = mockInsert.mock.calls[0];
    expect(call[0].phone).toBe('09012345678');
  });

  test('phone > 20 chars → 400', async () => {
    const res = await POST(
      makeRequest({
        name: 'Test',
        email: 'test@example.com',
        inquiry_type: 'support',
        message: 'Help',
        phone: 'x'.repeat(21),
      }) as any
    );

    expect(res.status).toBe(400);
  });

  test('insert error → 500', async () => {
    setupDefaultMocks(false);

    const res = await POST(
      makeRequest({
        name: 'Test',
        email: 'test@example.com',
        inquiry_type: 'support',
        message: 'Help',
        recaptcha_token: 'valid-token',
      }) as any
    );

    expect(res.status).toBe(500);
  });

  test('sends Slack notification (fire-and-forget)', async () => {
    await POST(
      makeRequest({
        name: 'Test',
        email: 'test@example.com',
        inquiry_type: 'support',
        message: 'Help needed',
        recaptcha_token: 'valid-token',
      }) as any
    );

    // Slack notification should be sent via sendNotify (no HTTP round-trip)
    expect(sendNotify).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'contact' })
    );
  });

  test('Slack notification includes contact type', async () => {
    await POST(
      makeRequest({
        name: 'Test',
        email: 'test@example.com',
        inquiry_type: 'support',
        message: 'Help',
        recaptcha_token: 'valid-token',
      }) as any
    );

    const call = (sendNotify as jest.Mock).mock.calls[0];
    expect(call[0].type).toBe('contact');
  });

  test('Slack notification error → still returns 200 (fire-and-forget)', async () => {
    (sendNotify as jest.Mock).mockRejectedValue(new Error('Network error'));

    const res = await POST(
      makeRequest({
        name: 'Test',
        email: 'test@example.com',
        inquiry_type: 'support',
        message: 'Help',
        recaptcha_token: 'valid-token',
      }) as any
    );

    expect(res.status).toBe(200);
  });

  test('Slack notification が ok:false を返しても 200（通知失敗はログのみ）', async () => {
    (sendNotify as jest.Mock).mockResolvedValue({ ok: false, error: 'not_configured' });

    const res = await POST(
      makeRequest({
        name: 'Test',
        email: 'test@example.com',
        inquiry_type: 'support',
        message: 'Help',
        recaptcha_token: 'valid-token',
      }) as any
    );

    expect(res.status).toBe(200);
    expect(sendNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'contact' }));
  });

  test('rate limit params (3 req/min per IP)', async () => {
    (checkRateLimit as jest.Mock).mockClear();

    await POST(
      makeRequest(
        {
          name: 'Test',
          email: 'test@example.com',
          inquiry_type: 'support',
          message: 'Help',
        },
        '192.168.1.1'
      ) as any
    );

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
    expect(call[2]).toBe(3);
    expect(call[3]).toBe(60_000);
    expect(call[4]).toBe('contact');
  });

  test('extracts last (trusted) IP from x-forwarded-for', async () => {
    (checkRateLimit as jest.Mock).mockClear();

    await POST(
      makeRequest(
        {
          name: 'Test',
          email: 'test@example.com',
          inquiry_type: 'support',
          message: 'Help',
        },
        '10.0.0.1, 192.168.1.1'
      ) as any
    );

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
  });

  test('inquiry_type > 100 chars → 400', async () => {
    const res = await POST(
      makeRequest({
        name: 'Test',
        email: 'test@example.com',
        inquiry_type: 'x'.repeat(101),
        message: 'Help',
        recaptcha_token: 'valid-token',
      }) as any
    );

    expect(res.status).toBe(400);
  });

  // review.ts と同一パターンの reCAPTCHA fail-closed 検証（監査・contact.ts未配線の恒久根治）。
  describe('reCAPTCHA', () => {
    test('secret設定済み + token欠如 → 403（fail-closed）・verifyRecaptchaは呼ばれない', async () => {
      (verifyRecaptcha as jest.Mock).mockClear();

      const res = await POST(
        makeRequest({
          name: 'Test',
          email: 'test@example.com',
          inquiry_type: 'support',
          message: 'Help',
        }) as any
      );

      expect(res.status).toBe(403);
      expect(verifyRecaptcha).not.toHaveBeenCalled();
    });

    test('verifyRecaptcha が success:false → 403', async () => {
      (verifyRecaptcha as jest.Mock).mockResolvedValue({ success: false });

      const res = await POST(
        makeRequest({
          name: 'Test',
          email: 'test@example.com',
          inquiry_type: 'support',
          message: 'Help',
          recaptcha_token: 'bad-token',
        }) as any
      );

      expect(res.status).toBe(403);
    });

    test('verifyRecaptcha に action=contact, minScore=0.4 で呼ばれる', async () => {
      await POST(
        makeRequest({
          name: 'Test',
          email: 'test@example.com',
          inquiry_type: 'support',
          message: 'Help',
          recaptcha_token: 'valid-token',
        }) as any
      );

      expect(verifyRecaptcha).toHaveBeenCalledWith('valid-token', 'contact', 0.4);
    });

    test('RECAPTCHA_SECRET_KEY 未設定 → 検証スキップで200（開発環境互換）', async () => {
      delete process.env.RECAPTCHA_SECRET_KEY;
      (verifyRecaptcha as jest.Mock).mockClear();

      const res = await POST(
        makeRequest({
          name: 'Test',
          email: 'test@example.com',
          inquiry_type: 'support',
          message: 'Help',
        }) as any
      );

      expect(res.status).toBe(200);
      expect(verifyRecaptcha).not.toHaveBeenCalled();
    });
  });
});
