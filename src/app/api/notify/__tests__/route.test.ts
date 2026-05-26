/**
 * @jest-environment node
 *
 * Tests for POST /api/notify
 * Key assertions:
 *   - CSRF check required
 *   - Rate limiting (5 req/min per IP)
 *   - Discriminated union payload validation (salon, contact, facility_inquiry, facility)
 *   - XSS prevention via escSlack (HTML entity escaping)
 *   - Slack webhook integration
 *   - Multiple notification types
 */

jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({
  notifyRateLimit: 'notifyLimit',
  checkRateLimit: jest.fn(),
}));

import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { POST } from '../route';

function setupDefaultMocks() {
  // Phase 7a: chat.postMessage は { ok: true, ts: '...' } を返す
  global.fetch = jest.fn().mockResolvedValue(
    new Response(JSON.stringify({ ok: true, ts: '1234.5678', channel: 'C0TESTCHAN' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  );

  process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';
  process.env.SLACK_DEFAULT_CHANNEL = 'C0TESTCHAN';
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkCsrf as jest.Mock).mockReturnValue(null);
  (checkRateLimit as jest.Mock).mockResolvedValue(false);
  setupDefaultMocks();
});

function makeRequest(body: object, ip = '192.168.1.1') {
  return new Request('http://localhost/api/notify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/notify', () => {
  test('CSRF check failed → returns error', async () => {
    const csrfError = new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 });
    (checkCsrf as jest.Mock).mockReturnValue(csrfError);

    const res = await POST(
      makeRequest({ type: 'salon', data: { facility_name: 'Test' } }) as any
    );

    expect(res.status).toBe(403);
  });

  test('rate limiting → 429', async () => {
    (checkRateLimit as jest.Mock).mockResolvedValue(true);

    const res = await POST(
      makeRequest({
        type: 'salon',
        data: {
          facility_name: 'Test Salon',
          business_type: 'beauty',
          representative_name: 'John',
          phone: '09012345678',
          email: 'test@example.com',
        },
      }) as any
    );

    expect(res.status).toBe(429);
  });

  test('invalid JSON → 400', async () => {
    const req = new Request('http://localhost/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '192.168.1.1' },
      body: 'invalid {',
    });

    const res = await POST(req as any);

    expect(res.status).toBe(400);
  });

  test('missing type → 400', async () => {
    const res = await POST(
      makeRequest({ data: { name: 'test' } }) as any
    );

    expect(res.status).toBe(400);
  });

  test('invalid type → 400', async () => {
    const res = await POST(
      makeRequest({
        type: 'invalid',
        data: {},
      }) as any
    );

    expect(res.status).toBe(400);
  });

  test('salon type: missing facility_name → 400', async () => {
    const res = await POST(
      makeRequest({
        type: 'salon',
        data: {
          business_type: 'beauty',
          representative_name: 'John',
          phone: '09012345678',
          email: 'test@example.com',
        },
      }) as any
    );

    expect(res.status).toBe(400);
  });

  test('salon type: facility_name too long → 400', async () => {
    const res = await POST(
      makeRequest({
        type: 'salon',
        data: {
          facility_name: 'x'.repeat(201),
          business_type: 'beauty',
          representative_name: 'John',
          phone: '09012345678',
          email: 'test@example.com',
        },
      }) as any
    );

    expect(res.status).toBe(400);
  });

  test('salon type: email too long → 400', async () => {
    const res = await POST(
      makeRequest({
        type: 'salon',
        data: {
          facility_name: 'Test Salon',
          business_type: 'beauty',
          representative_name: 'John',
          phone: '09012345678',
          email: 'x'.repeat(255),
        },
      }) as any
    );

    expect(res.status).toBe(400);
  });

  test('salon type valid → 200', async () => {
    const res = await POST(
      makeRequest({
        type: 'salon',
        data: {
          facility_name: 'Test Salon',
          business_type: 'beauty',
          representative_name: 'John Doe',
          phone: '09012345678',
          email: 'test@example.com',
          address: 'Tokyo',
          desired_start_date: '2026-06-01',
        },
      }) as any
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  test('contact type valid → 200', async () => {
    const res = await POST(
      makeRequest({
        type: 'contact',
        data: {
          name: 'Test User',
          inquiry_type: 'support',
          email: 'contact@example.com',
          message: 'Need help with something',
        },
      }) as any
    );

    expect(res.status).toBe(200);
  });

  test('facility_inquiry type valid → 200', async () => {
    const res = await POST(
      makeRequest({
        type: 'facility_inquiry',
        data: {
          facility_name: 'Test Facility',
          name: 'Inquiry User',
          email: 'inquiry@example.com',
          phone: '09012345678',
          message: 'Question about services',
        },
      }) as any
    );

    expect(res.status).toBe(200);
  });

  test('facility type valid → 200', async () => {
    const res = await POST(
      makeRequest({
        type: 'facility',
        data: {
          facility_name: 'Test Facility',
          contact_name: 'Manager',
          email: 'manager@example.com',
          phone: '09012345678',
          business_type: 'salon',
        },
      }) as any
    );

    expect(res.status).toBe(200);
  });

  test('XSS prevention: HTML escaping in facility_name', async () => {
    const res = await POST(
      makeRequest({
        type: 'salon',
        data: {
          facility_name: '<script>alert("xss")</script>',
          business_type: 'beauty',
          representative_name: 'John',
          phone: '09012345678',
          email: 'test@example.com',
        },
      }) as any
    );

    const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.text).not.toContain('<script>');
    expect(body.text).toContain('&lt;script&gt;');
  });

  test('XSS prevention: & escaping', async () => {
    const res = await POST(
      makeRequest({
        type: 'salon',
        data: {
          facility_name: 'Test & Co',
          business_type: 'beauty',
          representative_name: 'John',
          phone: '09012345678',
          email: 'test@example.com',
        },
      }) as any
    );

    const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.text).toContain('&amp;');
  });

  test('calls Slack webhook with POST', async () => {
    const res = await POST(
      makeRequest({
        type: 'salon',
        data: {
          facility_name: 'Test Salon',
          business_type: 'beauty',
          representative_name: 'John',
          phone: '09012345678',
          email: 'test@example.com',
        },
      }) as any
    );

    expect(global.fetch).toHaveBeenCalledWith(
      'https://slack.com/api/chat.postMessage',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer xoxb-test-token',
        }),
      })
    );
  });

  test('Slack API ok:false 応答 → 502', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: 'channel_not_found' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const res = await POST(
      makeRequest({
        type: 'salon',
        data: {
          facility_name: 'Test',
          business_type: 'beauty',
          representative_name: 'John',
          phone: '09012345678',
          email: 'test@example.com',
        },
      }) as any
    );

    expect(res.status).toBe(502);
  });

  test('missing SLACK_BOT_TOKEN → 500', async () => {
    delete process.env.SLACK_BOT_TOKEN;

    const res = await POST(
      makeRequest({
        type: 'salon',
        data: {
          facility_name: 'Test',
          business_type: 'beauty',
          representative_name: 'John',
          phone: '09012345678',
          email: 'test@example.com',
        },
      }) as any
    );

    expect(res.status).toBe(500);
  });

  test('rate limit params (5 req/min per IP)', async () => {
    (checkRateLimit as jest.Mock).mockClear();

    await POST(
      makeRequest(
        {
          type: 'salon',
          data: {
            facility_name: 'Test',
            business_type: 'beauty',
            representative_name: 'John',
            phone: '09012345678',
            email: 'test@example.com',
          },
        },
        '192.168.1.1'
      ) as any
    );

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
    expect(call[2]).toBe(5);
    expect(call[3]).toBe(60_000);
    expect(call[4]).toBe('notify');
  });

  test('extracts first IP from x-forwarded-for', async () => {
    (checkRateLimit as jest.Mock).mockClear();

    await POST(
      makeRequest(
        {
          type: 'salon',
          data: {
            facility_name: 'Test',
            business_type: 'beauty',
            representative_name: 'John',
            phone: '09012345678',
            email: 'test@example.com',
          },
        },
        '10.0.0.1, 192.168.1.1'
      ) as any
    );

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('10.0.0.1');
  });

  test('message field max 2000 chars', async () => {
    const res = await POST(
      makeRequest({
        type: 'contact',
        data: {
          name: 'Test',
          inquiry_type: 'support',
          email: 'test@example.com',
          message: 'x'.repeat(2001),
        },
      }) as any
    );

    expect(res.status).toBe(400);
  });

  test('salon with optional fields omitted → 200', async () => {
    const res = await POST(
      makeRequest({
        type: 'salon',
        data: {
          facility_name: 'Test Salon',
          business_type: 'beauty',
          representative_name: 'John',
          phone: '09012345678',
          email: 'test@example.com',
        },
      }) as any
    );

    expect(res.status).toBe(200);
  });

  test('fetch timeout → 502（postToSlack が ok:false で吸収）', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Timeout'));

    const res = await POST(
      makeRequest({
        type: 'salon',
        data: {
          facility_name: 'Test',
          business_type: 'beauty',
          representative_name: 'John',
          phone: '09012345678',
          email: 'test@example.com',
        },
      }) as any
    );

    expect(res.status).toBe(502);
  });
});
