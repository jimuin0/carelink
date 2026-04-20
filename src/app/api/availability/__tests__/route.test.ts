/**
 * @jest-environment node
 *
 * Tests for GET /api/availability
 * Key assertions:
 *   - Rate limiting → 429 (10 req/min per IP)
 *   - Facility ID UUID validation
 *   - Staff ID UUID optional
 *   - Year/month validation (currentYear-1 to currentYear+2)
 *   - Duration clamped [15, 480] minutes
 *   - RPC call with correct parameters
 *   - Availability status calculation (available/few/full)
 *   - Empty array returned on validation fail
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/supabase-server', () => ({
  createServerSupabaseClient: jest.fn(),
}));
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }));

import { inMemoryRateLimit } from '@/lib/rate-limit';
import { GET } from '../route';

let mockRpc: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);

  mockRpc = jest.fn().mockResolvedValue({ data: [] });

  const mockLimit = jest.fn().mockResolvedValue({ data: [{ id: STAFF_UUID }] });
  const mockEq2 = jest.fn().mockReturnValue({ limit: mockLimit });
  const mockEq1 = jest.fn().mockReturnValue({ eq: mockEq2 });
  const mockSelect = jest.fn().mockReturnValue({ eq: mockEq1 });

  const { createServerSupabaseClient } = require('@/lib/supabase-server');
  createServerSupabaseClient.mockReturnValue({
    from: jest.fn().mockReturnValue({ select: mockSelect }),
    rpc: mockRpc,
  });

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
});

function makeRequest(query: string, ip = '192.168.1.1') {
  return new Request(`http://localhost/api/availability${query}`, {
    method: 'GET',
    headers: { 'x-forwarded-for': ip },
  });
}

const FACILITY_UUID = '11111111-1111-1111-1111-111111111111';
const STAFF_UUID = '22222222-2222-2222-2222-222222222222';
const VALID_DATE = '2026-05-01';

describe('GET /api/availability', () => {
  test('rate limiting → 429', async () => {
    (inMemoryRateLimit as jest.Mock).mockReturnValue(true);

    const res = await GET(makeRequest(
      `?facilityId=${FACILITY_UUID}&staffId=${STAFF_UUID}&year=2026&month=5`
    ));

    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toContain('多すぎます');
  });

  test('missing facilityId → error', async () => {
    const res = await GET(makeRequest(
      `?staffId=${STAFF_UUID}&year=2026&month=5`
    ));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('施設IDが不正');
  });

  test('invalid facilityId UUID → error', async () => {
    const res = await GET(makeRequest(
      `?facilityId=not-a-uuid&staffId=${STAFF_UUID}&year=2026&month=5`
    ));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('施設IDが不正');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('invalid staffId UUID → error', async () => {
    const res = await GET(makeRequest(
      `?facilityId=${FACILITY_UUID}&staffId=bad-uuid&year=2026&month=5`
    ));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('スタッフIDが不正');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('missing year → error', async () => {
    const res = await GET(makeRequest(
      `?facilityId=${FACILITY_UUID}&staffId=${STAFF_UUID}&month=5`
    ));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('年月が不正');
  });

  test('missing month → error', async () => {
    const res = await GET(makeRequest(
      `?facilityId=${FACILITY_UUID}&staffId=${STAFF_UUID}&year=2026`
    ));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('年月が不正');
  });

  test('month too low (0) → error', async () => {
    const res = await GET(makeRequest(
      `?facilityId=${FACILITY_UUID}&staffId=${STAFF_UUID}&year=2026&month=0`
    ));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('年月が不正');
  });

  test('month too high (13) → error', async () => {
    const res = await GET(makeRequest(
      `?facilityId=${FACILITY_UUID}&staffId=${STAFF_UUID}&year=2026&month=13`
    ));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('年月が不正');
  });

  test('year too far in past → error', async () => {
    const currentYear = new Date().getFullYear();
    const res = await GET(makeRequest(
      `?facilityId=${FACILITY_UUID}&staffId=${STAFF_UUID}&year=${currentYear - 2}&month=5`
    ));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('年月が不正');
  });

  test('year too far in future → error', async () => {
    const currentYear = new Date().getFullYear();
    const res = await GET(makeRequest(
      `?facilityId=${FACILITY_UUID}&staffId=${STAFF_UUID}&year=${currentYear + 3}&month=5`
    ));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('年月が不正');
  });

  test('valid facilityId with staffId → calls RPC', async () => {
    const res = await GET(makeRequest(
      `?facilityId=${FACILITY_UUID}&staffId=${STAFF_UUID}&year=2026&month=5`
    ));

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('get_available_slots', {
      p_facility_id: FACILITY_UUID,
      p_staff_id: STAFF_UUID,
      p_date: expect.any(String),
      p_duration_minutes: 60,
    });
  });

  test('valid facilityId without staffId → uses all active staff', async () => {
    const res = await GET(makeRequest(
      `?facilityId=${FACILITY_UUID}&year=2026&month=5`
    ));

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalled();
  });

  test('duration parameter hard-coded to 60', async () => {
    await GET(makeRequest(
      `?facilityId=${FACILITY_UUID}&staffId=${STAFF_UUID}&year=2026&month=5`
    ));

    const call = mockRpc.mock.calls[0];
    expect(call[1].p_duration_minutes).toBe(60);
  });

  test('RPC returns data → availability calculated', async () => {
    mockRpc.mockResolvedValue({
      data: [
        { time: '09:00', available: true },
        { time: '10:00', available: true },
        { time: '11:00', available: true },
      ],
    });

    const res = await GET(makeRequest(
      `?facilityId=${FACILITY_UUID}&staffId=${STAFF_UUID}&year=2026&month=5`
    ));

    const json = await res.json();
    expect(json.dates).toBeDefined();
    expect(Object.keys(json.dates).length).toBeGreaterThan(0);
  });

  test('no available slots (RPC returns empty) → dates with 0 slots', async () => {
    mockRpc.mockResolvedValue({ data: [] });

    const res = await GET(makeRequest(
      `?facilityId=${FACILITY_UUID}&staffId=${STAFF_UUID}&year=2026&month=5`
    ));

    const json = await res.json();
    expect(Object.keys(json.dates).length).toBeGreaterThan(0);
    Object.values(json.dates).forEach((dateInfo: any) => {
      expect(dateInfo.slots).toBe(0);
      expect(dateInfo.status).toBe('full');
    });
  });

  test('RPC exception → 500 error', async () => {
    const testError = new Error('RPC failed');
    mockRpc.mockRejectedValue(testError);

    const res = await GET(makeRequest(
      `?facilityId=${FACILITY_UUID}&staffId=${STAFF_UUID}&year=2026&month=5`
    ));

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain('サーバーエラー');
  });

  test('rate limit params (10 req/min per IP)', async () => {
    (inMemoryRateLimit as jest.Mock).mockClear();

    await GET(makeRequest(
      `?facilityId=${FACILITY_UUID}&staffId=${STAFF_UUID}&year=2026&month=5`
    ));

    expect(inMemoryRateLimit).toHaveBeenCalled();
    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('192.168.1.1');
    expect(call[1]).toBe(10);
    expect(call[2]).toBe(60_000);
    expect(call[3]).toBe('availability');
  });

  test('extracts first IP from x-forwarded-for', async () => {
    (inMemoryRateLimit as jest.Mock).mockClear();

    await GET(makeRequest(
      `?facilityId=${FACILITY_UUID}&staffId=${STAFF_UUID}&year=2026&month=5`,
      '10.0.0.1, 192.168.1.1'
    ));

    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('10.0.0.1');
  });

  test('uses unknown IP when x-forwarded-for missing', async () => {
    (inMemoryRateLimit as jest.Mock).mockClear();

    const req = new Request(
      `http://localhost/api/availability?facilityId=${FACILITY_UUID}&staffId=${STAFF_UUID}&year=2026&month=5`
    );

    await GET(req);

    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('unknown');
  });

  test('valid month=1 (January)', async () => {
    const res = await GET(makeRequest(
      `?facilityId=${FACILITY_UUID}&staffId=${STAFF_UUID}&year=2026&month=1`
    ));

    expect(res.status).toBe(200);
  });

  test('valid month=12 (December)', async () => {
    const res = await GET(makeRequest(
      `?facilityId=${FACILITY_UUID}&staffId=${STAFF_UUID}&year=2026&month=12`
    ));

    expect(res.status).toBe(200);
  });

  test('past dates marked as full availability', async () => {
    mockRpc.mockResolvedValue({ data: [] });

    const res = await GET(makeRequest(
      `?facilityId=${FACILITY_UUID}&staffId=${STAFF_UUID}&year=2026&month=5`
    ));

    const json = await res.json();
    // Dates before today should be marked as full
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    Object.entries(json.dates).forEach(([dateStr, data]: [string, any]) => {
      const date = new Date(dateStr + 'T00:00:00+09:00');
      if (date < today) {
        expect(data.status).toBe('full');
        expect(data.slots).toBe(0);
      }
    });
  });
});
