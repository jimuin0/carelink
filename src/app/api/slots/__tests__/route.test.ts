/**
 * @jest-environment node
 *
 * Tests for GET /api/slots
 * Key assertions:
 *   - Rate limiting (30 req/min per IP)
 *   - Query param validation (facilityId, staffId, date UUIDs)
 *   - Date format validation (YYYY-MM-DD)
 *   - Duration clamping (15-480 minutes)
 *   - RPC get_available_slots call
 *   - Graceful failures with empty slots
 */

jest.mock('@/lib/rate-limit', () => ({
  inMemoryRateLimit: jest.fn(() => false),
}));
jest.mock('@/lib/supabase-server');

import { inMemoryRateLimit } from '@/lib/rate-limit';
import { GET } from '../route';

let mockRpc: jest.Mock;

function setupDefaultMocks(hasSlots: boolean = true) {
  mockRpc = jest.fn().mockResolvedValue({
    data: hasSlots
      ? [
          { start_time: '09:00', end_time: '10:00', available: true },
          { start_time: '10:00', end_time: '11:00', available: true },
          { start_time: '14:00', end_time: '15:00', available: true },
        ]
      : [],
  });

  const { createServerSupabaseClient } = require('@/lib/supabase-server');
  createServerSupabaseClient.mockReturnValue({ rpc: mockRpc, from: makeFrom() });
}

// 各テストで上書き可能な停止枠/上限/予約数/施設status（既定: 停止なし・上限なし・予約0・published）
let suspensionsData: { start_time: string; end_time: string }[] = [];
let capacityData: { max_bookings: number } | null = null;
let bookedCount: number | null = 0;
let facilityStatus: string | null = 'published';

// table 名に応じてチェーンを返す共通モック（facility_profiles/suspensions/daily_capacity/bookings）
function makeFrom() {
  return jest.fn((table: string) => {
    if (table === 'facility_profiles') {
      // #03 施設status ゲート: select('status').eq('id').maybeSingle()
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: facilityStatus === null ? null : { status: facilityStatus } }) }) }) };
    }
    if (table === 'facility_booking_suspensions') {
      return { select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: suspensionsData }) }) }) };
    }
    if (table === 'facility_daily_capacity') {
      return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: capacityData }) }) }) }) };
    }
    // bookings: select('id',{count}).eq().eq().not() で件数を返す
    return { select: () => ({ eq: () => ({ eq: () => ({ not: () => Promise.resolve({ count: bookedCount }) }) }) }) };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  suspensionsData = [];
  capacityData = null;
  bookedCount = 0;
  facilityStatus = 'published';
  setupDefaultMocks();
});

const VALID_UUID = '11111111-1111-1111-1111-111111111111';
const VALID_DATE = '2026-05-15';

function makeRequest(facilityId: string = VALID_UUID, staffId: string = VALID_UUID, date: string = VALID_DATE, duration: string = '60', ip = '192.168.1.1') {
  return new Request(
    `http://localhost/api/slots?facilityId=${facilityId}&staffId=${staffId}&date=${date}&duration=${duration}`,
    {
      method: 'GET',
      headers: { 'x-forwarded-for': ip },
    }
  );
}

describe('GET /api/slots', () => {
  test('rate limiting → 429', async () => {
    (inMemoryRateLimit as jest.Mock).mockReturnValue(true);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(429);
  });

  test('valid request → 200 with slots', async () => {
    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.slots)).toBe(true);
    expect(json.slots.length).toBeGreaterThan(0);
  });

  test('missing facilityId → 200 with empty slots', async () => {
    const res = await GET(
      new Request('http://localhost/api/slots?staffId=11111111-1111-1111-1111-111111111111&date=2026-05-15', {
        method: 'GET',
      }) as any
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.slots).toEqual([]);
  });

  test('missing staffId → 200 with empty slots', async () => {
    const res = await GET(
      new Request('http://localhost/api/slots?facilityId=11111111-1111-1111-1111-111111111111&date=2026-05-15', {
        method: 'GET',
      }) as any
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.slots).toEqual([]);
  });

  test('missing date → 200 with empty slots', async () => {
    const res = await GET(
      new Request('http://localhost/api/slots?facilityId=11111111-1111-1111-1111-111111111111&staffId=11111111-1111-1111-1111-111111111111', {
        method: 'GET',
      }) as any
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.slots).toEqual([]);
  });

  test('invalid facilityId UUID → 200 with empty slots', async () => {
    const res = await GET(makeRequest('not-uuid') as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.slots).toEqual([]);
  });

  test('invalid staffId UUID → 200 with empty slots', async () => {
    const res = await GET(makeRequest(VALID_UUID, 'not-uuid') as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.slots).toEqual([]);
  });

  test('invalid date format (missing hyphen) → 200 with empty slots', async () => {
    const res = await GET(makeRequest(VALID_UUID, VALID_UUID, '20260515') as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.slots).toEqual([]);
  });

  test('invalid date format (invalid month) → 200 (route only validates format, not semantics)', async () => {
    // Route regex /^\d{4}-\d{2}-\d{2}$/ passes month=13; RPC handles semantic validation
    const res = await GET(makeRequest(VALID_UUID, VALID_UUID, '2026-13-15') as any);
    expect(res.status).toBe(200);
  });

  test('duration < 15 → clamped to 15', async () => {
    await GET(makeRequest(VALID_UUID, VALID_UUID, VALID_DATE, '5') as any);

    const call = mockRpc.mock.calls[0];
    expect(call[1].p_duration_minutes).toBe(15);
  });

  test('duration > 480 → clamped to 480', async () => {
    await GET(makeRequest(VALID_UUID, VALID_UUID, VALID_DATE, '600') as any);

    const call = mockRpc.mock.calls[0];
    expect(call[1].p_duration_minutes).toBe(480);
  });

  test('duration within bounds → passed as-is', async () => {
    await GET(makeRequest(VALID_UUID, VALID_UUID, VALID_DATE, '90') as any);

    const call = mockRpc.mock.calls[0];
    expect(call[1].p_duration_minutes).toBe(90);
  });

  test('invalid duration (non-numeric) → defaults to 60', async () => {
    await GET(makeRequest(VALID_UUID, VALID_UUID, VALID_DATE, 'abc') as any);

    const call = mockRpc.mock.calls[0];
    expect(call[1].p_duration_minutes).toBe(60);
  });

  test('missing duration → defaults to 60', async () => {
    const res = await GET(
      new Request(`http://localhost/api/slots?facilityId=${VALID_UUID}&staffId=${VALID_UUID}&date=${VALID_DATE}`, {
        method: 'GET',
      }) as any
    );

    const call = mockRpc.mock.calls[0];
    expect(call[1].p_duration_minutes).toBe(60);
  });

  test('calls RPC with correct parameters', async () => {
    await GET(makeRequest(VALID_UUID, VALID_UUID, VALID_DATE, '75') as any);

    const call = mockRpc.mock.calls[0];
    expect(call[0]).toBe('get_available_slots');
    expect(call[1]).toEqual({
      p_facility_id: VALID_UUID,
      p_staff_id: VALID_UUID,
      p_date: VALID_DATE,
      p_duration_minutes: 75,
    });
  });

  test('no slots available → 200 with empty array', async () => {
    setupDefaultMocks(false);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.slots).toEqual([]);
  });

  test('slots include start_time, end_time, available', async () => {
    const res = await GET(makeRequest() as any);

    const json = await res.json();
    expect(json.slots.length).toBeGreaterThan(0);
    json.slots.forEach((slot: any) => {
      expect(slot.start_time).toBeDefined();
      expect(slot.end_time).toBeDefined();
      expect(slot.available).toBeDefined();
    });
  });

  test('rate limit params (30 req/min per IP)', () => {
    (inMemoryRateLimit as jest.Mock).mockClear();

    GET(makeRequest(VALID_UUID, VALID_UUID, VALID_DATE, '60', '192.168.1.1') as any);

    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('192.168.1.1');
    expect(call[1]).toBe(30);
    expect(call[2]).toBe(60_000);
    expect(call[3]).toBe('slots');
  });

  test('extracts first IP from x-forwarded-for', () => {
    (inMemoryRateLimit as jest.Mock).mockClear();

    GET(makeRequest(VALID_UUID, VALID_UUID, VALID_DATE, '60', '10.0.0.1, 192.168.1.1') as any);

    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('10.0.0.1');
  });

  test('uses unknown IP when x-forwarded-for missing', () => {
    (inMemoryRateLimit as jest.Mock).mockClear();

    const req = new Request(`http://localhost/api/slots?facilityId=${VALID_UUID}&staffId=${VALID_UUID}&date=${VALID_DATE}`, {
      method: 'GET',
    });

    GET(req as any);

    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('unknown');
  });

  test('RPC error → 200 with empty slots (route ignores error field, uses data ?? [])', async () => {
    // Route destructures only { data }, ignoring error; returns slots: [] when data is null
    const { createServerSupabaseClient } = require('@/lib/supabase-server');
    createServerSupabaseClient.mockReturnValue({
      rpc: jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      }),
      from: makeFrom(),
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.slots).toEqual([]);
  });

  test('exception during processing → 500', async () => {
    const { createServerSupabaseClient } = require('@/lib/supabase-server');
    createServerSupabaseClient.mockImplementation(() => {
      throw new Error('Connection error');
    });

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(500);
  });

  test('URL parsing error → 500', async () => {
    // Invalid URL should trigger error handling
    const malformedReq = {
      headers: new Map([['x-forwarded-for', '192.168.1.1']]),
      get: function(key: string) {
        return this.headers.get(key);
      },
      url: 'not-a-url',
    };

    const res = await GET(malformedReq as any);

    expect(res.status).toBe(500);
  });

  test('停止時間帯に重なるスロットは除外される(#03/#09/#10)', async () => {
    const { createServerSupabaseClient } = require('@/lib/supabase-server');
    suspensionsData = [{ start_time: '12:00', end_time: '13:00' }]; // 12:00-13:00 停止
    createServerSupabaseClient.mockReturnValue({
      rpc: jest.fn().mockResolvedValue({ data: [
        { slot_start: '09:00', slot_end: '10:00' },
        { slot_start: '12:00', slot_end: '13:00' }, // 停止と重なる → 除外
        { slot_start: '15:00', slot_end: '16:00' },
      ] }),
      from: makeFrom(),
    });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.slots.map((s: { slot_start: string }) => s.slot_start)).toEqual(['09:00', '15:00']);
  });

  test('受付上限に達した日はスロット0(#05/#46)', async () => {
    const { createServerSupabaseClient } = require('@/lib/supabase-server');
    capacityData = { max_bookings: 3 };
    bookedCount = 3; // 上限3 に対し既に3件 → 満枠
    createServerSupabaseClient.mockReturnValue({
      rpc: jest.fn().mockResolvedValue({ data: [{ slot_start: '09:00', slot_end: '10:00' }] }),
      from: makeFrom(),
    });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    expect((await res.json()).slots).toEqual([]);
  });

  test('上限0かつ予約数null → スロット0（count ?? 0 の null 経路）', async () => {
    const { createServerSupabaseClient } = require('@/lib/supabase-server');
    capacityData = { max_bookings: 0 };
    bookedCount = null; // count が null → (null ?? 0)=0 >= 0 で満枠
    createServerSupabaseClient.mockReturnValue({
      rpc: jest.fn().mockResolvedValue({ data: [{ slot_start: '09:00', slot_end: '10:00' }] }),
      from: makeFrom(),
    });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    expect((await res.json()).slots).toEqual([]);
  });

  test('受付上限未満の日はスロット維持(#05/#46)', async () => {
    const { createServerSupabaseClient } = require('@/lib/supabase-server');
    capacityData = { max_bookings: 5 };
    bookedCount = 2; // 上限5 に対し2件 → 受付継続
    createServerSupabaseClient.mockReturnValue({
      rpc: jest.fn().mockResolvedValue({ data: [{ slot_start: '09:00', slot_end: '10:00' }] }),
      from: makeFrom(),
    });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    expect((await res.json()).slots).toHaveLength(1);
  });

  test('非公開施設(suspended)はスロット0(#03 施設statusゲート)', async () => {
    facilityStatus = 'suspended';
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    expect((await res.json()).slots).toEqual([]);
  });

  test('施設行が取得不可(RLSで不可視/未存在)もスロット0(#03)', async () => {
    facilityStatus = null;
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    expect((await res.json()).slots).toEqual([]);
  });
});
