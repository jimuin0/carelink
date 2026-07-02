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
 * Chain for facility_members.select('user_id').eq('role','owner') → resolves with { data: owners }.
 * profiles は embed しない（FK 不在で解決不能）ため user_id のみ返し、別途 profiles を引く。
 */
function facilityMembersChain(owners: { user_id: string | null }[]) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn(() => Promise.resolve({ data: owners, error: null })),
  };
}
/** Chain for profiles.select('email').in('id', userIds) → resolves with { data: profs }. */
function ownerProfilesChain(profs: { email: string | null }[], error: unknown = null) {
  return {
    select: jest.fn().mockReturnThis(),
    in: jest.fn(() => Promise.resolve({ data: profs, error })),
  };
}

/**
 * Chain for profiles.select('email').not('email','is',null).eq('email_unsubscribed', true)
 * → resolves with { data: [{email}, ...] }. Used for the unsubscribe-exclusion fetch.
 */
function unsubscribedProfilesChain(emails: string[], error: unknown = null) {
  return {
    select: jest.fn().mockReturnThis(),
    not: jest.fn().mockReturnThis(),
    eq: jest.fn(() => Promise.resolve({ data: error ? null : emails.map((email) => ({ email })), error })),
  };
}

/**
 * Chain for newsletter_subscriptions.select('email').not('email','is',null).eq('is_active', false)
 * → resolves with { data: [{email}, ...] }. Used for the unsubscribe-exclusion fetch.
 */
function inactiveSubscriptionsChain(emails: string[], error: unknown = null) {
  return {
    select: jest.fn().mockReturnThis(),
    not: jest.fn().mockReturnThis(),
    eq: jest.fn(() => Promise.resolve({ data: error ? null : emails.map((email) => ({ email })), error })),
  };
}

/**
 * Chain for the rollback update (send action aborts due to unsubscribe-list fetch failure):
 * update().eq() with no further chain (fire-and-forget-style await, but resolves a plain object).
 */
function rollbackToDraftChain() {
  return {
    update: jest.fn().mockReturnValue({
      eq: jest.fn(() => Promise.resolve({ data: null, error: null })),
    }),
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

/** finalize(status=sent) の update().eq().select().single() が任意の {data,error} を返すチェーン。 */
function updateSentChainResult(data: unknown, error: unknown) {
  return {
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn(() => Promise.resolve({ data, error })),
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

    test('DB 更新エラー → 500 (L61 cancelErr 分岐)', async () => {
      mockAnonFrom.mockReturnValue(profileChain(true));
      let callNum = 0;
      mockAdminFrom.mockImplementation(() => {
        callNum++;
        if (callNum === 1) return campaignFetchChain(buildCampaign({ status: 'scheduled' }));
        return {
          update: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({
                single: jest.fn(() => Promise.resolve({ data: null, error: { message: 'DB error' } })),
              }),
            }),
          }),
        };
      });
      const res = await PATCH(makeRequest({ action: 'cancel' }), makeProps());
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBeDefined();
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

    test('DB 更新エラー → 500 (L75 scheduleErr 分岐)', async () => {
      mockAnonFrom.mockReturnValue(profileChain(true));
      let callNum = 0;
      mockAdminFrom.mockImplementation(() => {
        callNum++;
        if (callNum === 1) return campaignFetchChain(buildCampaign({ status: 'draft' }));
        return {
          update: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({
                single: jest.fn(() => Promise.resolve({ data: null, error: { message: 'DB error' } })),
              }),
            }),
          }),
        };
      });
      const res = await PATCH(makeRequest({ action: 'schedule' }), makeProps());
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBeDefined();
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
      const hasEmails = subscribers.some((s) => s.email);
      let callNum = 0;
      mockAdminFrom.mockImplementation((table: string) => {
        callNum++;
        // 1st call: fetch campaign
        if (callNum === 1) return campaignFetchChain(campaign);
        // 2nd call: atomic claim (update to 'sending')
        if (callNum === 2) return atomicClaimChain(claimedRows);
        // 3rd call: newsletter_subscriptions
        if (callNum === 3) return subscribersChain(subscribers);
        // 4th/5th calls (only when the combined email list is non-empty):
        // unsubscribed-profiles exclusion, then inactive-subscriptions exclusion.
        if (hasEmails && callNum === 4) return unsubscribedProfilesChain([]);
        if (hasEmails && callNum === 5) return inactiveSubscriptionsChain([]);
        // final call: update campaign to 'sent'
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

    test('finalize(status=sent) が一度失敗しても再試行で成功 → 200（送信済みを draft に戻さない・D-1）', async () => {
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockAnonFrom.mockReturnValue(profileChain(true));
      const campaign = buildCampaign({});
      let callNum = 0;
      mockAdminFrom.mockImplementation(() => {
        callNum++;
        if (callNum === 1) return campaignFetchChain(campaign);
        if (callNum === 2) return atomicClaimChain([{ id: CAMPAIGN_UUID }]);
        if (callNum === 3) return subscribersChain([{ email: 'a@example.com', user_id: 'u1' }]);
        if (callNum === 4) return unsubscribedProfilesChain([]);
        if (callNum === 5) return inactiveSubscriptionsChain([]);
        if (callNum === 6) return updateSentChainResult(null, { message: 'finalize boom' }); // 1回目失敗
        return updateSentChainResult({ id: CAMPAIGN_UUID, status: 'sent' }, null);          // 再試行成功
      });
      const res = await PATCH(makeRequest({ action: 'send' }), makeProps());
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.sentCount).toBe(1);
      errSpy.mockRestore();
    });

    test('finalize が再試行も失敗 → 500・draft へ戻さず二重送信を防ぐ（D-1）', async () => {
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockAnonFrom.mockReturnValue(profileChain(true));
      const campaign = buildCampaign({});
      const rollbackUpdate = jest.fn();
      let callNum = 0;
      mockAdminFrom.mockImplementation(() => {
        callNum++;
        if (callNum === 1) return campaignFetchChain(campaign);
        if (callNum === 2) return atomicClaimChain([{ id: CAMPAIGN_UUID }]);
        if (callNum === 3) return subscribersChain([{ email: 'a@example.com', user_id: 'u1' }]);
        if (callNum === 4) return unsubscribedProfilesChain([]);
        if (callNum === 5) return inactiveSubscriptionsChain([]);
        // finalize(6) と再試行(7) の両方が失敗。それ以降に 'draft' ロールバック update が
        // 走らないこと（＝再送＝二重送信が起きないこと）を rollbackUpdate で検知する。
        if (callNum >= 8) return { update: rollbackUpdate };
        return updateSentChainResult(null, { message: 'finalize boom' });
      });
      const res = await PATCH(makeRequest({ action: 'send' }), makeProps());
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toContain('送信状態の記録に失敗');
      expect(json.sentCount).toBe(1);
      // draft ロールバックは呼ばれない（送信済みを再送可能にしない）
      expect(rollbackUpdate).not.toHaveBeenCalled();
      errSpy.mockRestore();
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
        // facility_members query（user_id のみ）→ profiles を別取得
        if (callNum === 4) return facilityMembersChain([{ user_id: 'owner-uid' }]);
        if (callNum === 5) return ownerProfilesChain([{ email: ownerEmail }]);
        if (callNum === 6) return unsubscribedProfilesChain([]);
        if (callNum === 7) return inactiveSubscriptionsChain([]);
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
        if (callNum === 5) return unsubscribedProfilesChain([]);
        if (callNum === 6) return inactiveSubscriptionsChain([]);
        return updateSentChain({ id: CAMPAIGN_UUID, status: 'sent' });
      });
      const res = await PATCH(makeRequest({ action: 'send' }), makeProps());
      expect(res.status).toBe(200);
    });

    test('owner_monthly: 複数オーナーの user_id を重複排除し profiles を別取得してメール送信', async () => {
      mockAnonFrom.mockReturnValue(profileChain(true));
      let callNum = 0;
      mockAdminFrom.mockImplementation(() => {
        callNum++;
        if (callNum === 1) return campaignFetchChain(buildCampaign({ campaign_type: 'owner_monthly' }));
        if (callNum === 2) return atomicClaimChain([{ id: CAMPAIGN_UUID }]);
        if (callNum === 3) return subscribersChain([]);
        // 同一オーナーが複数施設の owner（user_id 重複）→ Set で重複排除される
        if (callNum === 4) return facilityMembersChain([{ user_id: 'o1' }, { user_id: 'o2' }, { user_id: 'o1' }]);
        if (callNum === 5) return ownerProfilesChain([{ email: 'o1@example.com' }, { email: 'o2@example.com' }]);
        if (callNum === 6) return unsubscribedProfilesChain([]);
        if (callNum === 7) return inactiveSubscriptionsChain([]);
        return updateSentChain({ id: CAMPAIGN_UUID, status: 'sent' });
      });
      const { Resend } = require('resend');
      const mockBatchSend = jest.fn().mockResolvedValue({ data: [], error: null });
      Resend.mockImplementationOnce(() => ({ batch: { send: mockBatchSend } }));
      const res = await PATCH(makeRequest({ action: 'send' }), makeProps());
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.sentCount).toBe(2);
    });

    test('owner_monthly: profiles 別取得が失敗してもログのみで続行', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      mockAnonFrom.mockReturnValue(profileChain(true));
      let callNum = 0;
      mockAdminFrom.mockImplementation(() => {
        callNum++;
        if (callNum === 1) return campaignFetchChain(buildCampaign({ campaign_type: 'owner_monthly' }));
        if (callNum === 2) return atomicClaimChain([{ id: CAMPAIGN_UUID }]);
        if (callNum === 3) return subscribersChain([{ email: 'sub@example.com', user_id: 'u1' }]);
        if (callNum === 4) return facilityMembersChain([{ user_id: 'o1' }]);
        if (callNum === 5) return ownerProfilesChain(null as unknown as { email: string | null }[], { message: 'fail' });
        if (callNum === 6) return unsubscribedProfilesChain([]);
        if (callNum === 7) return inactiveSubscriptionsChain([]);
        return updateSentChain({ id: CAMPAIGN_UUID, status: 'sent' });
      });
      const res = await PATCH(makeRequest({ action: 'send' }), makeProps());
      expect(res.status).toBe(200);
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

    // B-7 根治: makeUnsubToken throws when NEWSLETTER_UNSUBSCRIBE_SECRET missing。
    // claim 後の全処理が try/catch で包まれたため、この例外はもう PATCH 全体を reject
    // させず catch され、campaign は 'sending' に固着せず 'draft' へロールバックされる
    // （旧実装は例外が伝播し 'sending' 固着＝恒久デッドロックの実バグだった）。
    test('NEWSLETTER_UNSUBSCRIBE_SECRET 未設定 → batch内でthrow → draftへロールバックし500', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      delete process.env.NEWSLETTER_UNSUBSCRIBE_SECRET;
      mockAnonFrom.mockReturnValue(profileChain(true));
      let callNum = 0;
      const mockRollback = jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ data: null, error: null })) });
      mockAdminFrom.mockImplementation(() => {
        callNum++;
        if (callNum === 1) return campaignFetchChain(buildCampaign({ campaign_type: 'user_digest' }));
        if (callNum === 2) return atomicClaimChain([{ id: CAMPAIGN_UUID }]);
        if (callNum === 3) return subscribersChain([{ email: 'a@example.com', user_id: 'u1' }]);
        if (callNum === 4) return unsubscribedProfilesChain([]);
        if (callNum === 5) return inactiveSubscriptionsChain([]);
        // 6th call: catch ブロックによる draft へのロールバック
        return { update: mockRollback };
      });
      const res = await PATCH(makeRequest({ action: 'send' }), makeProps());
      expect(res.status).toBe(500);
      expect(mockRollback).toHaveBeenCalledWith(expect.objectContaining({ status: 'draft' }));
    });

    // B-8 根治: RESEND_API_KEY 未設定は事前ガードで明示的に 503 を返し draft へロールバック
    // する（旧実装は new Resend(undefined) が batch.send() 内で例外を起こし、それを
    // catch → 全件 bounced 計上 → それでも status='sent' に確定していた＝1通も届いて
    // いないのに送信済み扱いになり再送不可の fail-open だった実バグ）。
    test('RESEND_API_KEY 未設定 → 事前ガードで503を返しdraftへロールバック', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      delete process.env.RESEND_API_KEY;
      mockAnonFrom.mockReturnValue(profileChain(true));
      let callNum = 0;
      const mockRollback = jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ data: null, error: null })) });
      mockAdminFrom.mockImplementation(() => {
        callNum++;
        if (callNum === 1) return campaignFetchChain(buildCampaign({ campaign_type: 'user_digest' }));
        if (callNum === 2) return atomicClaimChain([{ id: CAMPAIGN_UUID }]);
        // RESEND_API_KEY ガードは subscribers 取得より前に発火するため、3rd call は
        // 即座に draft へのロールバック
        return { update: mockRollback };
      });
      const res = await PATCH(makeRequest({ action: 'send' }), makeProps());
      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.error).toMatch(/RESEND_API_KEY/);
      expect(mockRollback).toHaveBeenCalledWith(expect.objectContaining({ status: 'draft' }));
      expect(callNum).toBe(3);
    });

    // Branch coverage: batch チャンク失敗時のログ出力（catch 内で console.error するよう
    // 変更した箇所）。
    test('batch.send チャンク失敗 → console.error でログを残し bouncedCount に計上', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      mockAnonFrom.mockReturnValue(profileChain(true));
      buildSendMocks({
        subscribers: [{ email: 'fail@example.com', user_id: 'u1' }],
      });
      const { Resend } = require('resend');
      Resend.mockImplementationOnce(() => ({
        batch: { send: jest.fn().mockRejectedValue(new Error('boom')) },
      }));
      const res = await PATCH(makeRequest({ action: 'send' }), makeProps());
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.bouncedCount).toBe(1);
      expect(console.error).toHaveBeenCalledWith(
        '[newsletter/send] batch chunk failed',
        expect.objectContaining({ campaignId: CAMPAIGN_UUID }),
      );
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
        if (callNum === 4) return unsubscribedProfilesChain([]);
        if (callNum === 5) return inactiveSubscriptionsChain([]);
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
      // facility_members query should NOT have been called (callNum should be 6, not 7)
      expect(callNum).toBe(6);
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
        if (callNum === 4) return facilityMembersChain([{ user_id: 'owner-uid' }]);
        if (callNum === 5) return ownerProfilesChain([{ email: 'owner@example.com' }]);
        if (callNum === 6) return unsubscribedProfilesChain([]);
        if (callNum === 7) return inactiveSubscriptionsChain([]);
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

    // ─── B-1/B-2/B-6 根治: 配信停止済みは profiles.email_unsubscribed /
    // newsletter_subscriptions.is_active のどちらで停止していても必ず除外される ───

    test('email_unsubscribed=true の profiles は is_active=true の購読があっても除外される', async () => {
      mockAnonFrom.mockReturnValue(profileChain(true));
      let callNum = 0;
      mockAdminFrom.mockImplementation(() => {
        callNum++;
        if (callNum === 1) return campaignFetchChain(buildCampaign({ campaign_type: 'user_digest' }));
        if (callNum === 2) return atomicClaimChain([{ id: CAMPAIGN_UUID }]);
        if (callNum === 3) return subscribersChain([
          { email: 'active@example.com', user_id: 'u1' },
          { email: 'stopped@example.com', user_id: 'u2' },
        ]);
        // stopped@example.com は profiles.email_unsubscribed=true（トークン方式で停止済み）
        if (callNum === 4) return unsubscribedProfilesChain(['stopped@example.com']);
        if (callNum === 5) return inactiveSubscriptionsChain([]);
        return updateSentChain({ id: CAMPAIGN_UUID, status: 'sent' });
      });
      const { Resend } = require('resend');
      const mockBatchSend = jest.fn().mockResolvedValue({ data: [], error: null });
      Resend.mockImplementationOnce(() => ({ batch: { send: mockBatchSend } }));

      const res = await PATCH(makeRequest({ action: 'send' }), makeProps());
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.sentCount).toBe(1);
      const [messages] = mockBatchSend.mock.calls[0];
      expect(messages.map((m: { to: string[] }) => m.to[0])).toEqual(['active@example.com']);
    });

    test('owner_monthly: newsletter_subscriptions.is_active=false のオーナーは無条件マージでも除外される', async () => {
      mockAnonFrom.mockReturnValue(profileChain(true));
      let callNum = 0;
      mockAdminFrom.mockImplementation(() => {
        callNum++;
        if (callNum === 1) return campaignFetchChain(buildCampaign({ campaign_type: 'owner_monthly' }));
        if (callNum === 2) return atomicClaimChain([{ id: CAMPAIGN_UUID }]);
        if (callNum === 3) return subscribersChain([]);
        if (callNum === 4) return facilityMembersChain([{ user_id: 'o1' }, { user_id: 'o2' }]);
        if (callNum === 5) return ownerProfilesChain([{ email: 'o1@example.com' }, { email: 'o2@example.com' }]);
        if (callNum === 6) return unsubscribedProfilesChain([]);
        // o2 は newsletter_subscriptions で明示的に is_active=false（配信停止操作済み）
        if (callNum === 7) return inactiveSubscriptionsChain(['o2@example.com']);
        return updateSentChain({ id: CAMPAIGN_UUID, status: 'sent' });
      });
      const { Resend } = require('resend');
      const mockBatchSend = jest.fn().mockResolvedValue({ data: [], error: null });
      Resend.mockImplementationOnce(() => ({ batch: { send: mockBatchSend } }));

      const res = await PATCH(makeRequest({ action: 'send' }), makeProps());
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.sentCount).toBe(1);
      const [messages] = mockBatchSend.mock.calls[0];
      expect(messages.map((m: { to: string[] }) => m.to[0])).toEqual(['o1@example.com']);
    });

    test('宛先メールの大小文字表記揺れは正規化され二重送信されない', async () => {
      mockAnonFrom.mockReturnValue(profileChain(true));
      let callNum = 0;
      mockAdminFrom.mockImplementation(() => {
        callNum++;
        if (callNum === 1) return campaignFetchChain(buildCampaign({ campaign_type: 'user_digest' }));
        if (callNum === 2) return atomicClaimChain([{ id: CAMPAIGN_UUID }]);
        if (callNum === 3) return subscribersChain([
          { email: 'Foo@Example.com', user_id: 'u1' },
          { email: 'foo@example.com', user_id: 'u2' },
        ]);
        if (callNum === 4) return unsubscribedProfilesChain([]);
        if (callNum === 5) return inactiveSubscriptionsChain([]);
        return updateSentChain({ id: CAMPAIGN_UUID, status: 'sent' });
      });
      const { Resend } = require('resend');
      const mockBatchSend = jest.fn().mockResolvedValue({ data: [], error: null });
      Resend.mockImplementationOnce(() => ({ batch: { send: mockBatchSend } }));

      const res = await PATCH(makeRequest({ action: 'send' }), makeProps());
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.sentCount).toBe(1);
    });

    test('停止済みプロフィール取得に失敗 → 送信を中止し campaign を draft に戻す (fail-safe)', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      mockAnonFrom.mockReturnValue(profileChain(true));
      let callNum = 0;
      mockAdminFrom.mockImplementation(() => {
        callNum++;
        if (callNum === 1) return campaignFetchChain(buildCampaign({ campaign_type: 'user_digest' }));
        if (callNum === 2) return atomicClaimChain([{ id: CAMPAIGN_UUID }]);
        if (callNum === 3) return subscribersChain([{ email: 'a@example.com', user_id: 'u1' }]);
        if (callNum === 4) return unsubscribedProfilesChain([], { message: 'DB error' });
        return rollbackToDraftChain();
      });
      const res = await PATCH(makeRequest({ action: 'send' }), makeProps());
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toMatch(/配信停止者リスト/);
    });

    test('unsubProfiles が null（data無しだがerrorも無し）→ [] にフォールバックして続行', async () => {
      mockAnonFrom.mockReturnValue(profileChain(true));
      let callNum = 0;
      mockAdminFrom.mockImplementation(() => {
        callNum++;
        if (callNum === 1) return campaignFetchChain(buildCampaign({ campaign_type: 'user_digest' }));
        if (callNum === 2) return atomicClaimChain([{ id: CAMPAIGN_UUID }]);
        if (callNum === 3) return subscribersChain([{ email: 'a@example.com', user_id: 'u1' }]);
        if (callNum === 4) return {
          select: jest.fn().mockReturnThis(),
          not: jest.fn().mockReturnThis(),
          eq: jest.fn(() => Promise.resolve({ data: null, error: null })),
        };
        if (callNum === 5) return inactiveSubscriptionsChain([]);
        return updateSentChain({ id: CAMPAIGN_UUID, status: 'sent' });
      });
      const res = await PATCH(makeRequest({ action: 'send' }), makeProps());
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.sentCount).toBe(1);
    });

    test('inactiveSubs が null（data無しだがerrorも無し）→ [] にフォールバックして続行', async () => {
      mockAnonFrom.mockReturnValue(profileChain(true));
      let callNum = 0;
      mockAdminFrom.mockImplementation(() => {
        callNum++;
        if (callNum === 1) return campaignFetchChain(buildCampaign({ campaign_type: 'user_digest' }));
        if (callNum === 2) return atomicClaimChain([{ id: CAMPAIGN_UUID }]);
        if (callNum === 3) return subscribersChain([{ email: 'a@example.com', user_id: 'u1' }]);
        if (callNum === 4) return unsubscribedProfilesChain([]);
        if (callNum === 5) return {
          select: jest.fn().mockReturnThis(),
          not: jest.fn().mockReturnThis(),
          eq: jest.fn(() => Promise.resolve({ data: null, error: null })),
        };
        return updateSentChain({ id: CAMPAIGN_UUID, status: 'sent' });
      });
      const res = await PATCH(makeRequest({ action: 'send' }), makeProps());
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.sentCount).toBe(1);
    });

    test('unsubProfiles/inactiveSubs に email=null の行が混じっても防御的にフィルタされる', async () => {
      mockAnonFrom.mockReturnValue(profileChain(true));
      let callNum = 0;
      mockAdminFrom.mockImplementation(() => {
        callNum++;
        if (callNum === 1) return campaignFetchChain(buildCampaign({ campaign_type: 'user_digest' }));
        if (callNum === 2) return atomicClaimChain([{ id: CAMPAIGN_UUID }]);
        if (callNum === 3) return subscribersChain([{ email: 'a@example.com', user_id: 'u1' }]);
        if (callNum === 4) return {
          select: jest.fn().mockReturnThis(),
          not: jest.fn().mockReturnThis(),
          eq: jest.fn(() => Promise.resolve({ data: [{ email: null }], error: null })),
        };
        if (callNum === 5) return {
          select: jest.fn().mockReturnThis(),
          not: jest.fn().mockReturnThis(),
          eq: jest.fn(() => Promise.resolve({ data: [{ email: null }], error: null })),
        };
        return updateSentChain({ id: CAMPAIGN_UUID, status: 'sent' });
      });
      const res = await PATCH(makeRequest({ action: 'send' }), makeProps());
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.sentCount).toBe(1);
    });

    test('非アクティブ購読取得に失敗 → 送信を中止し campaign を draft に戻す (fail-safe)', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      mockAnonFrom.mockReturnValue(profileChain(true));
      let callNum = 0;
      mockAdminFrom.mockImplementation(() => {
        callNum++;
        if (callNum === 1) return campaignFetchChain(buildCampaign({ campaign_type: 'user_digest' }));
        if (callNum === 2) return atomicClaimChain([{ id: CAMPAIGN_UUID }]);
        if (callNum === 3) return subscribersChain([{ email: 'a@example.com', user_id: 'u1' }]);
        if (callNum === 4) return unsubscribedProfilesChain([]);
        if (callNum === 5) return inactiveSubscriptionsChain([], { message: 'DB error' });
        return rollbackToDraftChain();
      });
      const res = await PATCH(makeRequest({ action: 'send' }), makeProps());
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toMatch(/配信停止者リスト/);
    });
  });
});
