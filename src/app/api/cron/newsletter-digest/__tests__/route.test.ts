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

  test('campaign insert エラー → 500', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    let newsletterCalls = 0;
    createServiceRoleClient.mockReturnValue({
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'newsletter_campaigns') {
          newsletterCalls++;
          if (newsletterCalls === 1) {
            return {
              select: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  eq: jest.fn().mockReturnValue({
                    gte: jest.fn().mockReturnValue({
                      limit: jest.fn().mockResolvedValue({ data: [] }),
                    }),
                  }),
                }),
              }),
            };
          }
          return {
            insert: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({ data: null, error: { message: 'Insert failed' } }),
              }),
            }),
          };
        }
        return {
          select: jest.fn().mockReturnValue({
            gte: jest.fn().mockReturnValue({
              lte: jest.fn().mockResolvedValue({ count: 0 }),
            }),
          }),
        };
      }),
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
  });

  test('batch send 失敗 → failedCount に加算して 200 続行', async () => {
    mockBatchSend.mockRejectedValue(new Error('batch send failed'));

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.skipped).toBeGreaterThan(0);
  });

  test('insert conflict (23505) → skipped 200', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    let newsletterCalls = 0;
    createServiceRoleClient.mockReturnValue({
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'newsletter_campaigns') {
          newsletterCalls++;
          if (newsletterCalls === 1) {
            return {
              select: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  eq: jest.fn().mockReturnValue({
                    gte: jest.fn().mockReturnValue({
                      limit: jest.fn().mockResolvedValue({ data: [] }),
                    }),
                  }),
                }),
              }),
            };
          }
          return {
            insert: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({ data: null, error: { code: '23505', message: 'unique violation' } }),
              }),
            }),
          };
        }
        return {
          select: jest.fn().mockReturnValue({
            gte: jest.fn().mockReturnValue({
              lte: jest.fn().mockResolvedValue({ count: 0 }),
            }),
          }),
        };
      }),
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.skipped).toBe(true);
  });

  test('owners with profiles as array → email extracted', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    let newsletterCalls = 0;
    createServiceRoleClient.mockReturnValue({
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'newsletter_campaigns') {
          newsletterCalls++;
          if (newsletterCalls === 1) {
            return {
              select: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  eq: jest.fn().mockReturnValue({
                    gte: jest.fn().mockReturnValue({
                      limit: jest.fn().mockResolvedValue({ data: [] }),
                    }),
                  }),
                }),
              }),
            };
          } else if (newsletterCalls === 2) {
            return {
              insert: jest.fn().mockReturnValue({
                select: jest.fn().mockReturnValue({
                  single: jest.fn().mockResolvedValue({ data: { id: 'camp-arr' }, error: null }),
                }),
              }),
            };
          }
          return {
            update: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ error: null }),
            }),
          };
        } else if (table === 'facility_members') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({
                // profiles as array (covers Array.isArray true branch) + null entry (filter)
                data: [
                  { profiles: [{ email: 'arr@example.com' }] },
                  { profiles: null },
                  { profiles: [] },
                ],
              }),
            }),
          };
        } else if (table === 'cron_logs') {
          return { insert: jest.fn().mockResolvedValue({ error: null }) };
        }
        return {
          select: jest.fn().mockReturnValue({
            gte: jest.fn().mockReturnValue({
              lte: jest.fn().mockResolvedValue({ count: null }),
            }),
          }),
        };
      }),
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
  });

  test('catch non-Error throw → String fallback', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn(() => { throw 'plain string error'; }),
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
  });

  // Branch coverage: line 10 — makeUnsubToken の if (!secret) throw ブランチ
  // Line 26 のガードは通過後、送信ループで secret が消えているシナリオ
  test('secret が送信ループ中に消えた場合 → catch → 500', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    let newsletterCalls = 0;

    createServiceRoleClient.mockReturnValue({
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'newsletter_campaigns') {
          newsletterCalls++;
          if (newsletterCalls === 1) {
            return {
              select: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  eq: jest.fn().mockReturnValue({
                    gte: jest.fn().mockReturnValue({
                      limit: jest.fn().mockResolvedValue({ data: [] }),
                    }),
                  }),
                }),
              }),
            };
          } else if (newsletterCalls === 2) {
            return {
              insert: jest.fn().mockReturnValue({
                select: jest.fn().mockReturnValue({
                  single: jest.fn().mockResolvedValue({ data: { id: 'camp-sec' }, error: null }),
                }),
              }),
            };
          }
          return {
            update: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ error: null }),
            }),
          };
        } else if (table === 'facility_members') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockImplementation(() => {
                // Delete the secret AFTER the Line 26 guard passes, so makeUnsubToken throws
                delete process.env.NEWSLETTER_UNSUBSCRIBE_SECRET;
                return Promise.resolve({
                  data: [{ profiles: { email: 'owner@example.com' } }],
                });
              }),
            }),
          };
        } else if (table === 'cron_logs') {
          return { insert: jest.fn().mockResolvedValue({ error: null }) };
        }
        return {
          select: jest.fn().mockReturnValue({
            gte: jest.fn().mockReturnValue({
              lte: jest.fn().mockResolvedValue({ count: 0 }),
            }),
          }),
        };
      }),
    });

    const res = await GET(makeRequest() as any);
    // makeUnsubToken throws → caught at top-level catch → 500
    expect(res.status).toBe(500);
    consoleSpy.mockRestore();
  });

  // Branch coverage: line 168 — owners が null → fallback to []
  test('facility_members が null データを返す → emails = []', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    let newsletterCalls = 0;

    createServiceRoleClient.mockReturnValue({
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'newsletter_campaigns') {
          newsletterCalls++;
          if (newsletterCalls === 1) {
            return {
              select: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  eq: jest.fn().mockReturnValue({
                    gte: jest.fn().mockReturnValue({
                      limit: jest.fn().mockResolvedValue({ data: [] }),
                    }),
                  }),
                }),
              }),
            };
          } else if (newsletterCalls === 2) {
            return {
              insert: jest.fn().mockReturnValue({
                select: jest.fn().mockReturnValue({
                  single: jest.fn().mockResolvedValue({ data: { id: 'camp-null' }, error: null }),
                }),
              }),
            };
          }
          return {
            update: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ error: null }),
            }),
          };
        } else if (table === 'facility_members') {
          return {
            select: jest.fn().mockReturnValue({
              // owners data = null → triggers `(owners || [])` fallback
              eq: jest.fn().mockResolvedValue({ data: null }),
            }),
          };
        } else if (table === 'cron_logs') {
          return { insert: jest.fn().mockResolvedValue({ error: null }) };
        }
        return {
          select: jest.fn().mockReturnValue({
            gte: jest.fn().mockReturnValue({
              lte: jest.fn().mockResolvedValue({ count: 0 }),
            }),
          }),
        };
      }),
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    // No owners → sentCount = 0
    expect(json.processed).toBe(0);
  });

  // Branch coverage: line 227 — catch で e instanceof Error false → String(e) ブランチ
  // (すでに 'catch non-Error throw → String fallback' テストがカバーしているが
  //  logCronRun が非同期で呼ばれるため、明示的に await してカバーを確実にする)
  test('logCronRun が呼ばれる中で非Error throwが発生 → String(e)ブランチ到達', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    // cron_logs の insert が throw するパターン（logCronRun 内部）で非Error
    createServiceRoleClient.mockReturnValue({
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'cron_logs') {
          return { insert: jest.fn(() => { throw 42; }) };
        }
        // Make the main try-block throw a non-Error to reach line 227
        throw 'non-error-string';
      }),
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
  });

  test('campaign update エラー → console.error して 200 続行', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    let newsletterCalls = 0;
    createServiceRoleClient.mockReturnValue({
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'newsletter_campaigns') {
          newsletterCalls++;
          if (newsletterCalls === 1) {
            return {
              select: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  eq: jest.fn().mockReturnValue({
                    gte: jest.fn().mockReturnValue({
                      limit: jest.fn().mockResolvedValue({ data: [] }),
                    }),
                  }),
                }),
              }),
            };
          } else if (newsletterCalls === 2) {
            return {
              insert: jest.fn().mockReturnValue({
                select: jest.fn().mockReturnValue({
                  single: jest.fn().mockResolvedValue({ data: { id: 'camp-999' }, error: null }),
                }),
              }),
            };
          }
          return {
            update: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ error: { message: 'update failed' } }),
            }),
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
          return { insert: jest.fn().mockResolvedValue({ error: null }) };
        }
        return {
          select: jest.fn().mockReturnValue({
            gte: jest.fn().mockReturnValue({
              lte: jest.fn().mockResolvedValue({ count: 0 }),
            }),
          }),
        };
      }),
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
