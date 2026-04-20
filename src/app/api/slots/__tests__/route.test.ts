/**
 * @jest-environment node
 *
 * Tests for GET /api/slots
 * Key assertions:
 *   - Rate limiting → 429
 *   - Missing params → 200 with empty slots
 *   - Invalid UUID → 200 with empty slots
 *   - Invalid date format → 200 with empty slots
 *   - Duration clamped [15, 480]
 *   - Valid request → calls RPC with correct params
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }));
jest.mock('@/lib/supabase-server');

const { inMemoryRateLimit } = require('@/lib/rate-limit');

let mockRpc: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);

  mockRpc = jest.fn().mockResolvedValue({ data: [] });

  const { createServerSupabaseClient } = require('@/lib/supabase-server');
  createServerSupabaseClient.mockReturnValue({
    rpc: mockRpc,
  });
});

function makeRequest(query: string) {
  return new Request(`http://localhost/api/slots${query}`, {
    headers: { 'x-forwarded-for': '192.168.1.1' },
  });
}

const FACILITY_UUID = '11111111-1111-1111-1111-111111111111';
const STAFF_UUID = '22222222-2222-2222-2222-222222222222';
const VALID_DATE = '2026-05-01';

describe('GET /api/slots', () => {
  test('rate limiting → 429', async () => {
    (inMemoryRateLimit as jest.Mock).mockReturnValue(true);

    const { GET } = await import('../route');
    const res = await GET(makeRequest(
      `?facilityId=${FACILITY_UUID}&staffId=${STAFF_UUID}&date=${VALID_DATE}`
    ));

    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toContain('リクエストが多すぎます');
    expect(json.slots).toEqual([]);
  });

  test('missing facilityId → empty slots', async () => {
    const { GET } = await import('../route');
    const res = await GET(makeRequest(
      `?staffId=${STAFF_UUID}&date=${VALID_DATE}`
    ));

    const json = await res.json();
    expect(json.slots).toEqual([]);
  });

  test('missing staffId → empty slots', async () => {
    const { GET } = await import('../route');
    const res = await GET(makeRequest(
      `?facilityId=${FACILITY_UUID}&date=${VALID_DATE}`
    ));

    const json = await res.json();
    expect(json.slots).toEqual([]);
  });

  test('missing date → empty slots', async () => {
    const { GET } = await import('../route');
    const res = await GET(makeRequest(
      `?facilityId=${FACILITY_UUID}&staffId=${STAFF_UUID}`
    ));

    const json = await res.json();
    expect(json.slots).toEqual([]);
  });

  test('invalid facilityId UUID → empty slots', async () => {
    const { GET } = await import('../route');
    const res = await GET(makeRequest(
      `?facilityId=not-a-uuid&staffId=${STAFF_UUID}&date=${VALID_DATE}`
    ));

    const json = await res.json();
    expect(json.slots).toEqual([]);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('invalid staffId UUID → empty slots', async () => {
    const { GET } = await import('../route');
    const res = await GET(makeRequest(
      `?facilityId=${FACILITY_UUID}&staffId=bad-uuid&date=${VALID_DATE}`
    ));

    const json = await res.json();
    expect(json.slots).toEqual([]);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('invalid date format → empty slots', async () => {
    const { GET } = await import('../route');
    const res = await GET(makeRequest(
      `?facilityId=${FACILITY_UUID}&staffId=${STAFF_UUID}&date=2026/05/01`
    ));

    const json = await res.json();
    expect(json.slots).toEqual([]);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('duration too low → clamped to 15', async () => {
    const { GET } = await import('../route');
    await GET(makeRequest(
      `?facilityId=${FACILITY_UUID}&staffId=${STAFF_UUID}&date=${VALID_DATE}&duration=5`
    ));

    expect(mockRpc).toHaveBeenCalledWith('get_available_slots', {
      p_facility_id: FACILITY_UUID,
      p_staff_id: STAFF_UUID,
      p_date: VALID_DATE,
      p_duration_minutes: 15,
    });
  });

  test('duration too high → clamped to 480', async () => {
    const { GET } = await import('../route');
    await GET(makeRequest(
      `?facilityId=${FACILITY_UUID}&staffId=${STAFF_UUID}&date=${VALID_DATE}&duration=999`
    ));

    expect(mockRpc).toHaveBeenCalledWith('get_available_slots', {
      p_facility_id: FACILITY_UUID,
      p_staff_id: STAFF_UUID,
      p_date: VALID_DATE,
      p_duration_minutes: 480,
    });
  });

  test('valid duration preserved', async () => {
    const { GET } = await import('../route');
    await GET(makeRequest(
      `?facilityId=${FACILITY_UUID}&staffId=${STAFF_UUID}&date=${VALID_DATE}&duration=120`
    ));

    expect(mockRpc).toHaveBeenCalledWith('get_available_slots', {
      p_facility_id: FACILITY_UUID,
      p_staff_id: STAFF_UUID,
      p_date: VALID_DATE,
      p_duration_minutes: 120,
    });
  });

  test('valid request → calls RPC with params', async () => {
    mockRpc.mockResolvedValue({
      data: [
        { time: '09:00', available: true },
        { time: '10:00', available: true },
      ],
    });

    const { GET } = await import('../route');
    const res = await GET(makeRequest(
      `?facilityId=${FACILITY_UUID}&staffId=${STAFF_UUID}&date=${VALID_DATE}`
    ));

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('get_available_slots', {
      p_facility_id: FACILITY_UUID,
      p_staff_id: STAFF_UUID,
      p_date: VALID_DATE,
      p_duration_minutes: 60,
    });

    const json = await res.json();
    expect(json.slots.length).toBe(2);
  });

  test('extracts first IP from x-forwarded-for', async () => {
    (inMemoryRateLimit as jest.Mock).mockClear();

    const { GET } = await import('../route');
    await GET(makeRequest(
      `?facilityId=${FACILITY_UUID}&staffId=${STAFF_UUID}&date=${VALID_DATE}`
    ));

    expect(inMemoryRateLimit).toHaveBeenCalledWith('192.168.1.1', 30, 60000, 'slots');
  });

  test('uses unknown IP when x-forwarded-for missing', async () => {
    (inMemoryRateLimit as jest.Mock).mockClear();

    const req = new Request(
      `http://localhost/api/slots?facilityId=${FACILITY_UUID}&staffId=${STAFF_UUID}&date=${VALID_DATE}`
    );

    const { GET } = await import('../route');
    await GET(req);

    expect(inMemoryRateLimit).toHaveBeenCalledWith('unknown', 30, 60000, 'slots');
  });

  test('RPC exception → 500', async () => {
    const { captureException } = require('@sentry/nextjs');
    const testError = new Error('RPC failed');

    mockRpc.mockRejectedValue(testError);

    const { GET } = await import('../route');
    const res = await GET(makeRequest(
      `?facilityId=${FACILITY_UUID}&staffId=${STAFF_UUID}&date=${VALID_DATE}`
    ));

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain('サーバーエラー');
    expect(json.slots).toEqual([]);
    expect(captureException).toHaveBeenCalledWith(testError, expect.any(Object));
  });

  test('null data from RPC → empty slots', async () => {
    mockRpc.mockResolvedValue({ data: null });

    const { GET } = await import('../route');
    const res = await GET(makeRequest(
      `?facilityId=${FACILITY_UUID}&staffId=${STAFF_UUID}&date=${VALID_DATE}`
    ));

    const json = await res.json();
    expect(json.slots).toEqual([]);
  });

  test('default duration is 60 minutes', async () => {
    const { GET } = await import('../route');
    await GET(makeRequest(
      `?facilityId=${FACILITY_UUID}&staffId=${STAFF_UUID}&date=${VALID_DATE}`
    ));

    expect(mockRpc).toHaveBeenCalledWith(
      'get_available_slots',
      expect.objectContaining({ p_duration_minutes: 60 })
    );
  });

  test('invalid duration string → defaults to 60', async () => {
    const { GET } = await import('../route');
    await GET(makeRequest(
      `?facilityId=${FACILITY_UUID}&staffId=${STAFF_UUID}&date=${VALID_DATE}&duration=abc`
    ));

    expect(mockRpc).toHaveBeenCalledWith(
      'get_available_slots',
      expect.objectContaining({ p_duration_minutes: 60 })
    );
  });
});
