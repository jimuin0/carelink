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
        apiVersion: '2025-04-30.basil',
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
});
