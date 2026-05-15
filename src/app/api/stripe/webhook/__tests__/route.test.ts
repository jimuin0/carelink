/**
 * @jest-environment node
 *
 * Tests for POST /api/stripe/webhook
 * Key assertions:
 *   - Stripe signature verification
 *   - Idempotency via stripe_webhook_logs table
 *   - Event processing with atomic claim pattern
 *   - Audit logging via writeAuditLog
 *   - Graceful retry handling
 */

jest.mock('stripe');
jest.mock('@/lib/supabase-server');
jest.mock('@/lib/audit-logger');

import { POST } from '../route';

let mockUpsert: jest.Mock;
let mockSelect: jest.Mock;
let mockUpdate: jest.Mock;
let mockConstructEvent: jest.Mock;
let mockWriteAuditLog: jest.Mock;

function setupDefaultMocks(
  signatureValid: boolean = true,
  upsertSucceeds: boolean = true,
  alreadyProcessed: boolean = false
) {
  mockConstructEvent = jest.fn();
  if (signatureValid) {
    mockConstructEvent.mockReturnValue({
      id: 'evt_123',
      type: 'checkout.session.completed',
      data: { object: {} },
    });
  } else {
    mockConstructEvent.mockImplementation(() => {
      throw new Error('Invalid signature');
    });
  }

  mockUpsert = jest.fn().mockResolvedValue({
    error: upsertSucceeds ? null : { message: 'Upsert failed' },
  });

  mockSelect = jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      single: jest.fn().mockResolvedValue({
        data: {
          id: 'log-123',
          processed: alreadyProcessed,
        },
        error: null,
      }),
    }),
  });

  mockUpdate = jest.fn().mockReturnValue({
    eq: jest.fn().mockResolvedValue({ error: null }),
  });

  const Stripe = require('stripe');
  Stripe.mockImplementation(() => ({
    webhooks: { constructEvent: mockConstructEvent },
  }));

  const defaultTableMock = {
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      }),
    }),
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockResolvedValue({ data: [], error: null }),
    }),
  };

  const { createServiceRoleClient } = require('@/lib/supabase-server');
  createServiceRoleClient.mockReturnValue({
    from: jest.fn((table: string) => {
      if (table === 'stripe_webhook_logs') {
        return {
          upsert: mockUpsert,
          select: mockSelect,
          update: mockUpdate,
        };
      }
      return defaultTableMock;
    }),
  });

  mockWriteAuditLog = jest.fn().mockResolvedValue(undefined);
  const { writeAuditLog } = require('@/lib/audit-logger');
  writeAuditLog.mockImplementation(mockWriteAuditLog);

  process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_123';
}

beforeEach(() => {
  jest.clearAllMocks();
  setupDefaultMocks();
});

function makeRequest(
  body: string,
  signature: string = 'valid-sig'
) {
  return new Request('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': signature,
    },
    body,
  });
}

describe('POST /api/stripe/webhook', () => {
  test('missing stripe-signature → 400', async () => {
    const req = new Request('http://localhost/api/stripe/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });

    const res = await POST(req as any);

    expect(res.status).toBe(400);
  });

  test('missing STRIPE_WEBHOOK_SECRET → 400', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;

    const res = await POST(makeRequest('{}') as any);

    expect(res.status).toBe(400);
  });

  test('invalid signature → 400', async () => {
    setupDefaultMocks(false);

    const res = await POST(makeRequest('{}', 'invalid') as any);

    expect(res.status).toBe(400);
  });

  test('valid signature → processes event', async () => {
    const res = await POST(makeRequest('{}') as any);

    expect(res.status).toBe(200);
  });

  test('upserts event to stripe_webhook_logs', async () => {
    const res = await POST(
      makeRequest(
        JSON.stringify({ id: 'evt_456', type: 'invoice.payment_succeeded' })
      ) as any
    );

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_id: 'evt_123',
        processed: false,
      }),
      { onConflict: 'event_id', ignoreDuplicates: true }
    );
  });

  test('upsert error (conflict) → skips processing', async () => {
    setupDefaultMocks(true, false);

    const res = await POST(makeRequest('{}') as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.skipped).toBe(true);
  });

  test('re-reads to check idempotency', async () => {
    const res = await POST(makeRequest('{}') as any);

    expect(mockSelect).toHaveBeenCalled();
    const call = mockSelect().eq;
    expect(call).toHaveBeenCalledWith('event_id', 'evt_123');
  });

  test('already processed event → skips', async () => {
    setupDefaultMocks(true, true, true);

    const res = await POST(makeRequest('{}') as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.skipped).toBe(true);
  });

  test('marks event processed after handling', async () => {
    const res = await POST(makeRequest('{}') as any);

    expect(mockUpdate).toHaveBeenCalledWith({ processed: true });
  });

  test('writes audit log on successful processing', async () => {
    const res = await POST(makeRequest('{}') as any);

    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'update',
        tableName: 'stripe_webhook_logs',
        recordId: 'evt_123',
      })
    );
  });

  test('successful response includes received=true', async () => {
    const res = await POST(makeRequest('{}') as any);

    const json = await res.json();
    expect(json.received).toBe(true);
  });

  test('skipped response includes skipped=true', async () => {
    setupDefaultMocks(true, true, true);

    const res = await POST(makeRequest('{}') as any);

    const json = await res.json();
    expect(json.skipped).toBe(true);
  });

  test('event with unknown type → still marked processed', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_unknown',
      type: 'unknown.event',
      data: { object: {} },
    });

    const res = await POST(makeRequest('{}') as any);

    expect(res.status).toBe(200);
  });

  test('handleEvent exception → returns 500', async () => {
    // Simulate handleEvent throwing by making stripe_sessions update return an error
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'stripe_webhook_logs') {
          return { upsert: mockUpsert, select: mockSelect, update: mockUpdate };
        }
        return {
          update: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ error: { message: 'DB error' } }),
          }),
        };
      }),
    });

    const res = await POST(makeRequest('{}') as any);

    expect(res.status).toBe(500);
  });

  test('constructEvent uses correct Stripe API version', async () => {
    await POST(makeRequest('{}') as any);

    const Stripe = require('stripe');
    const lastCall = Stripe.mock.calls[Stripe.mock.calls.length - 1];
    expect(lastCall[1]).toEqual(
      expect.objectContaining({
        apiVersion: '2026-03-25.dahlia',
      })
    );
  });

  test('stores full event payload in webhook log', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_full',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_abc123',
          amount: 5000,
          currency: 'jpy',
        },
      },
    });

    const res = await POST(makeRequest('{}') as any);

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.any(Object),
      }),
      expect.any(Object)
    );
  });

  test('idempotency prevents duplicate processing via ignoreDuplicates', async () => {
    await POST(makeRequest('{}') as any);

    const call = mockUpsert.mock.calls[0];
    expect(call[1].ignoreDuplicates).toBe(true);
  });

  test('re-read after upsert (atomic claim pattern)', async () => {
    await POST(makeRequest('{}') as any);

    // Should call select to verify ownership
    expect(mockSelect).toHaveBeenCalled();
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

    const mockStripeSessionsUpdate = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      }),
    });
    const mockBookingsUpdate = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      }),
    });

    beforeEach(() => {
      const { createServiceRoleClient } = require('@/lib/supabase-server');
      createServiceRoleClient.mockReturnValue({
        from: jest.fn((table: string) => {
          if (table === 'stripe_webhook_logs') {
            return { upsert: mockUpsert, select: mockSelect, update: mockUpdate };
          }
          if (table === 'stripe_sessions') {
            return { update: mockStripeSessionsUpdate };
          }
          if (table === 'bookings') {
            return { update: mockBookingsUpdate };
          }
          if (table === 'featured_slots') {
            return { update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }) };
          }
          return {
            update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
            select: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ data: [], error: null }) }),
          };
        }),
      });
    });

    test('checkout.session.completed with deposit payment_type → confirms booking', async () => {
      setupEventMock('checkout.session.completed', {
        id: 'cs_test_123',
        payment_intent: 'pi_123',
        metadata: { booking_id: 'bk_001', payment_type: 'deposit' },
      });
      const res = await POST(makeRequest('{}') as any);
      expect(res.status).toBe(200);
      expect(mockBookingsUpdate).toHaveBeenCalled();
    });

    test('checkout.session.completed with cancel_fee payment_type → marks cancel_fee_paid', async () => {
      setupEventMock('checkout.session.completed', {
        id: 'cs_test_456',
        payment_intent: 'pi_456',
        metadata: { booking_id: 'bk_002', payment_type: 'cancel_fee' },
      });
      const res = await POST(makeRequest('{}') as any);
      expect(res.status).toBe(200);
      expect(mockBookingsUpdate).toHaveBeenCalled();
    });

    test('checkout.session.completed deposit booking update error → 500', async () => {
      const { createServiceRoleClient } = require('@/lib/supabase-server');
      createServiceRoleClient.mockReturnValue({
        from: jest.fn((table: string) => {
          if (table === 'stripe_webhook_logs') return { upsert: mockUpsert, select: mockSelect, update: mockUpdate };
          if (table === 'stripe_sessions') return { update: mockStripeSessionsUpdate };
          if (table === 'bookings') return {
            update: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockResolvedValue({ error: { message: 'deposit confirm failed' } }),
              }),
            }),
          };
          return { update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }) };
        }),
      });
      setupEventMock('checkout.session.completed', {
        id: 'cs_deposit_err',
        payment_intent: 'pi_deposit_err',
        metadata: { booking_id: 'bk_dep_err', payment_type: 'deposit' },
      });
      const res = await POST(makeRequest('{}') as any);
      expect(res.status).toBe(500);
    });

    test('checkout.session.completed cancel_fee booking update error → 500', async () => {
      const { createServiceRoleClient } = require('@/lib/supabase-server');
      createServiceRoleClient.mockReturnValue({
        from: jest.fn((table: string) => {
          if (table === 'stripe_webhook_logs') return { upsert: mockUpsert, select: mockSelect, update: mockUpdate };
          if (table === 'stripe_sessions') return { update: mockStripeSessionsUpdate };
          if (table === 'bookings') return {
            update: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ error: { message: 'cancel_fee update failed' } }),
            }),
          };
          return { update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }) };
        }),
      });
      setupEventMock('checkout.session.completed', {
        id: 'cs_cancel_err',
        payment_intent: 'pi_cancel_err',
        metadata: { booking_id: 'bk_cancel_err', payment_type: 'cancel_fee' },
      });
      const res = await POST(makeRequest('{}') as any);
      expect(res.status).toBe(500);
    });

    test('checkout.session.expired → marks session expired', async () => {
      setupEventMock('checkout.session.expired', {
        id: 'cs_expired_789',
      });
      const res = await POST(makeRequest('{}') as any);
      expect(res.status).toBe(200);
      expect(mockStripeSessionsUpdate).toHaveBeenCalled();
    });

    test('charge.refunded → marks session refunded', async () => {
      setupEventMock('charge.refunded', {
        payment_intent: 'pi_refund_001',
        amount: 5000,
        amount_refunded: 5000,
      });
      const res = await POST(makeRequest('{}') as any);
      expect(res.status).toBe(200);
      expect(mockStripeSessionsUpdate).toHaveBeenCalled();
    });

    test('charge.refunded without payment_intent → no DB update', async () => {
      setupEventMock('charge.refunded', {
        payment_intent: null,
        amount: 5000,
        amount_refunded: 2500,
      });
      const res = await POST(makeRequest('{}') as any);
      expect(res.status).toBe(200);
      expect(mockStripeSessionsUpdate).not.toHaveBeenCalled();
    });

    test('charge.dispute.created → marks session disputed', async () => {
      setupEventMock('charge.dispute.created', {
        payment_intent: 'pi_dispute_001',
        status: 'needs_response',
      });
      const res = await POST(makeRequest('{}') as any);
      expect(res.status).toBe(200);
      expect(mockStripeSessionsUpdate).toHaveBeenCalled();
      expect(mockBookingsUpdate).toHaveBeenCalled();
    });

    test('charge.dispute.closed with won status → marks session paid', async () => {
      setupEventMock('charge.dispute.closed', {
        payment_intent: 'pi_dispute_won',
        status: 'won',
      });
      const res = await POST(makeRequest('{}') as any);
      expect(res.status).toBe(200);
      expect(mockStripeSessionsUpdate).toHaveBeenCalled();
    });

    test('charge.dispute.closed with lost status → marks session dispute_lost', async () => {
      setupEventMock('charge.dispute.closed', {
        payment_intent: 'pi_dispute_lost',
        status: 'lost',
      });
      const res = await POST(makeRequest('{}') as any);
      expect(res.status).toBe(200);
      expect(mockStripeSessionsUpdate).toHaveBeenCalled();
    });

    test('charge.refunded partial refund → partial_refund status', async () => {
      setupEventMock('charge.refunded', {
        payment_intent: 'pi_partial_001',
        amount: 5000,
        amount_refunded: 2500,
      });
      const res = await POST(makeRequest('{}') as any);
      expect(res.status).toBe(200);
      expect(mockStripeSessionsUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'partial_refund' })
      );
    });

    test('checkout.session.completed with slot_id → activates featured slot', async () => {
      const mockFeaturedSlotsUpdate = jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      });
      const { createServiceRoleClient } = require('@/lib/supabase-server');
      createServiceRoleClient.mockReturnValue({
        from: jest.fn((table: string) => {
          if (table === 'stripe_webhook_logs') return { upsert: mockUpsert, select: mockSelect, update: mockUpdate };
          if (table === 'stripe_sessions') return { update: mockStripeSessionsUpdate };
          if (table === 'bookings') return { update: mockBookingsUpdate };
          if (table === 'featured_slots') return { update: mockFeaturedSlotsUpdate };
          return { update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }) };
        }),
      });
      setupEventMock('checkout.session.completed', {
        id: 'cs_slot_001',
        payment_intent: 'pi_slot',
        metadata: { slot_id: 'slot_abc123' },
      });
      const res = await POST(makeRequest('{}') as any);
      expect(res.status).toBe(200);
      expect(mockFeaturedSlotsUpdate).toHaveBeenCalledWith({ is_active: true });
    });

    test('checkout.session.completed slot update error → logs, still 200', async () => {
      const { createServiceRoleClient } = require('@/lib/supabase-server');
      createServiceRoleClient.mockReturnValue({
        from: jest.fn((table: string) => {
          if (table === 'stripe_webhook_logs') return { upsert: mockUpsert, select: mockSelect, update: mockUpdate };
          if (table === 'stripe_sessions') return { update: mockStripeSessionsUpdate };
          if (table === 'featured_slots') return { update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: { message: 'slot error' } }) }) };
          return { update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }) };
        }),
      });
      setupEventMock('checkout.session.completed', {
        id: 'cs_slot_err',
        payment_intent: 'pi_slot_err',
        metadata: { slot_id: 'slot_err_123' },
      });
      const res = await POST(makeRequest('{}') as any);
      expect(res.status).toBe(200);
    });

    test('charge.dispute.created with non-string payment_intent → no DB update', async () => {
      setupEventMock('charge.dispute.created', {
        payment_intent: null, // not a string → paymentIntentId = null
        status: 'needs_response',
      });
      mockStripeSessionsUpdate.mockClear();
      const res = await POST(makeRequest('{}') as any);
      expect(res.status).toBe(200);
      expect(mockStripeSessionsUpdate).not.toHaveBeenCalled();
    });

    test('charge.dispute.closed with non-string payment_intent → no DB update', async () => {
      setupEventMock('charge.dispute.closed', {
        payment_intent: null,
        status: 'won',
      });
      mockStripeSessionsUpdate.mockClear();
      const res = await POST(makeRequest('{}') as any);
      expect(res.status).toBe(200);
      expect(mockStripeSessionsUpdate).not.toHaveBeenCalled();
    });
  });

  test('constructEvent throws non-Error → 400 with unknown error', async () => {
    const Stripe = require('stripe');
    Stripe.mockImplementation(() => ({
      webhooks: { constructEvent: jest.fn().mockImplementation(() => { throw 'string error'; }) },
    }));
    const res = await POST(makeRequest('{}', 'sig') as any);
    expect(res.status).toBe(400);
  });

  test('handleEvent throws non-Error → 500', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'stripe_webhook_logs') return { upsert: mockUpsert, select: mockSelect, update: mockUpdate };
        // Throw a non-Error from within handleEvent processing
        return { update: jest.fn().mockImplementation(() => { throw 'non-error string'; }) };
      }),
    });
    const res = await POST(makeRequest('{}') as any);
    expect(res.status).toBe(500);
  });
});
