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
 *   - affected-rows 検証（.select('id') の0行分岐＝異常/冪等リトライの切り分け）
 */

jest.mock('stripe');
jest.mock('@/lib/supabase-server');
jest.mock('@/lib/audit-logger');

const mockAlertCaughtError = jest.fn();
jest.mock('@/lib/alert', () => ({
  alertCaughtError: (...args: unknown[]) => mockAlertCaughtError(...args),
}));

import { POST } from '../route';

let mockUpsert: jest.Mock;
let mockSelect: jest.Mock;
let mockUpdate: jest.Mock;
let mockConstructEvent: jest.Mock;
let mockWriteAuditLog: jest.Mock;

type ChainResult = { error: unknown; data?: unknown };

// チェイン段数に依存しないモック結果。
// 実装の stripe_sessions / featured_slots 更新は .eq().select('id') の単段、
// deposit-bookings 更新は .eq().eq().select('id') の2段で await する。.eq() / .select() を
// 何回チェーンしても同じ result に解決する thenable を返すため、段数の違いを吸収できる
// （旧テストが2段固定モックだったために単段 .eq() の await で偽陽性になっていた敵対監査
// テスト-2 の教訓を踏襲）。data を省略すると [{ id: 'row-1' }]（affected-rows チェックを
// 素通りする既定の1行成功）になる。0行を模すときは data: null または data: [] を明示する。
function chainableResult(result: ChainResult): { then: (r: (v: unknown) => void) => void; eq: jest.Mock; select: jest.Mock } {
  return {
    then: (resolve: (v: unknown) => void) => resolve(result),
    eq: jest.fn(() => chainableResult(result)),
    select: jest.fn(() => chainableResult(result)),
  };
}
function chainableUpdate(result: ChainResult = { error: null }): jest.Mock {
  const normalized: ChainResult = {
    error: result.error ?? null,
    data: 'data' in result ? result.data : [{ id: 'row-1' }],
  };
  return jest.fn(() => ({ eq: jest.fn(() => chainableResult(normalized)) }));
}

/**
 * bookings.select('status').eq('id', ...).maybeSingle() の模倣。
 * deposit / cancel_fee の 0 行フォールバック（冪等リトライ判定）で使う。
 */
function selectStatusChain(data: { status: string } | null, error: unknown = null): jest.Mock {
  return jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      maybeSingle: jest.fn().mockResolvedValue({ data, error }),
    }),
  });
}

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
    update: chainableUpdate({ error: null }),
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      }),
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
        return { update: chainableUpdate({ error: { message: 'DB error' } }) };
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
        apiVersion: '2026-06-24.dahlia',
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

    const mockStripeSessionsUpdate = chainableUpdate({ error: null });
    const mockBookingsUpdate = chainableUpdate({ error: null });
    const mockFeaturedSlotsUpdate = chainableUpdate({ error: null });

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
            return { update: mockBookingsUpdate, select: selectStatusChain(null) };
          }
          if (table === 'featured_slots') {
            return { update: mockFeaturedSlotsUpdate };
          }
          return {
            update: chainableUpdate({ error: null }),
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
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
          if (table === 'bookings') return { update: chainableUpdate({ error: { message: 'deposit confirm failed' } }) };
          return { update: chainableUpdate({ error: null }) };
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
          if (table === 'bookings') return { update: chainableUpdate({ error: { message: 'cancel_fee update failed' } }) };
          return { update: chainableUpdate({ error: null }) };
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
          if (table === 'featured_slots') return { update: chainableUpdate({ error: { message: 'slot error' } }) };
          return { update: chainableUpdate({ error: null }) };
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

    // 以下は本PRで追加した「error 捕捉 → throw → 500」の検証（無音欠落の根治を保証）。
    // CHECK 制約違反等で stripe_sessions / bookings 更新が失敗した場合に、
    // 旧実装は error を捨てて 200 を返していたが、修正後は 500 を返し Stripe にリトライさせる。
    function mockWith(errorTable: 'stripe_sessions' | 'bookings') {
      const { createServiceRoleClient } = require('@/lib/supabase-server');
      createServiceRoleClient.mockReturnValue({
        from: jest.fn((table: string) => {
          if (table === 'stripe_webhook_logs') return { upsert: mockUpsert, select: mockSelect, update: mockUpdate };
          if (table === 'stripe_sessions') return { update: chainableUpdate({ error: errorTable === 'stripe_sessions' ? { message: 'session check violation' } : null }) };
          if (table === 'bookings') return { update: chainableUpdate({ error: errorTable === 'bookings' ? { message: 'booking check violation' } : null }) };
          return { update: chainableUpdate({ error: null }) };
        }),
      });
    }

    test('charge.refunded stripe_sessions update error → 500（無音欠落しない）', async () => {
      mockWith('stripe_sessions');
      setupEventMock('charge.refunded', { payment_intent: 'pi_refund_err', amount: 5000, amount_refunded: 2500 });
      const res = await POST(makeRequest('{}') as any);
      expect(res.status).toBe(500);
    });

    test('charge.dispute.created stripe_sessions update error → 500', async () => {
      mockWith('stripe_sessions');
      setupEventMock('charge.dispute.created', { payment_intent: 'pi_disp_serr', status: 'needs_response' });
      const res = await POST(makeRequest('{}') as any);
      expect(res.status).toBe(500);
    });

    test('charge.dispute.created bookings update error → 500', async () => {
      mockWith('bookings');
      setupEventMock('charge.dispute.created', { payment_intent: 'pi_disp_berr', status: 'needs_response' });
      const res = await POST(makeRequest('{}') as any);
      expect(res.status).toBe(500);
    });

    test('charge.dispute.closed stripe_sessions update error → 500', async () => {
      mockWith('stripe_sessions');
      setupEventMock('charge.dispute.closed', { payment_intent: 'pi_disp_cserr', status: 'lost' });
      const res = await POST(makeRequest('{}') as any);
      expect(res.status).toBe(500);
    });

    test('charge.dispute.closed bookings update error → 500', async () => {
      mockWith('bookings');
      setupEventMock('charge.dispute.closed', { payment_intent: 'pi_disp_cberr', status: 'lost' });
      const res = await POST(makeRequest('{}') as any);
      expect(res.status).toBe(500);
    });

    // ─── affected-rows チェック（.select('id') 追加分）の 0 行分岐 ───
    // stripe_sessions に行を作るのは booking 系フロー（payment/checkout・stripe/checkout）のみ。
    // featured-ads（metadata=slot_id）・options/checkout（metadata=option_key）は行を作らないため、
    // 0 行の異常判定は【meta.booking_id がある場合のみ】throw し、無い場合は console.warn で継続する。

    /** stripe_sessions 更新が0行を返す状況の共通セットアップ。 */
    function setupSessionZeroRows(updateData: unknown, slotUpdate?: jest.Mock) {
      const { createServiceRoleClient } = require('@/lib/supabase-server');
      createServiceRoleClient.mockReturnValue({
        from: jest.fn((table: string) => {
          if (table === 'stripe_webhook_logs') return { upsert: mockUpsert, select: mockSelect, update: mockUpdate };
          if (table === 'stripe_sessions') return { update: chainableUpdate({ error: null, data: updateData }) };
          if (table === 'featured_slots' && slotUpdate) return { update: slotUpdate };
          return { update: chainableUpdate({ error: null }) };
        }),
      });
    }

    test('stripe_sessions 0行更新（data:null・booking_id あり）→ throw→500（作成済みのはずの行が無い異常）', async () => {
      setupSessionZeroRows(null);
      setupEventMock('checkout.session.completed', {
        id: 'cs_0rows_null',
        payment_intent: 'pi_0rows_null',
        metadata: { booking_id: 'bk_sess_0rows_null' },
      });
      const res = await POST(makeRequest('{}') as any);
      expect(res.status).toBe(500);
      expect(mockAlertCaughtError).toHaveBeenCalledWith(
        'stripe-webhook-handler',
        expect.any(Error),
        '/api/stripe/webhook',
      );
    });

    test('stripe_sessions 0行更新（data:[]・booking_id あり）→ throw→500', async () => {
      setupSessionZeroRows([]);
      setupEventMock('checkout.session.completed', {
        id: 'cs_0rows_empty',
        payment_intent: 'pi_0rows_empty',
        metadata: { booking_id: 'bk_sess_0rows_empty' },
      });
      const res = await POST(makeRequest('{}') as any);
      expect(res.status).toBe(500);
    });

    test('stripe_sessions 0行更新・slot_id のみ（booking_id 無し＝featured-ads決済）→ 200 かつ featured_slots が有効化される', async () => {
      // 敵対検証で確定した構造バグの回帰テスト：featured-ads / options 由来の checkout は
      // stripe_sessions に行が無く 0 行が【正常系】。無条件 throw だと 500→Stripe 再送ループになり
      // featured_slots 有効化コードに永久に到達しない（広告枠が is_active=false のまま）。
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const slotUpdate = chainableUpdate({ error: null });
      setupSessionZeroRows(null, slotUpdate);
      setupEventMock('checkout.session.completed', {
        id: 'cs_ad_slot_only',
        payment_intent: 'pi_ad_slot_only',
        metadata: { slot_id: 'slot_ad_001', facility_id: 'fac-1' },
      });
      const res = await POST(makeRequest('{}') as any);
      expect(res.status).toBe(200);
      // 0 行でも throw せず featured_slots 有効化に正常到達すること
      expect(slotUpdate).toHaveBeenCalledWith({ is_active: true });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('stripe_sessions update matched 0 rows (non-booking checkout; continuing)'),
        expect.objectContaining({ sessionId: 'cs_ad_slot_only' }),
      );
      warnSpy.mockRestore();
    });

    test('stripe_sessions 0行更新（data:[]）・option_key のみ（booking_id 無し＝オプション決済）→ 200 で継続', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      setupSessionZeroRows([]);
      setupEventMock('checkout.session.completed', {
        id: 'cs_option_only',
        payment_intent: 'pi_option_only',
        metadata: { option_key: 'reminder_line', facility_id: 'fac-1' },
      });
      const res = await POST(makeRequest('{}') as any);
      expect(res.status).toBe(200);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('non-booking checkout; continuing'),
        expect.objectContaining({ sessionId: 'cs_option_only' }),
      );
      warnSpy.mockRestore();
    });

    function setupDepositZeroRows(opts: { updateData: unknown; currentStatus: { status: string } | null; currentStatusError?: unknown }) {
      const { createServiceRoleClient } = require('@/lib/supabase-server');
      createServiceRoleClient.mockReturnValue({
        from: jest.fn((table: string) => {
          if (table === 'stripe_webhook_logs') return { upsert: mockUpsert, select: mockSelect, update: mockUpdate };
          if (table === 'stripe_sessions') return { update: chainableUpdate({ error: null }) };
          if (table === 'bookings') {
            return {
              update: chainableUpdate({ error: null, data: opts.updateData }),
              select: selectStatusChain(opts.currentStatus, opts.currentStatusError ?? null),
            };
          }
          return { update: chainableUpdate({ error: null }) };
        }),
      });
    }

    test('deposit 0行更新（data:null）・現在status=confirmed（冪等リトライ）→ 200で正常継続', async () => {
      setupDepositZeroRows({ updateData: null, currentStatus: { status: 'confirmed' } });
      setupEventMock('checkout.session.completed', {
        id: 'cs_dep_idem_null',
        payment_intent: 'pi_dep_idem_null',
        metadata: { booking_id: 'bk_dep_idem_null', payment_type: 'deposit' },
      });
      const res = await POST(makeRequest('{}') as any);
      expect(res.status).toBe(200);
      expect(mockAlertCaughtError).not.toHaveBeenCalledWith(
        'stripe-webhook-deposit-confirm-0rows',
        expect.anything(),
        expect.anything(),
      );
    });

    test('deposit 0行更新（data:[]）・現在status=confirmed（冪等リトライ）→ 200で正常継続', async () => {
      setupDepositZeroRows({ updateData: [], currentStatus: { status: 'confirmed' } });
      setupEventMock('checkout.session.completed', {
        id: 'cs_dep_idem_empty',
        payment_intent: 'pi_dep_idem_empty',
        metadata: { booking_id: 'bk_dep_idem_empty', payment_type: 'deposit' },
      });
      const res = await POST(makeRequest('{}') as any);
      expect(res.status).toBe(200);
    });

    test('deposit 0行更新・現在statusがconfirmed以外（想定外）→ alertCaughtError通知＋throw→500', async () => {
      setupDepositZeroRows({ updateData: [], currentStatus: { status: 'pending' } });
      setupEventMock('checkout.session.completed', {
        id: 'cs_dep_anomaly',
        payment_intent: 'pi_dep_anomaly',
        metadata: { booking_id: 'bk_dep_anomaly', payment_type: 'deposit' },
      });
      const res = await POST(makeRequest('{}') as any);
      expect(res.status).toBe(500);
      expect(mockAlertCaughtError).toHaveBeenCalledWith(
        'stripe-webhook-deposit-confirm-0rows',
        expect.any(Error),
        '/api/stripe/webhook',
      );
    });

    test('deposit 0行更新・booking不存在（current:null）→ alertCaughtError通知（not_found表記）＋throw→500', async () => {
      setupDepositZeroRows({ updateData: null, currentStatus: null });
      setupEventMock('checkout.session.completed', {
        id: 'cs_dep_notfound',
        payment_intent: 'pi_dep_notfound',
        metadata: { booking_id: 'bk_dep_notfound', payment_type: 'deposit' },
      });
      const res = await POST(makeRequest('{}') as any);
      expect(res.status).toBe(500);
      expect(mockAlertCaughtError).toHaveBeenCalledWith(
        'stripe-webhook-deposit-confirm-0rows',
        expect.objectContaining({ message: expect.stringContaining('current_status=not_found') }),
        '/api/stripe/webhook',
      );
    });

    test('deposit 0行更新・切り分けSELECT自体が失敗 → alertCaughtError通知（select_failed表記で区別）＋throw→500', async () => {
      // SELECT エラーを握り潰すと「not_found」と誤認してトリアージを誤導するため、
      // select_failed: <message> として区別して通知する（挙動は alert＋throw のまま不変）。
      setupDepositZeroRows({ updateData: [], currentStatus: null, currentStatusError: { message: 'connection reset' } });
      setupEventMock('checkout.session.completed', {
        id: 'cs_dep_selerr',
        payment_intent: 'pi_dep_selerr',
        metadata: { booking_id: 'bk_dep_selerr', payment_type: 'deposit' },
      });
      const res = await POST(makeRequest('{}') as any);
      expect(res.status).toBe(500);
      expect(mockAlertCaughtError).toHaveBeenCalledWith(
        'stripe-webhook-deposit-confirm-0rows',
        expect.objectContaining({ message: expect.stringContaining('current_status=select_failed: connection reset') }),
        '/api/stripe/webhook',
      );
    });

    // cancel_fee の update は .eq('id', ...)（PK）のみで CAS が無いため、冪等リトライでも行が存在する
    // 限り必ず 1 行 match する。0 行になり得るのは【booking 不存在】のみ（冪等継続分岐は到達不能のため
    // 実装から撤去済み）。
    function setupCancelFeeZeroRows(updateData: unknown) {
      const { createServiceRoleClient } = require('@/lib/supabase-server');
      createServiceRoleClient.mockReturnValue({
        from: jest.fn((table: string) => {
          if (table === 'stripe_webhook_logs') return { upsert: mockUpsert, select: mockSelect, update: mockUpdate };
          if (table === 'stripe_sessions') return { update: chainableUpdate({ error: null }) };
          if (table === 'bookings') {
            return { update: chainableUpdate({ error: null, data: updateData }) };
          }
          return { update: chainableUpdate({ error: null }) };
        }),
      });
    }

    test('cancel_fee 0行更新（data:null）＝booking不存在 → alertCaughtError通知＋throw→500', async () => {
      setupCancelFeeZeroRows(null);
      setupEventMock('checkout.session.completed', {
        id: 'cs_cf_notfound_null',
        payment_intent: 'pi_cf_notfound_null',
        metadata: { booking_id: 'bk_cf_notfound_null', payment_type: 'cancel_fee' },
      });
      const res = await POST(makeRequest('{}') as any);
      expect(res.status).toBe(500);
      expect(mockAlertCaughtError).toHaveBeenCalledWith(
        'stripe-webhook-cancel-fee-0rows',
        expect.objectContaining({ message: expect.stringContaining('booking not found (booking_id=bk_cf_notfound_null)') }),
        '/api/stripe/webhook',
      );
    });

    test('cancel_fee 0行更新（data:[]）＝booking不存在 → alertCaughtError通知＋throw→500', async () => {
      setupCancelFeeZeroRows([]);
      setupEventMock('checkout.session.completed', {
        id: 'cs_cf_notfound_empty',
        payment_intent: 'pi_cf_notfound_empty',
        metadata: { booking_id: 'bk_cf_notfound_empty', payment_type: 'cancel_fee' },
      });
      const res = await POST(makeRequest('{}') as any);
      expect(res.status).toBe(500);
      expect(mockAlertCaughtError).toHaveBeenCalledWith(
        'stripe-webhook-cancel-fee-0rows',
        expect.any(Error),
        '/api/stripe/webhook',
      );
    });

    test('featured_slots 0行更新（data:null）→ console.error のみ・200のまま（挙動不変）', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const { createServiceRoleClient } = require('@/lib/supabase-server');
      createServiceRoleClient.mockReturnValue({
        from: jest.fn((table: string) => {
          if (table === 'stripe_webhook_logs') return { upsert: mockUpsert, select: mockSelect, update: mockUpdate };
          if (table === 'stripe_sessions') return { update: chainableUpdate({ error: null }) };
          if (table === 'featured_slots') return { update: chainableUpdate({ error: null, data: null }) };
          return { update: chainableUpdate({ error: null }) };
        }),
      });
      setupEventMock('checkout.session.completed', {
        id: 'cs_slot_0rows_null',
        payment_intent: 'pi_slot_0rows_null',
        metadata: { slot_id: 'slot_missing_null' },
      });
      const res = await POST(makeRequest('{}') as any);
      expect(res.status).toBe(200);
      expect(errorSpy).toHaveBeenCalledWith(
        '[stripe/webhook] featured_slot activate matched 0 rows',
        expect.objectContaining({ slotId: 'slot_missing_null' }),
      );
      errorSpy.mockRestore();
    });

    test('featured_slots 0行更新（data:[]）→ console.error のみ・200のまま（挙動不変）', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const { createServiceRoleClient } = require('@/lib/supabase-server');
      createServiceRoleClient.mockReturnValue({
        from: jest.fn((table: string) => {
          if (table === 'stripe_webhook_logs') return { upsert: mockUpsert, select: mockSelect, update: mockUpdate };
          if (table === 'stripe_sessions') return { update: chainableUpdate({ error: null }) };
          if (table === 'featured_slots') return { update: chainableUpdate({ error: null, data: [] }) };
          return { update: chainableUpdate({ error: null }) };
        }),
      });
      setupEventMock('checkout.session.completed', {
        id: 'cs_slot_0rows_empty',
        payment_intent: 'pi_slot_0rows_empty',
        metadata: { slot_id: 'slot_missing_empty' },
      });
      const res = await POST(makeRequest('{}') as any);
      expect(res.status).toBe(200);
      expect(errorSpy).toHaveBeenCalledWith(
        '[stripe/webhook] featured_slot activate matched 0 rows',
        expect.objectContaining({ slotId: 'slot_missing_empty' }),
      );
      errorSpy.mockRestore();
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
