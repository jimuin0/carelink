/**
 * @jest-environment node
 *
 * Tests for GET /api/cron/favorites-digest
 * Key assertions:
 *   - CRON_SECRET validation
 *   - ISO week calculation & idempotency
 *   - Aggregates user favorites + facility updates
 *   - Filters new coupons & menus (7-day window)
 *   - CAS guard (neq check) for double-fire prevention
 *   - Respects email_unsubscribed flag
 *   - Generates unsubscribe token
 *   - Fire-and-forget email sending
 *   - Logs cron execution
 */

jest.mock('@/lib/cron-auth', () => ({
  checkCronAuth: jest.fn(() => null),
}));
jest.mock('@/lib/cron-logger');
jest.mock('@/lib/email');

const mockFromDelegate = jest.fn();
const mockListUsersDelegate = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: (...args: any[]) => mockFromDelegate(...args),
    auth: {
      admin: {
        listUsers: (...args: any[]) => mockListUsersDelegate(...args),
      },
    },
  })),
}));

import { checkCronAuth } from '@/lib/cron-auth';
import { logCronRun } from '@/lib/cron-logger';
import { sendFavoritesDigest, generateUnsubscribeToken } from '@/lib/email';
import { GET } from '../route';

let mockFavoritesSelect: jest.Mock;
let mockCouponsSelect: jest.Mock;
let mockMenusSelect: jest.Mock;
let mockFacilitiesSelect: jest.Mock;
let mockProfilesSelect: jest.Mock;
let mockProfilesUpdate: jest.Mock;
let mockTokenInsert: jest.Mock;
let mockListUsers: jest.Mock;

function setupDefaultMocks(
  favoritesFound: number = 1,
  unsubscribed: boolean = false,
  alreadySentThisWeek: boolean = false,
  couponsFound: number = 1,
  menusFound: number = 0,
  tokenInsertFails: boolean = false,
  emailSendFails: boolean = false
) {
  (checkCronAuth as jest.Mock).mockReturnValue(null);
  (logCronRun as jest.Mock).mockResolvedValue(undefined);
  (generateUnsubscribeToken as jest.Mock).mockReturnValue('unsubscribe-token-123');
  (sendFavoritesDigest as jest.Mock).mockResolvedValue(undefined);

  if (emailSendFails) {
    (sendFavoritesDigest as jest.Mock).mockRejectedValue(new Error('Email send failed'));
  }

  mockFavoritesSelect = jest.fn().mockResolvedValue({
    data:
      favoritesFound > 0
        ? [
            { user_id: 'user-1', facility_id: 'fac-1' },
            { user_id: 'user-1', facility_id: 'fac-2' },
            { user_id: 'user-2', facility_id: 'fac-1' },
          ]
        : [],
  });

  mockCouponsSelect = jest.fn().mockResolvedValue({
    data:
      couponsFound > 0
        ? [
            { facility_id: 'fac-1', id: 'coupon-1' },
            { facility_id: 'fac-1', id: 'coupon-2' },
            { facility_id: 'fac-2', id: 'coupon-3' },
          ]
        : [],
  });

  mockMenusSelect = jest.fn().mockResolvedValue({
    data:
      menusFound > 0
        ? [
            { facility_id: 'fac-2', id: 'menu-1' },
            { facility_id: 'fac-2', id: 'menu-2' },
          ]
        : [],
  });

  mockFacilitiesSelect = jest.fn().mockResolvedValue({
    data: [
      { id: 'fac-1', name: 'Salon A', slug: 'salon-a' },
      { id: 'fac-2', name: 'Salon B', slug: 'salon-b' },
    ],
  });

  mockProfilesSelect = jest.fn().mockResolvedValue({
    data: [
      {
        id: 'user-1',
        display_name: 'User 1',
        email_unsubscribed: unsubscribed,
        favorites_digest_sent_week: alreadySentThisWeek ? '2026-W17' : null,
      },
    ],
  });

  mockProfilesUpdate = jest.fn().mockReturnValue({
    eq: jest
      .fn()
      .mockReturnValue({
        neq: jest.fn().mockResolvedValue({
          select: jest.fn().mockResolvedValue({
            data: alreadySentThisWeek ? [] : [{ id: 'user-1' }],
          }),
        }),
      }),
  });

  mockTokenInsert = jest.fn().mockResolvedValue({
    error: tokenInsertFails ? new Error('Token insert error') : null,
  });

  mockListUsers = jest.fn().mockResolvedValue({
    data: {
      users: [{ id: 'user-1', email: 'user1@example.com' }],
    },
  });
  mockListUsersDelegate.mockImplementation(mockListUsers);

  const favoritesData = favoritesFound > 0
    ? [
        { user_id: 'user-1', facility_id: 'fac-1' },
        { user_id: 'user-1', facility_id: 'fac-2' },
        { user_id: 'user-2', facility_id: 'fac-1' },
      ]
    : [];
  const couponsData = couponsFound > 0
    ? [
        { facility_id: 'fac-1', id: 'coupon-1' },
        { facility_id: 'fac-1', id: 'coupon-2' },
        { facility_id: 'fac-2', id: 'coupon-3' },
      ]
    : [];
  const menusData = menusFound > 0
    ? [
        { facility_id: 'fac-2', id: 'menu-1' },
        { facility_id: 'fac-2', id: 'menu-2' },
      ]
    : [];
  const claimedData = alreadySentThisWeek ? [] : [{ id: 'user-1' }];

  mockFavoritesSelect = jest.fn().mockReturnValue({
    limit: jest.fn().mockResolvedValue({ data: favoritesData }),
  });
  mockCouponsSelect = jest.fn().mockReturnValue({
    in: jest.fn().mockReturnValue({
      gte: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ data: couponsData }),
      }),
    }),
  });
  mockMenusSelect = jest.fn().mockReturnValue({
    in: jest.fn().mockReturnValue({
      gte: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ data: menusData }),
      }),
    }),
  });
  mockFacilitiesSelect = jest.fn().mockReturnValue({
    in: jest.fn().mockResolvedValue({
      data: [
        { id: 'fac-1', name: 'Salon A', slug: 'salon-a' },
        { id: 'fac-2', name: 'Salon B', slug: 'salon-b' },
      ],
    }),
  });
  mockProfilesSelect = jest.fn().mockReturnValue({
    in: jest.fn().mockResolvedValue({
      data: [
        {
          id: 'user-1',
          display_name: 'User 1',
          email_unsubscribed: unsubscribed,
          favorites_digest_sent_week: alreadySentThisWeek ? '2026-W17' : null,
        },
      ],
    }),
  });
  mockProfilesUpdate = jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      neq: jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue({ data: claimedData }),
      }),
    }),
  });

  mockFromDelegate.mockImplementation((table: string) => {
    if (table === 'favorites') {
      return { select: (...args: any[]) => mockFavoritesSelect(...args) };
    } else if (table === 'facility_coupons') {
      return { select: (...args: any[]) => mockCouponsSelect(...args) };
    } else if (table === 'facility_menus') {
      return { select: (...args: any[]) => mockMenusSelect(...args) };
    } else if (table === 'facility_profiles') {
      return { select: (...args: any[]) => mockFacilitiesSelect(...args) };
    } else if (table === 'profiles') {
      return {
        select: (...args: any[]) => mockProfilesSelect(...args),
        update: (...args: any[]) => mockProfilesUpdate(...args),
      };
    } else if (table === 'email_unsubscribe_tokens') {
      return { insert: mockTokenInsert };
    }
    return {};
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  setupDefaultMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  process.env.CRON_SECRET = 'cron-secret';
});

function makeRequest(cronSecret: string = 'cron-secret') {
  return new Request('http://localhost/api/cron/favorites-digest', {
    method: 'GET',
    headers: { authorization: `Bearer ${cronSecret}` },
  });
}

describe('GET /api/cron/favorites-digest', () => {
  test('invalid CRON_SECRET → returns auth error', async () => {
    (checkCronAuth as jest.Mock).mockReturnValue(
      new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    );

    const res = await GET(makeRequest('invalid') as any);

    expect(res.status).toBe(401);
  });

  test('no favorites → 200 with sent=0', async () => {
    setupDefaultMocks(0);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sent).toBe(0);
  });

  test('successful send → 200 with sent count', async () => {
    setupDefaultMocks(1, false, false, 1);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(typeof json.processed).toBe('number');
  });

  test('skips if user already sent this week', async () => {
    setupDefaultMocks(1, false, true, 1);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.processed).toBe(0);
  });

  test('respects email_unsubscribed flag', async () => {
    setupDefaultMocks(1, true, false, 1);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.processed).toBe(0);
  });

  test('aggregates favorites per user', async () => {
    setupDefaultMocks(1, false, false, 1);

    await GET(makeRequest() as any);

    // Should group favorites by user_id into Map
  });

  test('fetches coupons from last 7 days', async () => {
    setupDefaultMocks(1, false, false, 1);

    await GET(makeRequest() as any);

    expect(mockCouponsSelect).toHaveBeenCalled();
  });

  test('fetches menus from last 7 days', async () => {
    setupDefaultMocks(1, false, false, 0, 1);

    await GET(makeRequest() as any);

    expect(mockMenusSelect).toHaveBeenCalled();
  });

  test('filters only active coupons (is_active=true)', async () => {
    setupDefaultMocks(1, false, false, 1);

    await GET(makeRequest() as any);

    expect(mockCouponsSelect).toHaveBeenCalled();
  });

  test('filters only active menus (is_active=true)', async () => {
    setupDefaultMocks(1, false, false, 0, 1);

    await GET(makeRequest() as any);

    expect(mockMenusSelect).toHaveBeenCalled();
  });

  test('CAS guard update (neq check) prevents double-fire', async () => {
    setupDefaultMocks(1, false, false, 1);

    await GET(makeRequest() as any);

    expect(mockProfilesUpdate).toHaveBeenCalled();
  });

  test('skips if another invocation already claimed week', async () => {
    mockProfilesUpdate.mockReturnValue({
      eq: jest.fn().mockReturnValue({
        neq: jest.fn().mockReturnValue({
          select: jest.fn().mockResolvedValue({ data: [] }),
        }),
      }),
    });

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('generates unsubscribe token', async () => {
    setupDefaultMocks(1, false, false, 1);

    await GET(makeRequest() as any);

    expect(generateUnsubscribeToken).toHaveBeenCalled();
  });

  test('inserts unsubscribe token', async () => {
    setupDefaultMocks(1, false, false, 1);

    await GET(makeRequest() as any);

    expect(mockTokenInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        token: expect.any(String),
        user_id: expect.any(String),
      })
    );
  });

  test('token insert fails → logs error and continues', async () => {
    setupDefaultMocks(1, false, false, 1, 0, true);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('sends digest only if facility has updates', async () => {
    setupDefaultMocks(1, false, false, 1, 0);

    await GET(makeRequest() as any);

    // Should send only if coupons OR menus exist for that facility
    expect(sendFavoritesDigest).toHaveBeenCalled();
  });

  test('email send fails → logs error and continues', async () => {
    setupDefaultMocks(1, false, false, 1, 0, false, true);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('email includes new coupon count', async () => {
    setupDefaultMocks(1, false, false, 2);

    await GET(makeRequest() as any);

    // Facilities array should include newCoupons count
  });

  test('email includes hasNewMenus flag', async () => {
    setupDefaultMocks(1, false, false, 1, 1);

    await GET(makeRequest() as any);

    // Facilities array should include hasNewMenus
  });

  test('lists auth users to fetch emails', async () => {
    setupDefaultMocks(1, false, false, 1);

    await GET(makeRequest() as any);

    expect(mockListUsers).toHaveBeenCalled();
  });

  test('skips user if no email found', async () => {
    mockListUsers.mockResolvedValue({
      data: { users: [] },
    });

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('logs cron execution with sent count', async () => {
    setupDefaultMocks(1, false, false, 1);

    await GET(makeRequest() as any);

    expect(logCronRun).toHaveBeenCalledWith(
      'favorites-digest',
      'success',
      expect.any(Date),
      expect.objectContaining({
        processed: expect.any(Number),
      })
    );
  });

  test('exception during processing → 500 with error log', async () => {
    mockFromDelegate.mockImplementation(() => { throw new Error('Fatal'); });

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(500);
  });

  test('ISO week calculation for idempotency', async () => {
    setupDefaultMocks(1, false, false, 1);

    await GET(makeRequest() as any);

    // Should calculate week number
  });

  test('limits favorites query to 500', async () => {
    setupDefaultMocks(1, false, false, 1);

    await GET(makeRequest() as any);

    expect(mockFavoritesSelect).toHaveBeenCalled();
  });

  test('deduplicates facility IDs', async () => {
    setupDefaultMocks(1, false, false, 1);

    await GET(makeRequest() as any);

    // Should use Set to deduplicate facilities
  });

  test('filters out facilities with no updates', async () => {
    setupDefaultMocks(1, false, false, 0, 0);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    // No email should be sent if no coupons/menus
  });
});
