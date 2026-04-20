/**
 * @jest-environment node
 *
 * Tests for POST /api/notify
 * Key assertions:
 *   - CSRF check → returns checkCsrf result
 *   - Rate limiting → 429
 *   - Missing SLACK_WEBHOOK_URL → 500
 *   - Invalid JSON → 400
 *   - Zod discriminated union validation (4 types)
 *   - Field length validation for each type
 *   - HTML escaping (escSlack) for Slack safety
 *   - Slack webhook success → 200
 *   - Slack webhook failure → 502
 */

jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => Promise.resolve(false)) }));
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }));

global.fetch = jest.fn();

import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { POST } from '../route';

beforeEach(() => {
  jest.clearAllMocks();
  (checkCsrf as jest.Mock).mockReturnValue(null);
  (checkRateLimit as jest.Mock).mockResolvedValue(false);
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true }),
  });
  process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/REDACTED';
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
    const csrfError = new Response(JSON.stringify({ error: 'CSRF failed' }), { status: 403 });
    (checkCsrf as jest.Mock).mockReturnValue(csrfError);

    const res = await POST(makeRequest({
      type: 'contact',
      data: {
        name: 'Test User',
        inquiry_type: 'General',
        email: 'test@example.com',
        message: 'Test message',
      },
    }));

    expect(res.status).toBe(403);
  });

  test('rate limiting → 429', async () => {
    (checkRateLimit as jest.Mock).mockResolvedValue(true);

    const res = await POST(makeRequest({
      type: 'contact',
      data: {
        name: 'Test User',
        inquiry_type: 'General',
        email: 'test@example.com',
        message: 'Test message',
      },
    }));

    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toContain('Too many requests');
  });

  test('missing SLACK_WEBHOOK_URL → 500', async () => {
    delete process.env.SLACK_WEBHOOK_URL;

    const res = await POST(makeRequest({
      type: 'contact',
      data: {
        name: 'Test User',
        inquiry_type: 'General',
        email: 'test@example.com',
        message: 'Test message',
      },
    }));

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain('失敗');
  });

  test('invalid JSON → 400', async () => {
    const req = new Request('http://localhost/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'invalid json {',
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  test('missing type field → 400', async () => {
    const res = await POST(makeRequest({
      data: {
        name: 'Test User',
        inquiry_type: 'General',
        email: 'test@example.com',
        message: 'Test message',
      },
    }));

    expect(res.status).toBe(400);
  });

  test('invalid type → 400', async () => {
    const res = await POST(makeRequest({
      type: 'invalid_type',
      data: {},
    }));

    expect(res.status).toBe(400);
  });

  test('contact: valid payload → 200', async () => {
    const res = await POST(makeRequest({
      type: 'contact',
      data: {
        name: 'John Doe',
        inquiry_type: 'Support',
        email: 'john@example.com',
        message: 'I need help with X',
      },
    }));

    expect(res.status).toBe(200);
  });

  test('contact: missing name → 400', async () => {
    const res = await POST(makeRequest({
      type: 'contact',
      data: {
        inquiry_type: 'Support',
        email: 'john@example.com',
        message: 'I need help with X',
      },
    }));

    expect(res.status).toBe(400);
  });

  test('contact: name too long → 400', async () => {
    const res = await POST(makeRequest({
      type: 'contact',
      data: {
        name: 'a'.repeat(101),
        inquiry_type: 'Support',
        email: 'john@example.com',
        message: 'I need help with X',
      },
    }));

    expect(res.status).toBe(400);
  });

  test('contact: inquiry_type too long → 400', async () => {
    const res = await POST(makeRequest({
      type: 'contact',
      data: {
        name: 'John Doe',
        inquiry_type: 'a'.repeat(101),
        email: 'john@example.com',
        message: 'I need help with X',
      },
    }));

    expect(res.status).toBe(400);
  });

  test('contact: email too long → 400', async () => {
    const res = await POST(makeRequest({
      type: 'contact',
      data: {
        name: 'John Doe',
        inquiry_type: 'Support',
        email: 'a'.repeat(250) + '@test.com',
        message: 'I need help with X',
      },
    }));

    expect(res.status).toBe(400);
  });

  test('contact: message too long → 400', async () => {
    const res = await POST(makeRequest({
      type: 'contact',
      data: {
        name: 'John Doe',
        inquiry_type: 'Support',
        email: 'john@example.com',
        message: 'a'.repeat(2001),
      },
    }));

    expect(res.status).toBe(400);
  });

  test('salon: valid payload → 200', async () => {
    const res = await POST(makeRequest({
      type: 'salon',
      data: {
        facility_name: 'Beautiful Salon',
        business_type: 'Beauty',
        representative_name: 'Jane Smith',
        phone: '09012345678',
        email: 'salon@example.com',
      },
    }));

    expect(res.status).toBe(200);
  });

  test('salon: facility_name too long → 400', async () => {
    const res = await POST(makeRequest({
      type: 'salon',
      data: {
        facility_name: 'a'.repeat(201),
        business_type: 'Beauty',
        representative_name: 'Jane Smith',
        phone: '09012345678',
        email: 'salon@example.com',
      },
    }));

    expect(res.status).toBe(400);
  });

  test('salon: business_type too long → 400', async () => {
    const res = await POST(makeRequest({
      type: 'salon',
      data: {
        facility_name: 'Beautiful Salon',
        business_type: 'a'.repeat(101),
        representative_name: 'Jane Smith',
        phone: '09012345678',
        email: 'salon@example.com',
      },
    }));

    expect(res.status).toBe(400);
  });

  test('salon: optional address included → 200', async () => {
    const res = await POST(makeRequest({
      type: 'salon',
      data: {
        facility_name: 'Beautiful Salon',
        business_type: 'Beauty',
        representative_name: 'Jane Smith',
        phone: '09012345678',
        email: 'salon@example.com',
        address: 'Tokyo, Japan',
      },
    }));

    expect(res.status).toBe(200);
  });

  test('salon: optional desired_start_date included → 200', async () => {
    const res = await POST(makeRequest({
      type: 'salon',
      data: {
        facility_name: 'Beautiful Salon',
        business_type: 'Beauty',
        representative_name: 'Jane Smith',
        phone: '09012345678',
        email: 'salon@example.com',
        desired_start_date: '2026-05-01',
      },
    }));

    expect(res.status).toBe(200);
  });

  test('facility_inquiry: valid payload → 200', async () => {
    const res = await POST(makeRequest({
      type: 'facility_inquiry',
      data: {
        facility_name: 'Test Clinic',
        name: 'John Doe',
        email: 'john@example.com',
        phone: '09012345678',
        message: 'Do you offer X service?',
      },
    }));

    expect(res.status).toBe(200);
  });

  test('facility_inquiry: message too long → 400', async () => {
    const res = await POST(makeRequest({
      type: 'facility_inquiry',
      data: {
        facility_name: 'Test Clinic',
        name: 'John Doe',
        email: 'john@example.com',
        phone: '09012345678',
        message: 'a'.repeat(2001),
      },
    }));

    expect(res.status).toBe(400);
  });

  test('facility: valid payload → 200', async () => {
    const res = await POST(makeRequest({
      type: 'facility',
      data: {
        facility_name: 'Test Hospital',
        contact_name: 'Dr. Smith',
        email: 'contact@hospital.com',
        phone: '09012345678',
        business_type: 'Healthcare',
      },
    }));

    expect(res.status).toBe(200);
  });

  test('facility: contact_name too long → 400', async () => {
    const res = await POST(makeRequest({
      type: 'facility',
      data: {
        facility_name: 'Test Hospital',
        contact_name: 'a'.repeat(101),
        email: 'contact@hospital.com',
        phone: '09012345678',
        business_type: 'Healthcare',
      },
    }));

    expect(res.status).toBe(400);
  });

  test('Slack webhook success → 200', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    const res = await POST(makeRequest({
      type: 'contact',
      data: {
        name: 'Test User',
        inquiry_type: 'General',
        email: 'test@example.com',
        message: 'Test message',
      },
    }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  test('Slack webhook failure (not ok) → 502', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 401,
    });

    const res = await POST(makeRequest({
      type: 'contact',
      data: {
        name: 'Test User',
        inquiry_type: 'General',
        email: 'test@example.com',
        message: 'Test message',
      },
    }));

    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toContain('Slack');
  });

  test('Slack webhook exception → 500', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

    const res = await POST(makeRequest({
      type: 'contact',
      data: {
        name: 'Test User',
        inquiry_type: 'General',
        email: 'test@example.com',
        message: 'Test message',
      },
    }));

    expect(res.status).toBe(500);
  });

  test('HTML escaping: ampersand escaped in Slack message', async () => {
    await POST(makeRequest({
      type: 'contact',
      data: {
        name: 'Test & Co',
        inquiry_type: 'General',
        email: 'test@example.com',
        message: 'A & B',
      },
    }));

    expect(global.fetch).toHaveBeenCalled();
    const call = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.text).toContain('Test &amp; Co');
    expect(body.text).toContain('A &amp; B');
  });

  test('HTML escaping: angle brackets escaped in Slack message', async () => {
    await POST(makeRequest({
      type: 'contact',
      data: {
        name: '<script>alert(1)</script>',
        inquiry_type: 'General',
        email: 'test@example.com',
        message: 'Test <tag>',
      },
    }));

    const call = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.text).toContain('&lt;script&gt;');
    expect(body.text).toContain('&lt;tag&gt;');
  });

  test('HTML escaping: multiple special chars', async () => {
    await POST(makeRequest({
      type: 'salon',
      data: {
        facility_name: 'Salon & Spa <Premium>',
        business_type: 'Beauty & Wellness',
        representative_name: 'Jane <Doe>',
        phone: '09012345678',
        email: 'salon@example.com',
      },
    }));

    const call = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.text).toContain('&amp;');
    expect(body.text).toContain('&lt;Premium&gt;');
  });

  test('Slack message includes emoji and formatting', async () => {
    await POST(makeRequest({
      type: 'contact',
      data: {
        name: 'Test User',
        inquiry_type: 'General',
        email: 'test@example.com',
        message: 'Test message',
      },
    }));

    const call = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.text).toContain(':envelope:');
  });

  test('rate limit params (5 req/min per IP)', async () => {
    (checkRateLimit as jest.Mock).mockClear();

    await POST(makeRequest({
      type: 'contact',
      data: {
        name: 'Test User',
        inquiry_type: 'General',
        email: 'test@example.com',
        message: 'Test message',
      },
    }));

    expect(checkRateLimit).toHaveBeenCalled();
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
    expect(call[2]).toBe(5);
    expect(call[3]).toBe(60_000);
    expect(call[4]).toBe('notify');
  });

  test('extracts first IP from x-forwarded-for', async () => {
    (checkRateLimit as jest.Mock).mockClear();

    await POST(makeRequest({
      type: 'contact',
      data: {
        name: 'Test User',
        inquiry_type: 'General',
        email: 'test@example.com',
        message: 'Test message',
      },
    }, '10.0.0.1, 192.168.1.1'));

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('10.0.0.1');
  });

  test('salon emoji in Slack message', async () => {
    await POST(makeRequest({
      type: 'salon',
      data: {
        facility_name: 'Beautiful Salon',
        business_type: 'Beauty',
        representative_name: 'Jane Smith',
        phone: '09012345678',
        email: 'salon@example.com',
      },
    }));

    const call = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.text).toContain(':office:');
  });

  test('facility_inquiry emoji in Slack message', async () => {
    await POST(makeRequest({
      type: 'facility_inquiry',
      data: {
        facility_name: 'Test Clinic',
        name: 'John Doe',
        email: 'john@example.com',
        phone: '09012345678',
        message: 'Do you offer X service?',
      },
    }));

    const call = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.text).toContain(':hospital:');
  });

  test('facility emoji in Slack message', async () => {
    await POST(makeRequest({
      type: 'facility',
      data: {
        facility_name: 'Test Hospital',
        contact_name: 'Dr. Smith',
        email: 'contact@hospital.com',
        phone: '09012345678',
        business_type: 'Healthcare',
      },
    }));

    const call = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.text).toContain(':clipboard:');
  });

  test('Slack API call includes correct webhook URL', async () => {
    const webhookUrl = 'https://hooks.slack.com/services/REDACTED';
    process.env.SLACK_WEBHOOK_URL = webhookUrl;

    await POST(makeRequest({
      type: 'contact',
      data: {
        name: 'Test User',
        inquiry_type: 'General',
        email: 'test@example.com',
        message: 'Test message',
      },
    }));

    expect(global.fetch).toHaveBeenCalledWith(
      webhookUrl,
      expect.objectContaining({
        method: 'POST',
      })
    );
  });

  test('boundary: contact name exactly 100 chars → 200', async () => {
    const res = await POST(makeRequest({
      type: 'contact',
      data: {
        name: 'a'.repeat(100),
        inquiry_type: 'General',
        email: 'test@example.com',
        message: 'Test message',
      },
    }));

    expect(res.status).toBe(200);
  });

  test('boundary: contact message exactly 2000 chars → 200', async () => {
    const res = await POST(makeRequest({
      type: 'contact',
      data: {
        name: 'Test User',
        inquiry_type: 'General',
        email: 'test@example.com',
        message: 'a'.repeat(2000),
      },
    }));

    expect(res.status).toBe(200);
  });

  test('boundary: salon facility_name exactly 200 chars → 200', async () => {
    const res = await POST(makeRequest({
      type: 'salon',
      data: {
        facility_name: 'a'.repeat(200),
        business_type: 'Beauty',
        representative_name: 'Jane Smith',
        phone: '09012345678',
        email: 'salon@example.com',
      },
    }));

    expect(res.status).toBe(200);
  });

  test('fetch includes AbortSignal timeout', async () => {
    await POST(makeRequest({
      type: 'contact',
      data: {
        name: 'Test User',
        inquiry_type: 'General',
        email: 'test@example.com',
        message: 'Test message',
      },
    }));

    const call = (global.fetch as jest.Mock).mock.calls[0];
    expect(call[1].signal).toBeDefined();
  });
});
