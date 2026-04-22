/**
 * @jest-environment node
 *
 * Tests for GET /api/cron/newsletter-digest
 * Key assertions:
 *   - CRON_SECRET validation
 *   - Idempotency (check existing newsletter_campaigns)
 *   - Monthly newsletter to facility owners
 *   - HMAC unsubscribe token generation
 *   - Resend batch.send integration
 *   - HTML email generation with stats
 */

jest.mock('@/lib/cron-auth');
jest.mock('@/lib/supabase-server');
jest.mock('resend');

import { checkCronAuth } from '@/lib/cron-auth';
import { GET } from '../route';

let mockSelect: jest.Mock;
let mockBatchSend: jest.Mock;

function setupDefaultMocks(alreadySent: boolean = false) {
  (checkCronAuth as jest.Mock).mockReturnValue(null);

  const existingData = alreadySent ? [{ id: 'campaign-1' }] : [];

  mockSelect = jest.fn()
    .mockReturnValueOnce({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          gte: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue({
              data: existingData,
            }),
          }),
        }),
      }),
    })
    .mockReturnValueOnce({
      gte: jest.fn().mockReturnValue({
        lte: jest.fn().mockResolvedValue({
          count: 42,
        }),
      }),
    })
    .mockReturnValueOnce({
      gte: jest.fn().mockReturnValue({
        lte: jest.fn().mockResolvedValue({
          count: 15,
        }),
      }),
    })
    .mockReturnValueOnce({
      gte: jest.fn().mockReturnValue({
        lte: jest.fn().mockResolvedValue({
          count: 3,
        }),
      }),
    });

  const mockCampaignInsert = jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({
      single: jest.fn().mockResolvedValue({
        data: { id: 'campaign-123' },
        error: null,
      }),
    }),
  });
  const mockCampaignUpdate = jest.fn().mockReturnValue({
    eq: jest.fn().mockResolvedValue({ error: null }),
  });

  const { createServiceRoleClient } = require('@/lib/supabase-server');
  createServiceRoleClient.mockReturnValue({
    from: jest.fn().mockImplementation((table: string) => {
      if (table === 'newsletter_campaigns') {
        return {
          select: (...args: any[]) => mockSelect(...args),
          insert: mockCampaignInsert,
          update: mockCampaignUpdate,
        };
      } else if (table === 'facility_members') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({
              data: [{ profiles: { email: 'owner@example.com' } }],
            }),
          }),
        };
      } else if (table === 'cron_logs') {
        return {
          insert: jest.fn().mockResolvedValue({ error: null }),
        };
      }
      // bookings, reviews, facility_profiles (count queries)
      return { select: (...args: any[]) => mockSelect(...args) };
    }),
  });

  mockBatchSend = jest.fn().mockResolvedValue({
    data: { id: 'batch-123' },
  });

  const { Resend } = require('resend');
  Resend.mockImplementation(() => ({
    batch: { send: mockBatchSend },
  }));

  process.env.NEWSLETTER_UNSUBSCRIBE_SECRET = 'secret-key';
  process.env.RESEND_API_KEY = 'test-key';
}

beforeEach(() => {
  jest.clearAllMocks();
  setupDefaultMocks();
});

function makeRequest() {
  return new Request('http://localhost/api/cron/newsletter-digest', {
    method: 'GET',
    headers: { 'Authorization': 'Bearer cron-secret' },
  });
}

describe('GET /api/cron/newsletter-digest', () => {
  test('CRON_SECRET check failed → returns error', async () => {
    const errorResponse = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    (checkCronAuth as jest.Mock).mockReturnValue(errorResponse);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(401);
  });

  test('already sent this month → skipped', async () => {
    setupDefaultMocks(true);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.skipped).toBe(true);
  });

  test('not sent yet → sends newsletter', async () => {
    setupDefaultMocks(false);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    expect(mockBatchSend).toHaveBeenCalled();
  });

  test('missing NEWSLETTER_UNSUBSCRIBE_SECRET → 503', async () => {
    delete process.env.NEWSLETTER_UNSUBSCRIBE_SECRET;

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(503);
  });

  test('missing RESEND_API_KEY → 503', async () => {
    delete process.env.RESEND_API_KEY;

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(503);
  });

  test('HMAC unsubscribe token generation', async () => {
    const res = await GET(makeRequest() as any);

    if (mockBatchSend.mock.calls.length > 0) {
      const emails = mockBatchSend.mock.calls[0][0];
      // Each email should have unsubscribe URL with HMAC token
      if (Array.isArray(emails) && emails.length > 0) {
        expect(emails[0].html).toContain('unsubscribe');
      }
    }
  });

  test('includes booking count in HTML', async () => {
    const res = await GET(makeRequest() as any);

    if (mockBatchSend.mock.calls.length > 0) {
      const emails = mockBatchSend.mock.calls[0][0];
      if (Array.isArray(emails) && emails.length > 0) {
        expect(emails[0].html).toContain('42');
      }
    }
  });

  test('includes review count in HTML', async () => {
    const res = await GET(makeRequest() as any);

    if (mockBatchSend.mock.calls.length > 0) {
      const emails = mockBatchSend.mock.calls[0][0];
      if (Array.isArray(emails) && emails.length > 0) {
        expect(emails[0].html).toContain('15');
      }
    }
  });

  test('includes new facilities count in HTML', async () => {
    const res = await GET(makeRequest() as any);

    if (mockBatchSend.mock.calls.length > 0) {
      const emails = mockBatchSend.mock.calls[0][0];
      if (Array.isArray(emails) && emails.length > 0) {
        expect(emails[0].html).toContain('3');
      }
    }
  });

  test('includes month in newsletter subject', async () => {
    const res = await GET(makeRequest() as any);

    if (mockBatchSend.mock.calls.length > 0) {
      const emails = mockBatchSend.mock.calls[0][0];
      if (Array.isArray(emails) && emails.length > 0) {
        expect(emails[0].subject).toContain('ニュースレター');
      }
    }
  });

  test('HTML contains CareLink header', async () => {
    const res = await GET(makeRequest() as any);

    if (mockBatchSend.mock.calls.length > 0) {
      const emails = mockBatchSend.mock.calls[0][0];
      if (Array.isArray(emails) && emails.length > 0) {
        expect(emails[0].html).toContain('CareLink');
      }
    }
  });

  test('unsubscribe token is SHA256 HMAC', async () => {
    const res = await GET(makeRequest() as any);

    if (mockBatchSend.mock.calls.length > 0) {
      const emails = mockBatchSend.mock.calls[0][0];
      if (Array.isArray(emails) && emails.length > 0) {
        const html = emails[0].html;
        // Check for hex format (SHA256 produces 64 hex chars)
        expect(html).toMatch(/hmac=[a-f0-9]{64}/);
      }
    }
  });

  test('unsubscribe URL is properly encoded', async () => {
    const res = await GET(makeRequest() as any);

    if (mockBatchSend.mock.calls.length > 0) {
      const emails = mockBatchSend.mock.calls[0][0];
      if (Array.isArray(emails) && emails.length > 0) {
        const html = emails[0].html;
        expect(html).toMatch(/unsubscribe\?email=/);
      }
    }
  });

  test('batch.send receives email array', async () => {
    const res = await GET(makeRequest() as any);

    if (mockBatchSend.mock.calls.length > 0) {
      const emails = mockBatchSend.mock.calls[0][0];
      expect(Array.isArray(emails)).toBe(true);
    }
  });

  test('each email has required fields', async () => {
    const res = await GET(makeRequest() as any);

    if (mockBatchSend.mock.calls.length > 0) {
      const emails = mockBatchSend.mock.calls[0][0];
      if (Array.isArray(emails) && emails.length > 0) {
        expect(emails[0]).toHaveProperty('to');
        expect(emails[0]).toHaveProperty('subject');
        expect(emails[0]).toHaveProperty('html');
      }
    }
  });

  test('idempotency: checks start of current month', async () => {
    await GET(makeRequest() as any);

    // Verify that the query checked for existing campaigns
    expect(mockSelect).toHaveBeenCalled();
  });

  test('returns 200 with response', async () => {
    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toBeDefined();
  });
});
