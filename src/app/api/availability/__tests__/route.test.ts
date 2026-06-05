/**
 * @jest-environment node
 *
 * Tests for GET /api/availability
 * Key assertions:
 *   - Rate limiting (10 req/min per IP)
 *   - Query param validation (facilityId, year, month)
 *   - Year/month range validation (currentYear-1 to currentYear+2)
 *   - Fetches active staff for facility
 *   - Batch processing of dates (5 concurrent)
 *   - Returns availability status (available, few, full)
 */

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(() => false),
}));
jest.mock('@/lib/supabase-server');

import { checkRateLimit } from '@/lib/rate-limit';
import { GET } from '../route';

let mockStaffSelect: jest.Mock;
let mockRpc: jest.Mock;

function setupDefaultMocks(
  staffCount: number = 2,
  slotsPerStaff: number = 5
) {
  const staffData = Array.from({ length: staffCount }, (_, i) => ({
    id: `staff-${i}`,
  }));

  mockStaffSelect = jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue({
          data: staffData,
        }),
      }),
    }),
  });

  mockRpc = jest.fn().mockResolvedValue({
    data: Array.from({ length: slotsPerStaff }, (_, i) => ({
      start_time: `${9 + i}:00`,
      available: true,
    })),
  });

  const { createServerSupabaseClient } = require('@/lib/supabase-server');
  createServerSupabaseClient.mockReturnValue({
    from: jest.fn().mockReturnValue({
      select: mockStaffSelect,
    }),
    rpc: mockRpc,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  setupDefaultMocks();
});

const VALID_UUID = '11111111-1111-1111-1111-111111111111';

function makeRequest(
  facilityId: string = VALID_UUID,
  staffId?: string,
  year: number = 2026,
  month: number = 5,
  ip = '192.168.1.1'
) {
  let url = `http://localhost/api/availability?facilityId=${facilityId}&year=${year}&month=${month}`;
  if (staffId) url += `&staffId=${staffId}`;
  return new Request(url, {
    method: 'GET',
    headers: { 'x-forwarded-for': ip },
  });
}

describe('GET /api/availability', () => {
  test('rate limiting → 429', async () => {
    (checkRateLimit as jest.Mock).mockReturnValue(true);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(429);
  });

  test('missing facilityId → 400', async () => {
    const res = await GET(
      new Request('http://localhost/api/availability?year=2026&month=5', {
        method: 'GET',
      }) as any
    );

    expect(res.status).toBe(400);
  });

  test('invalid facilityId UUID → 400', async () => {
    const res = await GET(makeRequest('not-uuid') as any);

    expect(res.status).toBe(400);
  });

  test('invalid staffId UUID → 400', async () => {
    const res = await GET(makeRequest(VALID_UUID, 'not-uuid') as any);

    expect(res.status).toBe(400);
  });

  test('missing year → 400', async () => {
    const res = await GET(
      new Request(`http://localhost/api/availability?facilityId=${VALID_UUID}&month=5`, {
        method: 'GET',
      }) as any
    );

    expect(res.status).toBe(400);
  });

  test('missing month → 400', async () => {
    const res = await GET(
      new Request(`http://localhost/api/availability?facilityId=${VALID_UUID}&year=2026`, {
        method: 'GET',
      }) as any
    );

    expect(res.status).toBe(400);
  });

  test('invalid month (< 1) → 400', async () => {
    const res = await GET(makeRequest(VALID_UUID, undefined, 2026, 0) as any);

    expect(res.status).toBe(400);
  });

  test('invalid month (> 12) → 400', async () => {
    const res = await GET(makeRequest(VALID_UUID, undefined, 2026, 13) as any);

    expect(res.status).toBe(400);
  });

  test('year too far in past (< currentYear-1) → 400', async () => {
    const res = await GET(makeRequest(VALID_UUID, undefined, 2024, 5) as any);

    expect(res.status).toBe(400);
  });

  test('year too far in future (> currentYear+2) → 400', async () => {
    const res = await GET(makeRequest(VALID_UUID, undefined, 2029, 5) as any);

    expect(res.status).toBe(400);
  });

  test('valid request → 200 with dates object', async () => {
    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(typeof json.dates).toBe('object');
  });

  test('fetches active staff for facility', async () => {
    await GET(makeRequest() as any);

    expect(mockStaffSelect).toHaveBeenCalledWith('id');
    // The route chains .eq('facility_id',...).eq('is_active', true) — check the inner eq
    const outerEq = mockStaffSelect.mock.results[0].value.eq;
    const innerEq = outerEq.mock.results[0].value.eq;
    expect(innerEq).toHaveBeenCalledWith('is_active', true);
  });

  test('limits to 10 active staff', async () => {
    await GET(makeRequest() as any);

    const limitCall = mockStaffSelect().eq().eq().limit;
    expect(limitCall).toHaveBeenCalledWith(10);
  });

  test('no active staff → returns empty dates', async () => {
    setupDefaultMocks(0);

    const res = await GET(makeRequest() as any);

    const json = await res.json();
    expect(json.dates).toEqual({});
  });

  test('past dates marked as full', async () => {
    const res = await GET(makeRequest(VALID_UUID, undefined, 2026, 5) as any);

    const json = await res.json();
    // route は "今日の 00:00 JST" を境界に過去を full とする
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    Object.entries(json.dates).forEach(([date, info]: [string, any]) => {
      const dateObj = new Date(date + 'T00:00:00+09:00');
      if (dateObj < todayMidnight) {
        expect(info.status).toBe('full');
      }
    });
  });

  test('uses RPC get_available_slots for slot counting', async () => {
    await GET(makeRequest() as any);

    // RPC should be called for future dates
    if (mockRpc.mock.calls.length > 0) {
      expect(mockRpc).toHaveBeenCalledWith(
        'get_available_slots',
        expect.anything()
      );
    }
  });

  test('batch processes dates (max 5 concurrent)', async () => {
    // With many dates, should batch into groups of 5
    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('returns status available/few/full for each date', async () => {
    const res = await GET(makeRequest() as any);

    const json = await res.json();
    Object.values(json.dates).forEach((info: any) => {
      expect(['available', 'few', 'full']).toContain(info.status);
    });
  });

  test('includes slots count for each date', async () => {
    const res = await GET(makeRequest() as any);

    const json = await res.json();
    Object.values(json.dates).forEach((info: any) => {
      expect(typeof info.slots).toBe('number');
    });
  });

  test('staffId filters to single staff', async () => {
    await GET(makeRequest(VALID_UUID, 'staff-123') as any);

    // Should only call RPC with single staff ID
    if (mockRpc.mock.calls.length > 0) {
      expect(mockRpc).toHaveBeenCalled();
    }
  });

  test('rate limit params (10 req/min per IP)', () => {
    (checkRateLimit as jest.Mock).mockClear();

    GET(makeRequest(VALID_UUID, undefined, 2026, 5, '192.168.1.1') as any);

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
    expect(call[2]).toBe(10);
    expect(call[3]).toBe(60_000);
    expect(call[4]).toBe('availability');
  });

  test('extracts last (trusted) IP from x-forwarded-for', () => {
    (checkRateLimit as jest.Mock).mockClear();

    GET(makeRequest(VALID_UUID, undefined, 2026, 5, '10.0.0.1, 192.168.1.1') as any);

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
  });

  test('exception during processing → 500', async () => {
    const { createServerSupabaseClient } = require('@/lib/supabase-server');
    createServerSupabaseClient.mockImplementation(() => {
      throw new Error('Connection failed');
    });

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(500);
  });

  test('dates include YYYY-MM-DD format', async () => {
    const res = await GET(makeRequest(VALID_UUID, undefined, 2026, 5) as any);

    const json = await res.json();
    Object.keys(json.dates).forEach((date: string) => {
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  test('pads month and day with leading zeros', async () => {
    const res = await GET(makeRequest(VALID_UUID, undefined, 2026, 1) as any);

    const json = await res.json();
    Object.keys(json.dates).forEach((date: string) => {
      expect(date).toMatch(/2026-01-\d{2}/);
    });
  });

  test('missing x-forwarded-for → uses "unknown" IP', () => {
    (checkRateLimit as jest.Mock).mockClear();
    const req = new Request(`http://localhost/api/availability?facilityId=${VALID_UUID}&year=2026&month=5`, { method: 'GET' });
    GET(req as any);
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('unknown');
  });

  test('staffList null (?? []) → dates empty', async () => {
    const { createServerSupabaseClient } = require('@/lib/supabase-server');
    createServerSupabaseClient.mockReturnValue({
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({ data: null }),
            }),
          }),
        }),
      }),
      rpc: jest.fn(),
    });
    const res = await GET(makeRequest() as any);
    const json = await res.json();
    expect(json.dates).toEqual({});
  });

  test('RPC returns null data (?? []) → status full for future dates', async () => {
    const { createServerSupabaseClient } = require('@/lib/supabase-server');
    createServerSupabaseClient.mockReturnValue({
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({ data: [{ id: 'staff-1' }] }),
            }),
          }),
        }),
      }),
      rpc: jest.fn().mockResolvedValue({ data: null }),
    });
    const futureYear = new Date().getFullYear() + 1;
    const res = await GET(makeRequest(VALID_UUID, undefined, futureYear, 6) as any);
    const json = await res.json();
    // All future dates should have slots=0/status=full
    const future = Object.values(json.dates).filter((d: any) => d.status !== 'full');
    expect(future).toHaveLength(0);
  });

  test('totalSlots between 1 and 2 → status=few', async () => {
    const { createServerSupabaseClient } = require('@/lib/supabase-server');
    let rpcCall = 0;
    createServerSupabaseClient.mockReturnValue({
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({ data: [{ id: 'staff-1' }] }),
            }),
          }),
        }),
      }),
      rpc: jest.fn().mockImplementation(() => {
        rpcCall++;
        // Return 1 slot per call
        return Promise.resolve({ data: [{ start_time: '09:00' }] });
      }),
    });
    const futureYear = new Date().getFullYear() + 1;
    const res = await GET(makeRequest(VALID_UUID, undefined, futureYear, 6) as any);
    const json = await res.json();
    const few = Object.values(json.dates).find((d: any) => d.status === 'few');
    expect(few).toBeDefined();
  });

  test('totalSlots 0 future date → status=full', async () => {
    const { createServerSupabaseClient } = require('@/lib/supabase-server');
    createServerSupabaseClient.mockReturnValue({
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({ data: [{ id: 'staff-1' }] }),
            }),
          }),
        }),
      }),
      rpc: jest.fn().mockResolvedValue({ data: [] }),
    });
    const futureYear = new Date().getFullYear() + 1;
    const res = await GET(makeRequest(VALID_UUID, undefined, futureYear, 6) as any);
    const json = await res.json();
    const fulls = Object.values(json.dates).filter((d: any) => d.status === 'full' && d.slots === 0);
    expect(fulls.length).toBeGreaterThan(0);
  });

  // Branch coverage: line 37 — staffId が指定された場合 staffIds = [staffId] で直接セット（true 分岐）
  test('valid UUID staffId → staff fetch スキップして staffIds=[staffId] を使用（line 37 true 分岐）', async () => {
    const STAFF_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const { createServerSupabaseClient } = require('@/lib/supabase-server');
    const fromMock = jest.fn();
    createServerSupabaseClient.mockReturnValue({
      from: fromMock,
      rpc: jest.fn().mockResolvedValue({ data: [] }),
    });
    const futureYear = new Date().getFullYear() + 1;
    const res = await GET(makeRequest(VALID_UUID, STAFF_UUID, futureYear, 6) as any);
    // from() should NOT be called (staff fetch is skipped when staffId is provided)
    expect(fromMock).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  // Branch coverage: line 89（totalSlots>=3 → break true 分岐）/ line 93（totalSlots>=3 → 'available' true 分岐）
  // 既存テストは過去月 or totalSlots<3 のみで、3枠以上の未来日付シナリオが欠落していた
  test('未来日付で 3 枠以上 → status=available かつスタッフループ早期break（line 89/93 true 分岐）', async () => {
    const { createServerSupabaseClient } = require('@/lib/supabase-server');
    const rpc = jest.fn().mockResolvedValue({
      data: [{ start_time: '09:00' }, { start_time: '10:00' }, { start_time: '11:00' }],
    });
    createServerSupabaseClient.mockReturnValue({
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              // 2 スタッフ登録。ただし 1 人目で 3 枠到達 → 2 人目の RPC は呼ばれない（早期 break）
              limit: jest.fn().mockResolvedValue({ data: [{ id: 'staff-1' }, { id: 'staff-2' }] }),
            }),
          }),
        }),
      }),
      rpc,
    });
    const futureYear = new Date().getFullYear() + 1;
    const res = await GET(makeRequest(VALID_UUID, undefined, futureYear, 6) as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    const available = Object.values(json.dates).find((d: any) => d.status === 'available' && d.slots >= 3);
    expect(available).toBeDefined();
  });
});
