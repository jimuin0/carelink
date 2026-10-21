/** @jest-environment node */
jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));
const mockGetUser = jest.fn(); const mockFrom = jest.fn();
jest.mock('@supabase/ssr', () => ({ createServerClient: () => ({ from: mockFrom, auth: { getUser: mockGetUser } }) }));
import { NextRequest } from 'next/server';
import { GET } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';

const userId = '75000000-0000-4000-8000-000000000001';
const own = '75000000-0000-4000-8000-000000000002';
const other = '75000000-0000-4000-8000-000000000003';
const row = { id: '75000000-0000-4000-8000-000000000004', customer_name: '合成 太郎', booking_date: '2026-10-23', start_time: '09:00:00', created_at: '2026-10-21T10:00:00Z' };
let memberships: { data: unknown; error: unknown };
let bookings: { data: unknown; error: unknown };
const bookingCalls: Array<[string, ...unknown[]]> = [];

function request(query: string) {
  return new NextRequest(`http://localhost/api/admin/bookings/recent?${query}`, { headers: { host: 'localhost' } });
}

beforeEach(() => {
  jest.clearAllMocks();
  bookingCalls.length = 0;
  jest.mocked(checkRateLimit).mockResolvedValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
  memberships = { data: [{ facility_id: own }], error: null };
  bookings = { data: [row], error: null };
  mockFrom.mockImplementation((table: string) => {
    if (table === 'facility_members') {
      const chain = { select: () => chain, eq: () => chain, in: () => Promise.resolve(memberships) };
      return chain;
    }
    const chain: Record<string, (...args: unknown[]) => unknown> = {};
    for (const name of ['select', 'eq', 'gte', 'order']) chain[name] = (...args: unknown[]) => { bookingCalls.push([name, ...args]); return chain; };
    chain.limit = (...args: unknown[]) => { bookingCalls.push(['limit', ...args]); return Promise.resolve(bookings); };
    return chain;
  });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
});

test('anonymous requests are rejected before any booking read', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
  expect((await GET(request(`facility_id=${own}`))).status).toBe(401);
  expect(mockFrom).not.toHaveBeenCalled();
});

test('rate limited before authentication', async () => {
  jest.mocked(checkRateLimit).mockResolvedValue(true);
  expect((await GET(request(`facility_id=${own}`))).status).toBe(429);
  expect(mockGetUser).not.toHaveBeenCalled();
});

test.each([
  ['another facility', `facility_id=${other}`, 403],
  ['no owner/admin membership', `facility_id=${own}`, 403],
])('%s is forbidden and reads no bookings', async (label, query, status) => {
  if (label === 'no owner/admin membership') memberships = { data: [], error: null };
  const response = await GET(request(query));
  expect(response.status).toBe(status);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(bookingCalls).toHaveLength(0);
});

test('multi-facility owners must name the facility', async () => {
  memberships = { data: [{ facility_id: own }, { facility_id: other }], error: null };
  expect((await GET(request(''))).status).toBe(400);
  expect(bookingCalls).toHaveLength(0);
});

test('membership read failure is a 500, never an empty answer', async () => {
  memberships = { data: null, error: { message: 'synthetic' } };
  expect((await GET(request(`facility_id=${own}`))).status).toBe(500);
  expect(bookingCalls).toHaveLength(0);
});

test('returns only notification columns for the selected facility since the given time', async () => {
  const since = new Date(Date.now() - 5 * 60_000).toISOString();
  const response = await GET(request(`facility_id=${own}&since=${encodeURIComponent(since)}`));
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  const body = await response.json();
  expect(body.bookings).toEqual([row]);
  expect(Date.parse(body.now)).not.toBeNaN();
  expect(bookingCalls).toEqual([
    ['select', 'id, customer_name, booking_date, start_time, created_at'],
    ['eq', 'facility_id', own],
    ['gte', 'created_at', since],
    ['order', 'created_at', { ascending: true }],
    ['limit', 20],
  ]);
});

test('a missing since starts two minutes back', async () => {
  const before = Date.now();
  await GET(request(`facility_id=${own}`));
  const sinceMs = Date.parse(bookingCalls.find(c => c[0] === 'gte')![2] as string);
  expect(before - sinceMs).toBeGreaterThanOrEqual(119_000);
  expect(before - sinceMs).toBeLessThanOrEqual(121_000);
});

test.each([
  ['booking read error', () => { bookings = { data: null, error: { message: 'synthetic' } }; }],
  ['unconfirmed result', () => { bookings = { data: null, error: null }; }],
])('%s is a 500, never "no new bookings"', async (_label, arrange) => {
  arrange();
  expect((await GET(request(`facility_id=${own}`))).status).toBe(500);
});
