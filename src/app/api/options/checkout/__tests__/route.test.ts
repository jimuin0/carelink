/**
 * @jest-environment node
 *
 * Tests for POST /api/options/checkout（施設向け有料オプションの月額サブスク購入）
 * Key assertions:
 *   - 価格はサーバ側（option_catalog）で決定（クライアント渡し価格を信用しない）
 *   - owner/admin 以外 → 403（IDOR 防止）
 *   - contact_only / 価格未設定 / 既購入 → 400
 *   - mode: 'subscription'・metadata に facility_id/option_key
 */

jest.mock('@/lib/rate-limit', () => ({
  mutationRateLimit: {},
  checkRateLimit: jest.fn(() => Promise.resolve(false)),
}));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: jest.fn() }),
}));
const mockAlertCaughtError = jest.fn();
jest.mock('@/lib/alert', () => ({
  alertCaughtError: (...args: unknown[]) => mockAlertCaughtError(...args),
}));

const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';

const mockGetUser = jest.fn();
let membershipResult: { data: unknown };
let optionResult: { data: unknown };
let entitlementResult: { data: unknown };

const makeMaybeSingleChain = (resultRef: () => { data: unknown }) => ({
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  in: jest.fn().mockReturnThis(),
  maybeSingle: jest.fn(() => Promise.resolve(resultRef())),
});

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    from: (table: string) => {
      if (table === 'facility_members') return makeMaybeSingleChain(() => membershipResult);
      if (table === 'option_catalog') return makeMaybeSingleChain(() => optionResult);
      if (table === 'facility_entitlements') return makeMaybeSingleChain(() => entitlementResult);
      throw new Error(`unexpected table: ${table}`);
    },
    auth: { getUser: mockGetUser },
  }),
}));

const mockStripeCreate = jest.fn();
jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    checkout: { sessions: { create: mockStripeCreate } },
  }))
);

import { POST } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';

function makeRequest(body: object = { facilityId: FACILITY_UUID, optionKey: 'reminder_line' }) {
  return new Request('http://localhost/api/options/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as import('next/server').NextRequest;
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockResolvedValue(false);
  (checkCsrf as jest.Mock).mockReturnValue(null);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  mockStripeCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/opt', id: 'cs_opt' });
  membershipResult = { data: { role: 'owner' } };
  optionResult = { data: { key: 'reminder_line', name: 'LINEリマインド', monthly_price: 1500, contact_only: false, is_active: true } };
  entitlementResult = { data: null };
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
});

test('CSRF 失敗 → その応答を返す', async () => {
  const deny = new Response(JSON.stringify({ error: 'csrf' }), { status: 403 });
  (checkCsrf as jest.Mock).mockReturnValue(deny);
  const res = await POST(makeRequest());
  expect(res.status).toBe(403);
});

test('Stripe未設定 → 503', async () => {
  delete process.env.STRIPE_SECRET_KEY;
  const res = await POST(makeRequest());
  expect(res.status).toBe(503);
});

test('レートリミット超過 → 429', async () => {
  (checkRateLimit as jest.Mock).mockResolvedValue(true);
  const res = await POST(makeRequest());
  expect(res.status).toBe(429);
});

test('未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(makeRequest());
  expect(res.status).toBe(401);
});

test('facilityId 不正（UUID でない）→ 400', async () => {
  const res = await POST(makeRequest({ facilityId: 'not-uuid', optionKey: 'reminder_line' }));
  expect(res.status).toBe(400);
});

test('optionKey 不正（記号入り）→ 400', async () => {
  const res = await POST(makeRequest({ facilityId: FACILITY_UUID, optionKey: 'bad-key!' }));
  expect(res.status).toBe(400);
});

test('body が JSON でない → 400（catch フォールバック）', async () => {
  const req = new Request('http://localhost/api/options/checkout', {
    method: 'POST', body: 'not-json',
  }) as unknown as import('next/server').NextRequest;
  const res = await POST(req);
  expect(res.status).toBe(400);
});

test('owner/admin でない → 403（IDOR 防止）', async () => {
  membershipResult = { data: null };
  const res = await POST(makeRequest());
  expect(res.status).toBe(403);
});

test('オプションが存在しない → 404', async () => {
  optionResult = { data: null };
  const res = await POST(makeRequest());
  expect(res.status).toBe(404);
});

test('オプションが無効（is_active=false）→ 404', async () => {
  optionResult = { data: { key: 'reminder_line', name: 'x', monthly_price: 1500, contact_only: false, is_active: false } };
  const res = await POST(makeRequest());
  expect(res.status).toBe(404);
});

test('contact_only オプション → 400（自動課金不可）', async () => {
  optionResult = { data: { key: 'hpb_integration', name: 'HPB連携', monthly_price: 3000, contact_only: true, is_active: true } };
  const res = await POST(makeRequest({ facilityId: FACILITY_UUID, optionKey: 'hpb_integration' }));
  expect(res.status).toBe(400);
});

test('価格 0 円 → 400（誤無料販売防止）', async () => {
  optionResult = { data: { key: 'reminder_line', name: 'x', monthly_price: 0, contact_only: false, is_active: true } };
  const res = await POST(makeRequest());
  expect(res.status).toBe(400);
});

test('既に利用中 → 400（二重課金防止）', async () => {
  entitlementResult = { data: { id: 'ent-1' } };
  const res = await POST(makeRequest());
  expect(res.status).toBe(400);
});

test('正常系: subscription モードで作成され URL を返す（価格はサーバ決定）', async () => {
  const res = await POST(makeRequest());
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.url).toBe('https://checkout.stripe.com/opt');

  const arg = mockStripeCreate.mock.calls[0][0];
  expect(arg.mode).toBe('subscription');
  expect(arg.line_items[0].price_data.unit_amount).toBe(1500); // カタログ価格（サーバ側）
  expect(arg.line_items[0].price_data.recurring).toEqual({ interval: 'month' });
  expect(arg.metadata).toEqual({ facility_id: FACILITY_UUID, option_key: 'reminder_line', user_id: USER_ID });
  expect(arg.subscription_data.metadata).toEqual({ facility_id: FACILITY_UUID, option_key: 'reminder_line' });
});

test('Stripe エラー → 500（内部情報は漏らさない）＋Slack通知（無音catch根治）', async () => {
  mockStripeCreate.mockRejectedValue(new Error('stripe down'));
  const res = await POST(makeRequest());
  expect(res.status).toBe(500);
  const json = await res.json();
  expect(JSON.stringify(json)).not.toContain('stripe down');
  // catch して 500 を返すと onRequestError に伝播せず Slack 通知が漏れるため明示通知する（#490 と同型）。
  expect(mockAlertCaughtError).toHaveBeenCalledWith(
    'options-checkout',
    expect.any(Error),
    '/api/options/checkout',
  );
});
