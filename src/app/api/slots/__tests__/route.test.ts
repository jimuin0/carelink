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
  checkRateLimit: jest.fn(() => false),
}));
jest.mock('@/lib/supabase-server');

import { checkRateLimit } from '@/lib/rate-limit';
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
  createServerSupabaseClient.mockReturnValue({
    rpc: mockRpc,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
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
    (checkRateLimit as jest.Mock).mockReturnValue(true);

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
    (checkRateLimit as jest.Mock).mockClear();

    GET(makeRequest(VALID_UUID, VALID_UUID, VALID_DATE, '60', '192.168.1.1') as any);

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
    expect(call[2]).toBe(30);
    expect(call[3]).toBe(60_000);
    expect(call[4]).toBe('slots');
  });

  test('extracts last (trusted) IP from x-forwarded-for', () => {
    (checkRateLimit as jest.Mock).mockClear();

    GET(makeRequest(VALID_UUID, VALID_UUID, VALID_DATE, '60', '10.0.0.1, 192.168.1.1') as any);

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
  });

  test('uses unknown IP when x-forwarded-for missing', () => {
    (checkRateLimit as jest.Mock).mockClear();

    const req = new Request(`http://localhost/api/slots?facilityId=${VALID_UUID}&staffId=${VALID_UUID}&date=${VALID_DATE}`, {
      method: 'GET',
    });

    GET(req as any);

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('unknown');
  });

  test('RPC error → 500（空き枠なしに偽装せず失敗を顕在化・Sentry記録）', async () => {
    // get_available_slots のエラーを握り潰すと予約導線が無監視で壊れる（過去の
    // booking_buffer_minutes ドリフト事例）。error を捕捉して 500 を返す。
    const { createServerSupabaseClient } = require('@/lib/supabase-server');
    createServerSupabaseClient.mockReturnValue({
      rpc: jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      }),
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.slots).toEqual([]);
  });

  test('RPC が data=null・error=null → 200・空配列（data ?? [] の null 分岐）', async () => {
    const { createServerSupabaseClient } = require('@/lib/supabase-server');
    createServerSupabaseClient.mockReturnValue({
      rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
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
});

// AV-3: 当日は既に過ぎた時刻の枠を除外する（過去時刻を予約可能に見せない）
test('AV-3: 当日は現在JST時刻より前の枠を除外', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-07-03T05:00:00Z')); // JST 14:00
  try {
    const { todayJst } = require('@/lib/admin-date');
    const today = todayJst();
    mockRpc.mockResolvedValue({
      data: [
        { slot_start: '10:00:00', slot_end: '11:00:00' }, // 過去 → 除外
        { slot_start: '18:00:00', slot_end: '19:00:00' }, // 未来 → 残る
      ],
      error: null,
    });
    const res = await GET(makeRequest(VALID_UUID, VALID_UUID, today) as any);
    const json = await res.json();
    expect(json.slots).toHaveLength(1);
    expect(json.slots[0].slot_start).toBe('18:00:00');
  } finally {
    jest.useRealTimers();
  }
});
