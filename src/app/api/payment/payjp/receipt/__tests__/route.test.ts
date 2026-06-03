/**
 * @jest-environment node
 *
 * Tests for GET /api/payment/payjp/receipt（PAY.JP 領収書・Phase 4a）
 */
jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/supabase-server');
jest.mock('@/lib/supabase-server-auth');

import { NextRequest } from 'next/server';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { GET } from '../route';

const BOOKING_UUID = '11111111-1111-1111-1111-111111111111';
const USER_ID = 'user-123';

let mockGetUser: jest.Mock;
let mockBookingSingle: jest.Mock;

function setup(opts: { hasUser?: boolean; booking?: unknown } = {}) {
  const hasUser = opts.hasUser ?? true;
  mockGetUser = jest.fn().mockResolvedValue({ data: { user: hasUser ? { id: USER_ID } : null } });
  const { createServerSupabaseAuthClient } = require('@/lib/supabase-server-auth');
  createServerSupabaseAuthClient.mockResolvedValue({ auth: { getUser: mockGetUser } });

  mockBookingSingle = jest.fn().mockResolvedValue({ data: opts.booking === undefined ? DEFAULT_BOOKING : opts.booking });
  const chain = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: mockBookingSingle };
  const { createServiceRoleClient } = require('@/lib/supabase-server');
  createServiceRoleClient.mockReturnValue({ from: jest.fn(() => chain) });
}

const DEFAULT_BOOKING = {
  id: BOOKING_UUID, user_id: USER_ID, paid_amount: 5000, total_price: 5000,
  payment_status: 'paid', payjp_charge_id: 'ch_1', created_at: '2026-05-10T10:00:00Z',
  facility_profiles: [{ name: 'Salon ABC', address: '東京都', phone: '03-0000', postal_code: '150-0001', prefecture: '東京都', city: '渋谷区' }],
};

function makeReq(qs: string) {
  return new NextRequest(`http://localhost/api/payment/payjp/receipt${qs}`, { method: 'GET', headers: { 'x-forwarded-for': '1.2.3.4' } });
}

beforeEach(() => { jest.clearAllMocks(); (inMemoryRateLimit as jest.Mock).mockReturnValue(false); setup(); });

test('レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  expect((await GET(makeReq(`?bookingId=${BOOKING_UUID}`))).status).toBe(429);
});

test('未認証 → 401', async () => {
  setup({ hasUser: false });
  expect((await GET(makeReq(`?bookingId=${BOOKING_UUID}`))).status).toBe(401);
});

test('bookingId 欠落 → 400', async () => {
  expect((await GET(makeReq(''))).status).toBe(400);
});

test('bookingId 非UUID → 400', async () => {
  expect((await GET(makeReq('?bookingId=bad'))).status).toBe(400);
});

test('予約が見つからない → 404', async () => {
  setup({ booking: null });
  expect((await GET(makeReq(`?bookingId=${BOOKING_UUID}`))).status).toBe(404);
});

test('未払い(payment_status!=paid) → 400', async () => {
  setup({ booking: { ...DEFAULT_BOOKING, payment_status: 'unpaid' } });
  expect((await GET(makeReq(`?bookingId=${BOOKING_UUID}`))).status).toBe(400);
});

test('payjp_charge_id 欠落 → 400', async () => {
  setup({ booking: { ...DEFAULT_BOOKING, payjp_charge_id: null } });
  expect((await GET(makeReq(`?bookingId=${BOOKING_UUID}`))).status).toBe(400);
});

test('正常 → 200 HTML 領収書', async () => {
  const res = await GET(makeReq(`?bookingId=${BOOKING_UUID}`));
  expect(res.status).toBe(200);
  expect(res.headers.get('Content-Type')).toContain('text/html');
  const html = await res.text();
  expect(html).toContain('領　収　書');
  expect(html).toContain('¥5,000');
  expect(html).toContain('ch_1');
});

test('facility がオブジェクト(配列でない)でも生成できる', async () => {
  setup({ booking: { ...DEFAULT_BOOKING, facility_profiles: { name: 'Solo Salon' } } });
  const res = await GET(makeReq(`?bookingId=${BOOKING_UUID}`));
  expect(res.status).toBe(200);
  expect(await res.text()).toContain('Solo Salon');
});

test('paid_amount null → total_price にフォールバック', async () => {
  setup({ booking: { ...DEFAULT_BOOKING, paid_amount: null, total_price: 3000 } });
  const html = await (await GET(makeReq(`?bookingId=${BOOKING_UUID}`))).text();
  expect(html).toContain('¥3,000');
});

test('paid_amount/total_price とも null → ¥0', async () => {
  setup({ booking: { ...DEFAULT_BOOKING, paid_amount: null, total_price: null } });
  const html = await (await GET(makeReq(`?bookingId=${BOOKING_UUID}`))).text();
  expect(html).toContain('¥0');
});

test('x-forwarded-for ヘッダ無し → ip=unknown で処理継続（200）', async () => {
  const req = new NextRequest(`http://localhost/api/payment/payjp/receipt?bookingId=${BOOKING_UUID}`, { method: 'GET' });
  expect((await GET(req)).status).toBe(200);
});

test('例外 → 500', async () => {
  const { createServerSupabaseAuthClient } = require('@/lib/supabase-server-auth');
  createServerSupabaseAuthClient.mockRejectedValue(new Error('boom'));
  expect((await GET(makeReq(`?bookingId=${BOOKING_UUID}`))).status).toBe(500);
});
