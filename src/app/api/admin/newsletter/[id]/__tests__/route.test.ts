/**
 * @jest-environment node
 *
 * Tests for PATCH /api/admin/newsletter/[id]
 * Coverage targets:
 *   - Guards: CSRF, rate limit, UUID, platform-admin, campaign not found, unknown action
 *   - action=cancel: state machine (scheduled→cancelled, non-scheduled→400)
 *   - action=schedule: state machine (draft→scheduled, non-draft→400)
 *   - action=send: status guard, CAS double-send prevention (409), batch send,
 *     sentCount/bouncedCount, resend error handling, owner_monthly owners,
 *     audit log, empty subscribers, chunked batches (>100)
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({
  writeAuditLog: jest.fn(),
  getRequestContext: jest.fn(() => ({ ua: 'test-agent' })),
}));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));
jest.mock('@/lib/email', () => ({ escSubject: jest.fn((s: string) => s) }));
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    batch: { send: jest.fn(() => Promise.resolve({ data: [], error: null })) },
  })),
}));

const CAMPAIGN_UUID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_ID = '33333333-3333-3333-3333-333333333333';

const mockAdminFrom = jest.fn();
const mockAnonFrom = jest.fn();
const mockGetUser = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom }),
}));

import { NextRequest } from 'next/server';
import { PATCH } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(body?: object) {
  return new NextRequest(`http://localhost/api/admin/newsletter/${CAMPAIGN_UUID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : '{}',
  });
}

function makeProps(id = CAMPAIGN_UUID) {
  return { params: Promise.resolve({ id }) };
}

/** Anon client chain for profiles.is_platform_admin */
function profileChain(isAdmin: boolean) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data: { is_platform_admin: isAdmin }, error: null })),
  };
}

/** Admin client chain for fetching a single campaign */
function campaignFetchChain(data: unknown, fetchError: unknown = null) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: fetchError })),
  };
}

/** Default campaign shape */
function buildCampaign(overrides: Record<string, unknown> = {}) {
  return {
    id: CAMPAIGN_UUID,
    status: 'draft',
    campaign_type: 'user_digest',
    subject: 'Test Subject',
    html_content: '<h1>Hello</h1>',
    text_content: 'Hello',
    ...overrides,
  };
}

/**
 * Chain for update().eq().select().single() — used by cancel/schedule.
 * Returns the provided `updated` object from single().
 */
function updateSingleChain(updated: unknown) {
  return {
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn(() => Promise.resolve({ data: updated, error: null })),
        }),
      }),
    }),
  };
}

/**
 * Chain for the atomic-claim update used by the send action.
 * update().eq().in().select() → resolves with { data: claimed }
 */
function atomicClaimChain(claimed: unknown[] | null) {
  return {
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        in: jest.fn().mockReturnValue({
          select: jest.fn(() => Promise.resolve({ data: claimed })),
        }),
      }),
    }),
  };
}

/**
 * Chain for newsletter_subscriptions.select().or().eq() → resolves with { data: subscribers }
 */
function subscribersChain(subscribers: { email: string; user_id: string }[]) {
  return {
    select: jest.fn().mockReturnThis(),
    or: jest.fn().mockReturnThis(),
    eq: jest.fn(() => Promise.resolve({ data: subscribers, error: null })),
  };
}

/**
 * Chain for facility_members.select().eq() → resolves with { data: owners }
 */
function facilityMembersChain(owners: { profiles: { email: string } | null }[]) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn(() => Promise.resolve({ data: owners, error: null })),
  };
}

/**
 * Chain for final update of campaign to 'sent' status.
 * update().eq().select().single()
 */
function updateSentChain(updated: unknown) {
  return {
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn(() => Promise.resolve({ data: updated, error: null })),
        }),
      }),
    }),
  };
}

// ─── beforeEach ───────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  process.env.NEWSLETTER_UNSUBSCRIBE_SECRET = 'test-secret';
  process.env.RESEND_API_KEY = 'test-resend-key';
});

// ─── describe blocks ──────────────────────────────────────────────────────────

describe('PATCH /api/admin/newsletter/[id]', () => {

  describe('guards', () => {
    test('CSRF fail → error response', async () => {
      const { checkCsrf } = require('@/lib/csrf');
      (checkCsrf as jest.Mock).mockReturnValueOnce(
        new Response(JSON.stringify({ error: '不正なリクエストです' }), { status: 403 }),
      );
      const res = await PATCH(makeRequest({ action: 'cancel' }), makeProps());
      expect(res.status).toBe(403);
    });

    test('rate limiting → 429', async () => {
      (checkRateLimit as jest.Mock).mockReturnValue(true);
      const res = await PATCH(makeRequest({ action: 'cancel' }), makeProps());
      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.error).toMatch(/Too Many Requests/i);
    });

    test('invalid UUID → 400', async () => {
      const res = await PATCH(makeRequest({ action: 'cancel' }), makeProps('not-a-uuid'));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBeDefined();
    });

    test('non-platform-admin → 403', async () => {
      mockAnonFrom.mockReturnValue(profileChain(false));
      const res = await PATCH(makeRequest({ action: 'cancel' }), makeProps());
      expect(res.status).toBe(403);
    });

    test('no user → 403', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });
      const res = await PATCH(makeRequest({ action: 'cancel' }), makeProps());
      expect(res.status).toBe(403);
    });

    test('campaign not found → 404', async () => {
      mockAnonFrom.mockReturnValue(profileChain(true));
      mockAdminFrom.mockReturnValue(campaignFetchChain(null, { message: 'not found' }));
      const res = await PATCH(makeRequest({ action: 'cancel' }), makeProps());
      expect(res.status).toBe(404);
    });

    test('unknown action → 400', async () => {
      mockAnonFrom.mockReturnValue(profileChain(true));
      mockAdminFrom.mockReturnValue(campaignFetchChain(buildCampaign()));
      const res = await PATCH(makeRequest({ action: 'reopen' }), makeProps());
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/unknown action/i);
    });

    test('不正な JSON body → action undefined → 400 (unknown action)', async () => {
      mockAnonFrom.mockReturnValue(profileChain(true));
      mockAdminFrom.mockReturnValue(campaignFetchChain(buildCampaign()));
      const req = new NextRequest(`http://localhost/api/admin/newsletter/${CAMPAIGN_UUID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      });
      const res = await PATCH(req, makeProps());
      expect(res.status).toBe(400);
    });
  });

  // ─── cancel ─────────────────────────────────────────────────────────────────

  describe('action=cancel', () => {
    test('scheduled campaign → 200 with cancelled campaign', async () => {
      mockAnonFrom.mockReturnValue(profileChain(true));
      let callNum = 0;
      mockAdminFrom.mockImplementation(() => {
        callNum++;
        if (callNum === 1) return campaignFetchChain(buildCampaign({ status: 'scheduled' }));
        return updateSingleChain({ id: CAMPAIGN_UUID, status: 'cancelled' });
      });
      const res = await PATCH(makeRequest({ action: 'cancel' }), makeProps());
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.campaign).toBeDefined();
    });

    test('draft campaign → 400 (not scheduled)', async () => {
      mockAnonFrom.mockReturnValue(profileChain(true));
      mockAdminFrom.mockReturnValue(campaignFetchChain(buildCampaign({ status: 'draft' })));
      const res = await PATCH(makeRequest({ action: 'cancel' }), makeProps());
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/scheduled/i);
    });

    test('sent campaign → 400', async () => {
      mockAnonFrom.mockReturnValue(profileChain(true));
      mockAdminFrom.mockReturnValue(campaignFetchChain(buildCampaign({ status: 'sent' })));
      const res = await PATCH(makeRequest({ action: 'cancel' }), makeProps());
      expect(res.status).toBe(400);
    });

    test('updates campaign status to cancelled', async () => {
      mockAnonFrom.mockReturnValue(profileChain(true));
      const updatedCampaign = { id: CAMPAIGN_UUID, status: 'cancelled' };
      let callNum = 0;
      mockAdminFrom.mockImplementation(() => {
        callNum++;
        if (callNum === 1) return campaignFetchChain(buildCampaign({ status: 'scheduled' }));
        return updateSingleChain(updatedCampaign);
      });
      const res = await PATCH(makeRequest({ action: 'cancel' }), makeProps());
      const json = await res.json();
      expect(json.campaign.status).toBe('cancelled');
      expect(json.campaign.id).toBe(CAMPAIGN_UUID);
    });
  });

  // ─── schedule ───────────────────────────────────────────────────────────────

  describe('action=schedule', () => {
    test('draft campaign → 200 with scheduled campaign', async () => {
      mockAnonFrom.mockReturnValue(profileChain(true));
      let callNum = 0;
      mockAdminFrom.mockImplementation(() => {
        callNum++;
        if (callNum === 1) return campaignFetchChain(buildCampaign({ status: 'draft' }));
        return updateSingleChain({ id: CAMPAIGN_UUID, status: 'scheduled' });
      });
      const res = await PATCH(makeRequest({ action: 'schedule' }), makeProps());
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.campaign).toBeDefined();
    });

    test('scheduled campaign → 400 (not draft)', async () => {
      mockAnonFrom.mockReturnValue(profileChain(true));
      mockAdminFrom.mockReturnValue(campaignFetchChain(buildCampaign({ status: 'scheduled' })));
      const res = await PATCH(makeRequest({ action: 'schedule' }), makeProps());
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/draft/i);
    });

    test('updates campaign status to scheduled', async () => {
      mockAnonFrom.mockReturnValue(profileChain(true));
      const updatedCampaign = { id: CAMPAIGN_UUID, status: 'scheduled' };
      let callNum = 0;
      mockAdminFrom.mockImplementation(() => {
        callNum++;
        if (callNum === 1) return campaignFetchChain(buildCampaign({ status: 'draft' }));
        return updateSingleChain(updatedCampaign);
      });
      const res = await PATCH(makeRequest({ action: 'schedule' }), makeProps());
      const json = await res.json();
      expect(json.campaign.status).toBe('scheduled');
    });
  });

  // ─── send ────────────────────────────────────────────────────────────────────

  describe('action=send', () => {
    /** Build a standard send-flow mockAdminFrom with configurable subscribers */
    function buildSendMocks(opts: {
      campaignOverrides?: Record<string, unknown>;
      subscribers?: { email: string; user_id: string }[];
      claimedRows?: { id: string }[] | null;
      sentCampaign?: unknown;
    } = {}) {
      const {
        campaignOverrides = {},
        subscribers = [{ email: 'user1@example.com', user_id: 'uid-1' }],
        claimedRows = [{ id: CAMPAIGN_UUID }],
        sentCampaign = { id: CAMPAIGN_UUID, status: 'sent' },
      } = opts;

      const campaign = buildCampaign(campaignOverrides);
      let callNum = 0;
      mockAdminFrom.mockImplementation((table: string) => {
        callNum++;
        // 1st call: fetch campaign
        if (callNum === 1) return campaignFetchChain(campaign);
        // 2nd call: atomic claim (update to 'sending')
        if (callNum === 2) return atomicClaimChain(claimedRows);
        // 3rd call: newsletter_subscriptions
        if (callNum === 3) return subscribersChain(subscribers);
        // 4th call: update campaign to 'sent'
        return updateSentChain(sentCampaign);
      });
    }

    test('already sent → 400', async () => {
      mockAnonFrom.mockReturnValue(profileChain(true));
      mockAdminFrom.mockReturnValue(campaignFetchChain(buildCampaign({ status: 'sent' })));
      const res = await PATCH(makeRequest({ action: 'send' }), makeProps());
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBeDefined();
    });

    test('concurrent send (atomic claim empty) → 409', async () => {
      mockAnonFrom.mockReturnValue(profileChain(true));
      buildSendMocks({ claimedRows: [] });
      const res = await PATCH(makeRequest({ action: 'send' }), makeProps());
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error).toMatch(/already being sent/i);
    });

    test('draft campaign → sends successfully → 200 with sentCount', async () => {
      mockAnonFrom.mockReturnValue(profileChain(true));
      buildSendMocks({
        subscribers: [
          { email: 'a@example.com', user_id: 'u1' },
          { email: 'b@example.com', user_id: 'u2' },
        ],
      });
      const res = await PATCH(makeRequest({ action: 'send' }), makeProps());
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.sentCount).toBe(2);
    });

    test('scheduled campaign → sends successfully → 200', async () => {
      mockAnonFrom.mockReturnValue(profileChain(true));
      buildSendMocks({ campaignOverrides: { status: 'scheduled' } });
      const res = await PATCH(makeRequest({ action: 'send' }), makeProps());
      expect(res.status).toBe(200);
    });

    test('sends via resend.batch.send', async () => {
      mockAnonFrom.mockReturnValue(profileChain(true));
      buildSendMocks({
        subscribers: [{ email: 'c@example.com', user_id: 'u3' }],
      });
      const { Resend } = require('resend');
      const mockBatchSend = jest.fn().mockResolvedValue({ data: [], error: null });
      Resend.mockImplementationOnce(() => ({ batch: { send: mockBatchSend } }));

      await PATCH(makeRequest({ action: 'send' }), makeProps());
      expect(mockBatchSend).toHaveBeenCalledTimes(1);
      const [messages] = mockBatchSend.mock.calls[0];
      expect(messages[0].to).toEqual(['c@example.com']);
      expect(messages[0].from).toContain('newsletter@carelink-jp.com');
    });

    test('returns sentCount and bouncedCount', async () => {
      mockAnonFrom.mockReturnValue(profileChain(true));
      buildSendMocks({
        subscribers: [
          { email: 'd@example.com', user_id: 'u4' },
          { email: 'e@example.com', user_id: 'u5' },
        ],
      });
      const res = await PATCH(makeRequest({ action: 'send' }), makeProps());
      const json = await res.json();
      expect(typeof json.sentCount).toBe('number');
      expect(typeof json.bouncedCount).toBe('number');
    });

    test('resend error → bouncedCount incremented', async () => {
      mockAnonFrom.mockReturnValue(profileChain(true));
      buildSendMocks({
        subscribers: [
          { email: 'fail1@example.com', user_id: 'u6' },
          { email: 'fail2@example.com', user_id: 'u7' },
        ],
      });
      const { Resend } = require('resend');
      Resend.mockImplementationOnce(() => ({
        batch: { send: jest.fn().mockRejectedValue(new Error('Resend failure')) },
      }));

      const res = await PATCH(makeRequest({ action: 'send' }), makeProps());
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.bouncedCount).toBe(2);
      expect(json.sentCount).toBe(0);
    });

    test('owner_monthly type also fetches owner emails', async () => {
      mockAnonFrom.mockReturnValue(profileChain(true));
      const ownerEmail = 'owner@salon.com';
      let callNum = 0;
      mockAdminFrom.mockImplementation(() => {
        callNum++;
        if (callNum === 1) return campaignFetchChain(buildCampaign({ campaign_type: 'owner_monthly' }));
        if (callNum === 2) return atomicClaimChain([{ id: CAMPAIGN_UUID }]);
        // newsletter_subscriptions (may return empty or a subscription)
        if (callNum === 3) return subscribersChain([]);
        // facility_members query
        if (callNum === 4) return facilityMembersChain([{ profiles: { email: ownerEmail } }]);
        // final update to 'sent'
        return updateSentChain({ id: CAMPAIGN_UUID, status: 'sent' });
      });

      const { Resend } = require('resend');
      const mockBatchSend = jest.fn().mockResolvedValue({ data: [], error: null });
      Resend.mockImplementationOnce(() => ({ batch: { send: mockBatchSend } }));

      const res = await PATCH(makeRequest({ action: 'send' }), makeProps());
      expect(res.status).toBe(200);
      const json = await res.json();
      // Owner email should have been sent
      expect(json.sentCount).toBe(1);
      expect(mockBatchSend).toHaveBeenCalledTimes(1);
      const [messages] = mockBatchSend.mock.calls[0];
      expect(messages[0].to).toContain(ownerEmail);
    });

    test('writes audit log on successful send', async () => {
      mockAnonFrom.mockReturnValue(profileChain(true));
      buildSendMocks({
        subscribers: [{ email: 'audit@example.com', user_id: 'u8' }],
      });
      const { writeAuditLog } = require('@/lib/audit-logger');
      await PATCH(makeRequest({ action: 'send' }), makeProps());
      // writeAuditLog is called with void so allow a tick
      await new Promise((r) => setTimeout(r, 10));
      expect(writeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: USER_ID,
          action: 'create',
          tableName: 'newsletter_campaigns',
          recordId: CAMPAIGN_UUID,
        }),
      );
    });

    test('empty subscriber list → sentCount=0', async () => {
      mockAnonFrom.mockReturnValue(profileChain(true));
      buildSendMocks({ subscribers: [] });
      const res = await PATCH(makeRequest({ action: 'send' }), makeProps());
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.sentCount).toBe(0);
      expect(json.bouncedCount).toBe(0);
    });

    test('claimed=null (not just []) → 409', async () => {
      mockAnonFrom.mockReturnValue(profileChain(true));
      buildSendMocks({ claimedRows: null });
      const res = await PATCH(makeRequest({ action: 'send' }), makeProps());
      expect(res.status).toBe(409);
    });

    test('owner_monthly: facility_members fetch error でも処理は続行 (ログのみ)', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      mockAnonFrom.mockReturnValue(profileChain(true));
      let callNum = 0;
      mockAdminFrom.mockImplementation(() => {
        callNum++;
        if (callNum === 1) return campaignFetchChain(buildCampaign({ campaign_type: 'owner_monthly' }));
        if (callNum === 2) return atomicClaimChain([{ id: CAMPAIGN_UUID }]);
        if (callNum === 3) return subscribersChain([{ email: 'sub@example.com', user_id: 'u1' }]);
        if (callNum === 4) return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn(() => Promise.resolve({ data: null, error: { message: 'fail' } })),
        };
        return updateSentChain({ id: CAMPAIGN_UUID, status: 'sent' });
      });
      const res = await PATCH(makeRequest({ action: 'send' }), makeProps());
      expect(res.status).toBe(200);
    });

    test('owner_monthly: profiles が配列形式', async () => {
      mockAnonFrom.mockReturnValue(profileChain(true));
      let callNum = 0;
      mockAdminFrom.mockImplementation(() => {
        callNum++;
        if (callNum === 1) return campaignFetchChain(buildCampaign({ campaign_type: 'owner_monthly' }));
        if (callNum === 2) return atomicClaimChain([{ id: CAMPAIGN_UUID }]);
        if (callNum === 3) return subscribersChain([]);
        if (callNum === 4) return facilityMembersChain([
          { profiles: [{ email: 'arr@example.com' }] as unknown as { email: string } },
          { profiles: null },
        ]);
        return updateSentChain({ id: CAMPAIGN_UUID, status: 'sent' });
      });
      const res = await PATCH(makeRequest({ action: 'send' }), makeProps());
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.sentCount).toBe(1);
    });

    test('text_content が空 → undefined として送信', async () => {
      mockAnonFrom.mockReturnValue(profileChain(true));
      buildSendMocks({
        campaignOverrides: { text_content: null },
        subscribers: [{ email: 'x@example.com', user_id: 'u1' }],
      });
      const { Resend } = require('resend');
      const mockBatchSend = jest.fn().mockResolvedValue({ data: [], error: null });
      Resend.mockImplementationOnce(() => ({ batch: { send: mockBatchSend } }));
      const res = await PATCH(makeRequest({ action: 'send' }), makeProps());
      expect(res.status).toBe(200);
      const [messages] = mockBatchSend.mock.calls[0];
      expect(messages[0].text).toBeUndefined();
    });

    test('subscribers email が null/undefined はフィルタされる', async () => {
      mockAnonFrom.mockReturnValue(profileChain(true));
      const subs = [
        { email: 'valid@example.com', user_id: 'u1' },
        { email: null as unknown as string, user_id: 'u2' },
      ];
      buildSendMocks({ subscribers: subs });
      const res = await PATCH(makeRequest({ action: 'send' }), makeProps());
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.sentCount).toBe(1);
    });

    // Branch coverage: line 14 — makeUnsubToken throws when NEWSLETTER_UNSUBSCRIBE_SECRET missing
    // chunk.map() は try/catch 外なのでエラーが伝播する（テストでは rejects で検証）
    test('NEWSLETTER_UNSUBSCRIBE_SECRET 未設定 → unsubToken生成でthrow', async () => {
      delete process.env.NEWSLETTER_UNSUBSCRIBE_SECRET;
      mockAnonFrom.mockReturnValue(profileChain(true));
      buildSendMocks({
        subscribers: [{ email: 'a@example.com', user_id: 'u1' }],
      });
      await expect(
        PATCH(makeRequest({ action: 'send' }), makeProps())
      ).rejects.toThrow('NEWSLETTER_UNSUBSCRIBE_SECRET is not set');
    });

    // Branch coverage: line 129/133 — user_digest campaign emails built from subscribers only
    test('user_digest: subscribers の email のみ使用 (owner fetch なし)', async () => {
      mockAnonFrom.mockReturnValue(profileChain(true));
      let callNum = 0;
      mockAdminFrom.mockImplementation(() => {
        callNum++;
        if (callNum === 1) return campaignFetchChain(buildCampaign({ campaign_type: 'user_digest' }));
        if (callNum === 2) return atomicClaimChain([{ id: CAMPAIGN_UUID }]);
        // newsletter_subscriptions
        if (callNum === 3) return subscribersChain([{ email: 'digest@example.com', user_id: 'u1' }]);
        // final update
        return updateSentChain({ id: CAMPAIGN_UUID, status: 'sent' });
      });

      const { Resend } = require('resend');
      const mockBatchSend = jest.fn().mockResolvedValue({ data: [], error: null });
      Resend.mockImplementationOnce(() => ({ batch: { send: mockBatchSend } }));

      const res = await PATCH(makeRequest({ action: 'send' }), makeProps());
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.sentCount).toBe(1);
      // facility_members query should NOT have been called (callNum should be 4, not 5)
      expect(callNum).toBe(4);
    });

    // Branch coverage: line 129 — owner_monthly: subscribers is null → (subscribers || []) uses fallback []
    test('owner_monthly: subscribers が null → [] にフォールバック', async () => {
      mockAnonFrom.mockReturnValue(profileChain(true));
      let callNum = 0;
      mockAdminFrom.mockImplementation(() => {
        callNum++;
        if (callNum === 1) return campaignFetchChain(buildCampaign({ campaign_type: 'owner_monthly' }));
        if (callNum === 2) return atomicClaimChain([{ id: CAMPAIGN_UUID }]);
        // newsletter_subscriptions returns null (not [])
        if (callNum === 3) return {
          select: jest.fn().mockReturnThis(),
          or: jest.fn().mockReturnThis(),
          eq: jest.fn(() => Promise.resolve({ data: null, error: null })),
        };
        if (callNum === 4) return facilityMembersChain([{ profiles: { email: 'owner@example.com' } }]);
        return updateSentChain({ id: CAMPAIGN_UUID, status: 'sent' });
      });

      const { Resend } = require('resend');
      const mockBatchSend = jest.fn().mockResolvedValue({ data: [], error: null });
      Resend.mockImplementationOnce(() => ({ batch: { send: mockBatchSend } }));

      const res = await PATCH(makeRequest({ action: 'send' }), makeProps());
      expect(res.status).toBe(200);
      const json = await res.json();
      // owner email only (subscribers null treated as [])
      expect(json.sentCount).toBe(1);
    });

    // Branch coverage: line 133 — user_digest: subscribers is null → (subscribers || []) uses fallback []
    test('user_digest: subscribers が null → [] にフォールバック', async () => {
      mockAnonFrom.mockReturnValue(profileChain(true));
      let callNum = 0;
      mockAdminFrom.mockImplementation(() => {
        callNum++;
        if (callNum === 1) return campaignFetchChain(buildCampaign({ campaign_type: 'user_digest' }));
        if (callNum === 2) return atomicClaimChain([{ id: CAMPAIGN_UUID }]);
        // newsletter_subscriptions returns null
        if (callNum === 3) return {
          select: jest.fn().mockReturnThis(),
          or: jest.fn().mockReturnThis(),
          eq: jest.fn(() => Promise.resolve({ data: null, error: null })),
        };
        return updateSentChain({ id: CAMPAIGN_UUID, status: 'sent' });
      });

      const res = await PATCH(makeRequest({ action: 'send' }), makeProps());
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.sentCount).toBe(0);
    });

    test('subscribers > 100 → sent in batches', async () => {
      mockAnonFrom.mockReturnValue(profileChain(true));
      // 150 subscribers → 2 batches (100 + 50)
      const subs = Array.from({ length: 150 }, (_, i) => ({
        email: `user${i}@example.com`,
        user_id: `uid-${i}`,
      }));
      buildSendMocks({ subscribers: subs });

      const { Resend } = require('resend');
      const mockBatchSend = jest.fn().mockResolvedValue({ data: [], error: null });
      Resend.mockImplementationOnce(() => ({ batch: { send: mockBatchSend } }));

      const res = await PATCH(makeRequest({ action: 'send' }), makeProps());
      expect(res.status).toBe(200);
      // Should have been called twice (chunk of 100 + chunk of 50)
      expect(mockBatchSend).toHaveBeenCalledTimes(2);
      const firstBatch = mockBatchSend.mock.calls[0][0];
      const secondBatch = mockBatchSend.mock.calls[1][0];
      expect(firstBatch).toHaveLength(100);
      expect(secondBatch).toHaveLength(50);
      const json = await res.json();
      expect(json.sentCount).toBe(150);
    });
  });
});
