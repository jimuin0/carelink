/**
 * @jest-environment node
 *
 * Tests for POST /api/payment/webhook
 * Key assertions:
 *   - Stripe signature verification rejects tampered payloads
 *   - Idempotency guard: duplicate event → 200 received:true (no reprocessing)
 *   - checkout.session.completed DB failure → 500 so Stripe retries
 *   - idempotency insert error (non-duplicate) → 500
 */

const mockStripeWebhooksConstructEvent = jest.fn();
jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    webhooks: { constructEvent: mockStripeWebhooksConstructEvent },
  }))
);

// Use a factory function to avoid temporal dead zone with mockFrom variable
let _mockFrom: jest.Mock;
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (...args: unknown[]) => _mockFrom(...args) }),
}));

import { POST } from '../route';

const mockFrom = jest.fn();
beforeAll(() => { _mockFrom = mockFrom; });

const BOOKING_UUID = '11111111-1111-1111-1111-111111111111';
const EVENT_ID = 'evt_test_abc123';

function makeRequest(body = '{}', sig = 'valid-sig') {
  return new Request('http://localhost/api/payment/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': sig, 'Content-Type': 'application/json' },
    body,
  });
}

function makeEvent(type: string, dataObject: object = {}): object {
  return { id: EVENT_ID, type, data: { object: dataObject } };
}

function idempotencyChain(data: unknown, error: unknown = null) {
  return {
    insert: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        maybeSingle: jest.fn(() => Promise.resolve({ data, error })),
      }),
    }),
    update: jest.fn().mockReturnValue({
      eq: jest.fn(() => Promise.resolve({ error: null })),
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_dummy';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

// ─── Basic guards ─────────────────────────────────────────────────────────────

test('署名ヘッダーなし → 400', async () => {
  const req = new Request('http://localhost/api/payment/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const res = await POST(req);
  expect(res.status).toBe(400);
});

test('Stripeシグネチャ検証失敗 → 400', async () => {
  mockStripeWebhooksConstructEvent.mockImplementation(() => { throw new Error('Signature mismatch'); });
  const res = await POST(makeRequest());
  expect(res.status).toBe(400);
});

test('環境変数未設定 → 503', async () => {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  const res = await POST(makeRequest());
  expect(res.status).toBe(503);
});

// ─── Idempotency guard ────────────────────────────────────────────────────────

test('重複イベント（23505 unique violation） → 200 received:true duplicate:true', async () => {
  mockStripeWebhooksConstructEvent.mockReturnValue(makeEvent('checkout.session.completed'));
  mockFrom.mockReturnValue({
    insert: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: { code: '23505' } })),
      }),
    }),
  });
  const res = await POST(makeRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.duplicate).toBe(true);
});

test('冪等性INSERT失敗（非重複エラー） → 500', async () => {
  mockStripeWebhooksConstructEvent.mockReturnValue(makeEvent('checkout.session.completed'));
  mockFrom.mockReturnValue({
    insert: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST301', message: 'connection refused' } })),
      }),
    }),
  });
  const res = await POST(makeRequest());
  expect(res.status).toBe(500);
});

// ─── checkout.session.completed ───────────────────────────────────────────────

test('checkout.session.completed: booking UPDATE成功 → 200', async () => {
  mockStripeWebhooksConstructEvent.mockReturnValue(makeEvent('checkout.session.completed', {
    metadata: { booking_id: BOOKING_UUID },
    payment_intent: 'pi_test_123',
    amount_total: 5000,
  }));
  let callNum = 0;
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return idempotencyChain({ id: EVENT_ID }); // first insert succeeds
    // booking update
    return {
      update: jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error: null })) }),
    };
  });
  const res = await POST(makeRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.received).toBe(true);
});

test('checkout.session.completed: booking UPDATE失敗 → 500 (Stripeリトライ誘発)', async () => {
  mockStripeWebhooksConstructEvent.mockReturnValue(makeEvent('checkout.session.completed', {
    metadata: { booking_id: BOOKING_UUID },
    payment_intent: 'pi_test_123',
    amount_total: 5000,
  }));
  let callNum = 0;
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return idempotencyChain({ id: EVENT_ID });
    return {
      update: jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error: { message: 'DB error' } })) }),
    };
  });
  const res = await POST(makeRequest());
  // Must return 500 so Stripe retries — money path must not silently fail
  expect(res.status).toBe(500);
});

test('checkout.session.completed: booking_id なし → 200 (non-booking payment)', async () => {
  mockStripeWebhooksConstructEvent.mockReturnValue(makeEvent('checkout.session.completed', {
    metadata: {}, // no booking_id
    payment_intent: 'pi_test_456',
    amount_total: 3000,
  }));
  mockFrom.mockReturnValue(idempotencyChain({ id: EVENT_ID }));
  const res = await POST(makeRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.received).toBe(true);
});

// ─── Other event types ────────────────────────────────────────────────────────

test('payment_intent.payment_failed → 200', async () => {
  mockStripeWebhooksConstructEvent.mockReturnValue(makeEvent('payment_intent.payment_failed', {
    id: 'pi_test_fail',
    metadata: { booking_id: BOOKING_UUID },
  }));
  let callNum = 0;
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return idempotencyChain({ id: EVENT_ID });
    return { update: jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error: null })) }) };
  });
  const res = await POST(makeRequest());
  expect(res.status).toBe(200);
});

test('charge.refunded (full) → payment_status=refunded', async () => {
  mockStripeWebhooksConstructEvent.mockReturnValue(makeEvent('charge.refunded', {
    payment_intent: 'pi_test_refund',
    amount: 5000,
    amount_refunded: 5000,
  }));
  let callNum = 0;
  const updateMock = jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error: null })) });
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return idempotencyChain({ id: EVENT_ID });
    return { update: updateMock };
  });
  const res = await POST(makeRequest());
  expect(res.status).toBe(200);
  expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ payment_status: 'refunded' }));
});

test('未知のイベントタイプ → 200 (デフォルトスルー)', async () => {
  mockStripeWebhooksConstructEvent.mockReturnValue(makeEvent('some.unknown.event'));
  mockFrom.mockReturnValue(idempotencyChain({ id: EVENT_ID }));
  const res = await POST(makeRequest());
  expect(res.status).toBe(200);
});
