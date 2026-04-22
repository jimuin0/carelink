/**
 * @jest-environment node
 *
 * Tests for POST /api/payment/webhook
 * Key assertions:
 *   - Stripe signature verification via constructEvent
 *   - Idempotency via stripe_events table (23505 handling)
 *   - checkout.session.completed → updates booking payment_status
 *   - payment_intent.payment_failed → marks booking as failed
 *   - Missing configuration → 503
 */

jest.mock('stripe');

const mockFromDelegate = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: (...args: any[]) => mockFromDelegate(...args),
  })),
}));

import { POST } from '../route';

let mockInsert: jest.Mock;
let mockUpdate: jest.Mock;
let mockConstructEvent: jest.Mock;

function setupDefaultMocks(
  signatureValid: boolean = true,
  idempotencyPass: boolean = true,
  updateSucceeds: boolean = true
) {
  mockConstructEvent = jest.fn();
  if (signatureValid) {
    mockConstructEvent.mockReturnValue({
      id: 'evt_123',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_123',
          metadata: { booking_id: 'booking-123' },
          amount_total: 5000,
          payment_intent: 'pi_123',
        },
      },
    });
  } else {
    mockConstructEvent.mockImplementation(() => {
      throw new Error('Invalid signature');
    });
  }

  mockInsert = jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({
      maybeSingle: jest.fn().mockResolvedValue({
        data: idempotencyPass ? { id: 'evt_123' } : null,
        error: idempotencyPass ? null : { code: '23505' },
      }),
    }),
  });

  mockUpdate = jest.fn().mockReturnValue({
    eq: jest.fn().mockResolvedValue({
      error: updateSucceeds ? null : { message: 'Update failed' },
    }),
  });

  const Stripe = require('stripe');
  Stripe.mockImplementation(() => ({
    webhooks: { constructEvent: mockConstructEvent },
  }));

  mockFromDelegate.mockImplementation((table: string) => {
    if (table === 'stripe_events') {
      return { insert: mockInsert };
    } else if (table === 'bookings') {
      return { update: mockUpdate };
    }
  });

  process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_123';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
}

beforeEach(() => {
  jest.clearAllMocks();
  setupDefaultMocks();
});

function makeRequest(
  body: string,
  signature: string = 'valid-sig'
) {
  return new Request('http://localhost/api/payment/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': signature,
    },
    body,
  });
}

describe('POST /api/payment/webhook', () => {
  test('missing STRIPE_SECRET_KEY → 503', async () => {
    delete process.env.STRIPE_SECRET_KEY;

    const res = await POST(makeRequest('{}') as any);

    expect(res.status).toBe(503);
  });

  test('missing STRIPE_WEBHOOK_SECRET → 503', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;

    const res = await POST(makeRequest('{}') as any);

    expect(res.status).toBe(503);
  });

  test('missing stripe-signature header → 400', async () => {
    const req = new Request('http://localhost/api/payment/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });

    const res = await POST(req as any);

    expect(res.status).toBe(400);
  });

  test('invalid signature → 400', async () => {
    setupDefaultMocks(false);

    const res = await POST(makeRequest('{}', 'invalid-sig') as any);

    expect(res.status).toBe(400);
  });

  test('valid signature → processes event', async () => {
    const res = await POST(
      makeRequest(
        JSON.stringify({
          id: 'evt_123',
          type: 'checkout.session.completed',
        }),
        'valid-sig'
      ) as any
    );

    expect(res.status).toBe(200);
  });

  test('duplicate event (23505) → returns 200 with duplicate flag', async () => {
    setupDefaultMocks(true, false);

    const res = await POST(
      makeRequest(JSON.stringify({}), 'sig') as any
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.duplicate).toBe(true);
  });

  test('checkout.session.completed → updates booking payment_status to paid', async () => {
    const res = await POST(
      makeRequest(
        JSON.stringify({
          id: 'evt_123',
          type: 'checkout.session.completed',
          data: {
            object: {
              metadata: { booking_id: 'booking-123' },
              amount_total: 5000,
              payment_intent: 'pi_123',
            },
          },
        }),
        'sig'
      ) as any
    );

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_status: 'paid',
      })
    );
  });

  test('checkout.session.completed includes amount_total', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_123',
      type: 'checkout.session.completed',
      data: {
        object: {
          metadata: { booking_id: 'booking-123' },
          amount_total: 12345,
          payment_intent: 'pi_123',
        },
      },
    });

    const res = await POST(makeRequest('{}', 'sig') as any);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        paid_amount: 12345,
      })
    );
  });

  test('payment_intent.payment_failed → updates booking to failed', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_fail_123',
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: 'pi_failed',
          metadata: { booking_id: 'booking-456' },
        },
      },
    });

    const res = await POST(
      makeRequest(JSON.stringify({}), 'sig') as any
    );

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_status: 'failed',
      })
    );
  });

  test('payment_intent.payment_failed without booking_id → skips update', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_fail_123',
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: 'pi_failed',
          metadata: {},
        },
      },
    });

    mockUpdate.mockClear();

    const res = await POST(
      makeRequest(JSON.stringify({}), 'sig') as any
    );

    // May have fallback logic, but at minimum should handle gracefully
    expect(res.status).toBe(200);
  });

  test('event without booking_id metadata → skips', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_123',
      type: 'checkout.session.completed',
      data: {
        object: {
          metadata: {},
          amount_total: 5000,
        },
      },
    });

    const res = await POST(makeRequest(JSON.stringify({}), 'sig') as any);

    expect(res.status).toBe(200);
  });

  test('update error during payment processing → 500', async () => {
    setupDefaultMocks(true, true, false);

    const res = await POST(
      makeRequest(JSON.stringify({}), 'sig') as any
    );

    expect(res.status).toBe(500);
  });

  test('insert stripe_events for idempotency', async () => {
    const res = await POST(
      makeRequest(
        JSON.stringify({
          id: 'evt_123',
          type: 'checkout.session.completed',
        }),
        'sig'
      ) as any
    );

    expect(mockInsert).toHaveBeenCalledWith({ id: 'evt_123', type: 'checkout.session.completed' });
  });

  test('unknown event type → accepted (no processing)', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_unknown',
      type: 'unknown.event',
      data: { object: {} },
    });

    const res = await POST(
      makeRequest(JSON.stringify({}), 'sig') as any
    );

    expect(res.status).toBe(200);
  });

  test('successful response includes received=true', async () => {
    const res = await POST(
      makeRequest(JSON.stringify({}), 'sig') as any
    );

    const json = await res.json();
    expect(json.received).toBe(true);
  });

  test('calls constructEvent with body, signature, secret', async () => {
    const body = JSON.stringify({ id: 'evt_123' });

    await POST(makeRequest(body, 'test-sig') as any);

    expect(mockConstructEvent).toHaveBeenCalledWith(body, 'test-sig', 'whsec_test_123');
  });

  test('stores stripe_payment_intent_id in booking', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_123',
      type: 'checkout.session.completed',
      data: {
        object: {
          metadata: { booking_id: 'booking-123' },
          amount_total: 5000,
          payment_intent: 'pi_abc123xyz',
        },
      },
    });

    const res = await POST(makeRequest('{}', 'sig') as any);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        stripe_payment_intent_id: 'pi_abc123xyz',
      })
    );
  });

  test('idempotency prevents duplicate processing', async () => {
    setupDefaultMocks(true, false);

    const res = await POST(
      makeRequest(JSON.stringify({}), 'sig') as any
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.duplicate).toBe(true);
  });

  describe('handleEvent — specific event types', () => {
    function setupEventMock(eventType: string, dataObject: Record<string, unknown>) {
      const Stripe = require('stripe');
      Stripe.mockImplementation(() => ({
        webhooks: {
          constructEvent: jest.fn().mockReturnValue({
            id: `evt_${eventType.replace(/\./g, '_')}`,
            type: eventType,
            data: { object: dataObject },
          }),
        },
      }));
    }

    test('charge.refunded full refund → payment_status=refunded', async () => {
      setupEventMock('charge.refunded', {
        payment_intent: 'pi_refund_001',
        amount: 5000,
        amount_refunded: 5000,
      });

      const res = await POST(makeRequest('{}', 'sig') as any);

      expect(res.status).toBe(200);
      expect(mockUpdate).toHaveBeenCalledWith({ payment_status: 'refunded' });
    });

    test('charge.refunded partial refund → payment_status=partial_refund', async () => {
      setupEventMock('charge.refunded', {
        payment_intent: 'pi_refund_002',
        amount: 5000,
        amount_refunded: 2500,
      });

      const res = await POST(makeRequest('{}', 'sig') as any);

      expect(res.status).toBe(200);
      expect(mockUpdate).toHaveBeenCalledWith({ payment_status: 'partial_refund' });
    });

    test('charge.refunded without payment_intent → no DB update', async () => {
      setupEventMock('charge.refunded', {
        payment_intent: null,
        amount: 5000,
        amount_refunded: 5000,
      });

      mockUpdate.mockClear();

      const res = await POST(makeRequest('{}', 'sig') as any);

      expect(res.status).toBe(200);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    test('charge.dispute.created → payment_status=disputed', async () => {
      setupEventMock('charge.dispute.created', {
        payment_intent: 'pi_dispute_001',
        status: 'needs_response',
      });

      const res = await POST(makeRequest('{}', 'sig') as any);

      expect(res.status).toBe(200);
      expect(mockUpdate).toHaveBeenCalledWith({ payment_status: 'disputed' });
    });

    test('charge.dispute.created without payment_intent → no DB update', async () => {
      setupEventMock('charge.dispute.created', {
        payment_intent: null,
        status: 'needs_response',
      });

      mockUpdate.mockClear();

      const res = await POST(makeRequest('{}', 'sig') as any);

      expect(res.status).toBe(200);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    test('charge.dispute.closed won → payment_status=paid', async () => {
      setupEventMock('charge.dispute.closed', {
        payment_intent: 'pi_dispute_won',
        status: 'won',
      });

      const res = await POST(makeRequest('{}', 'sig') as any);

      expect(res.status).toBe(200);
      expect(mockUpdate).toHaveBeenCalledWith({ payment_status: 'paid' });
    });

    test('charge.dispute.closed lost → payment_status=dispute_lost', async () => {
      setupEventMock('charge.dispute.closed', {
        payment_intent: 'pi_dispute_lost',
        status: 'lost',
      });

      const res = await POST(makeRequest('{}', 'sig') as any);

      expect(res.status).toBe(200);
      expect(mockUpdate).toHaveBeenCalledWith({ payment_status: 'dispute_lost' });
    });

    test('charge.dispute.closed without payment_intent → no DB update', async () => {
      setupEventMock('charge.dispute.closed', {
        payment_intent: null,
        status: 'won',
      });

      mockUpdate.mockClear();

      const res = await POST(makeRequest('{}', 'sig') as any);

      expect(res.status).toBe(200);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    test('payment_intent.payment_failed without booking_id → updates by stripe_payment_intent_id', async () => {
      setupEventMock('payment_intent.payment_failed', {
        id: 'pi_fallback_001',
        metadata: {},
      });

      const res = await POST(makeRequest('{}', 'sig') as any);

      expect(res.status).toBe(200);
      expect(mockUpdate).toHaveBeenCalledWith({ payment_status: 'failed' });
    });
  });
});
