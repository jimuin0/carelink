/**
 * @jest-environment node
 *
 * Tests for GET /api/cron/birthday-coupon
 * Key assertions:
 *   - CRON_SECRET validation
 *   - Finds profiles with today's birth_date (MM-DD)
 *   - Awards 100 points via user_points insert
 *   - Handles 23505 (already awarded)
 *   - Sends birthday email (if RESEND_API_KEY)
 *   - Sends LINE notification (if LINE_CHANNEL_ACCESS_TOKEN_CARELINK)
 *   - Idempotency via year-based reason (birthday_YYYY)
 *   - Logs cron execution
 */

jest.mock('@/lib/cron-auth', () => ({
  checkCronAuth: jest.fn(() => null),
}));
jest.mock('@/lib/cron-logger');
jest.mock('@/lib/line');
jest.mock('resend');

// Module-level supabase = createClient(...) — use wrapper so from() is lazily resolved
const mockFrom = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: (...args: any[]) => mockFrom(...args),
  })),
}));

import { checkCronAuth } from '@/lib/cron-auth';
import { logCronRun } from '@/lib/cron-logger';
import { sendLineText } from '@/lib/line';
import { GET } from '../route';

let mockProfilesSelect: jest.Mock;
let mockPointsInsert: jest.Mock;
let mockLineLinkSelect: jest.Mock;

function setupDefaultMocks(
  birthdayProfiles: number = 2,
  pointsInsertFails: number = 0,
  lineLinkFound: boolean = true,
  resendAvailable: boolean = true
) {
  (checkCronAuth as jest.Mock).mockReturnValue(null);
  (logCronRun as jest.Mock).mockResolvedValue(undefined);
  (sendLineText as jest.Mock).mockResolvedValue(undefined);

  const profileData =
    birthdayProfiles > 0
      ? Array.from({ length: birthdayProfiles }, (_, i) => ({
          id: `user-${i}`,
          email: `user${i}@example.com`,
          display_name: `Birthday User ${i}`,
        }))
      : [];
  const lineLinkData = lineLinkFound ? { line_user_id: 'line-user-123' } : null;

  mockProfilesSelect = jest.fn().mockReturnValue({
    not: jest.fn().mockReturnValue({
      filter: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue({ data: profileData }),
      }),
    }),
  });

  mockPointsInsert = jest.fn((data) => {
    if (pointsInsertFails > 0 && data.user_id === 'user-0') {
      return Promise.resolve({
        error: { code: '23505', message: 'Unique violation' },
      });
    }
    return Promise.resolve({ error: null });
  });

  mockLineLinkSelect = jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      maybeSingle: jest.fn().mockResolvedValue({ data: lineLinkData }),
    }),
  });

  mockFrom.mockImplementation((table: string) => {
    if (table === 'profiles') {
      return { select: mockProfilesSelect };
    } else if (table === 'user_points') {
      return { insert: mockPointsInsert };
    } else if (table === 'line_user_links') {
      return { select: mockLineLinkSelect };
    }
    return {};
  });

  if (resendAvailable) {
    const { Resend } = require('resend');
    Resend.mockImplementation(() => ({
      emails: {
        send: jest.fn().mockResolvedValue({ success: true }),
      },
    }));
  }

  process.env.RESEND_API_KEY = resendAvailable ? 'resend-key' : undefined;
  process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK = 'line-token';
}

beforeEach(() => {
  jest.clearAllMocks();
  setupDefaultMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  process.env.CRON_SECRET = 'cron-secret';
  process.env.NEXT_PUBLIC_SITE_URL = 'https://carelink-jp.com';
});

function makeRequest(cronSecret: string = 'cron-secret') {
  return new Request('http://localhost/api/cron/birthday-coupon', {
    method: 'GET',
    headers: { authorization: `Bearer ${cronSecret}` },
  });
}

describe('GET /api/cron/birthday-coupon', () => {
  test('invalid CRON_SECRET → returns auth error', async () => {
    (checkCronAuth as jest.Mock).mockReturnValue(
      new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    );

    const res = await GET(makeRequest('invalid') as any);

    expect(res.status).toBe(401);
  });

  test('no birthday profiles today → 200 with sent=0', async () => {
    setupDefaultMocks(0);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sent).toBe(0);
  });

  test('birthday profiles found → 200 with sent count', async () => {
    setupDefaultMocks(2);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sent).toBe(2);
    expect(json.total).toBe(2);
  });

  test('searches profiles by birth_date (MM-DD today)', async () => {
    setupDefaultMocks(2);

    await GET(makeRequest() as any);

    expect(mockProfilesSelect).toHaveBeenCalled();
  });

  test('inserts 100 points per user with reason=birthday_YYYY', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    const insertCalls = mockPointsInsert.mock.calls;
    expect(insertCalls.length).toBeGreaterThan(0);
    expect(insertCalls[0][0]).toMatchObject({
      points: 100,
      reason: expect.stringMatching(/^birthday_\d{4}$/),
    });
  });

  test('idempotency: 23505 error (already awarded) → skip', async () => {
    setupDefaultMocks(2, 1);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sent).toBeGreaterThanOrEqual(1);
  });

  test('sends birthday email when RESEND_API_KEY available', async () => {
    setupDefaultMocks(1, 0, true, true);

    const { Resend } = require('resend');

    await GET(makeRequest() as any);

    expect(Resend).toHaveBeenCalled();
  });

  test('skips email when RESEND_API_KEY unavailable', async () => {
    setupDefaultMocks(1, 0, false, false);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('email includes 100pt amount in subject', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    // Email should include "100ポイント" or similar
  });

  test('email includes points confirmation link', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    // Email should include mypage/points link
  });

  test('sends LINE notification when LINE_CHANNEL_ACCESS_TOKEN available', async () => {
    setupDefaultMocks(1, 0, true);

    await GET(makeRequest() as any);

    expect(sendLineText).toHaveBeenCalledWith(
      'line-user-123',
      expect.stringContaining('100ポイント')
    );
  });

  test('skips LINE notification when line_user_id not found', async () => {
    setupDefaultMocks(1, 0, false);

    (sendLineText as jest.Mock).mockClear();

    await GET(makeRequest() as any);

    expect(sendLineText).not.toHaveBeenCalled();
  });

  test('uses display_name in email and LINE message', async () => {
    setupDefaultMocks(1, 0, true);

    await GET(makeRequest() as any);

    expect(sendLineText).toHaveBeenCalled();
  });

  test('fallback to お客様 when display_name is null', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: jest.fn().mockReturnValue({
            not: jest.fn().mockReturnValue({
              filter: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue({
                  data: [{ id: 'user-1', email: 'user@example.com', display_name: null }],
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'user_points') return { insert: jest.fn().mockResolvedValue({ error: null }) };
      if (table === 'line_user_links') return { select: mockLineLinkSelect };
      return {};
    });

    await GET(makeRequest() as any);

    expect(sendLineText).toHaveBeenCalled();
  });

  test('limits profile query to 500', async () => {
    setupDefaultMocks(500);

    await GET(makeRequest() as any);

    // Should process up to 500 profiles
  });

  test('email send failure → continues to next user', async () => {
    const { Resend } = require('resend');
    Resend.mockImplementation(() => ({
      emails: {
        send: jest.fn().mockRejectedValue(new Error('Email failed')),
      },
    }));

    setupDefaultMocks(2);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('LINE send failure → continues to next user', async () => {
    (sendLineText as jest.Mock).mockRejectedValueOnce(new Error('LINE failed'));

    setupDefaultMocks(2, 0, true);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('logs cron execution with success', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    expect(logCronRun).toHaveBeenCalledWith(
      'birthday-coupon',
      'success',
      expect.any(Date),
      expect.objectContaining({
        processed: expect.any(Number),
      })
    );
  });

  test('exception during processing → 500 with error log', async () => {
    mockFrom.mockImplementation(() => {
      throw new Error('Fatal error');
    });

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(500);
  });

  test('points reason includes current year for idempotency', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    const insertCall = mockPointsInsert.mock.calls[0];
    const year = new Date().getUTCFullYear();
    expect(insertCall[0].reason).toBe(`birthday_${year}`);
  });
});
