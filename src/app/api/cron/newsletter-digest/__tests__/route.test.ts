/**
 * @jest-environment node
 *
 * Tests for GET /api/cron/newsletter-digest (exactly-once 版)
 * Key assertions:
 *   - CRON_SECRET / 必須 env 検証
 *   - fast-path: 当月 'sent' 済みなら skip
 *   - owner へ 1 通ずつ idempotencyKey 付きで送信し newsletter_send_log に記録
 *   - 台帳済みアドレスは再送しない（exactly-once）
 *   - 配信停止者を除外
 *   - campaign find-or-create（既存再利用 / 新規 insert / insert エラー）
 *   - 送信失敗・予算超過時は campaign を 'sent' にせず 'skipped' ログ（watcher が検知継続）
 *   - 全送信完了時のみ 'success'
 */

jest.mock('@/lib/cron-auth');
jest.mock('@/lib/supabase-server');
jest.mock('@/lib/cron-logger');
jest.mock('resend');

import { checkCronAuth } from '@/lib/cron-auth';
import { logCronRun } from '@/lib/cron-logger';
import { GET } from '../route';

// 任意のクエリチェーン（eq/gte/lte/order/range/limit/select/single...）を受けて
// 最終的に `result` へ解決する thenable proxy。
function makeChain(result: any) {
  const p = Promise.resolve(result);
  const proxy: any = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then') return p.then.bind(p);
      if (prop === 'catch') return p.catch.bind(p);
      if (prop === 'finally') return p.finally.bind(p);
      return () => proxy;
    },
    apply() {
      return proxy;
    },
  });
  return proxy;
}

let mockSend: jest.Mock;
let mockSendLogInsert: jest.Mock;
let mockCampaignInsert: jest.Mock;
let mockCampaignUpdate: jest.Mock;

function setup(opts: any = {}) {
  const {
    alreadySent = false,
    existingCampaign = false,
    owners = [{ profiles: { email: 'owner@example.com' } }],
    unsubProfiles = [] as any[],
    unsubNewsletter = [] as any[],
    ledger = [] as any[],
    campaignInsertError = null,
    campaignInsertData = { id: 'campaign-new' },
    campaignUpdateError = null,
    sendLogInsertResult = { error: null },
    sendRejects = false,
    authError = null,
    bookingsCount = 42,
    reviewsCount = 15,
    facilitiesCount = 3,
  } = opts;

  (checkCronAuth as jest.Mock).mockReturnValue(authError);
  (logCronRun as jest.Mock).mockResolvedValue(undefined);

  mockCampaignInsert = jest.fn().mockReturnValue(
    makeChain({ data: campaignInsertError ? null : campaignInsertData, error: campaignInsertError }),
  );
  mockCampaignUpdate = jest.fn().mockReturnValue(makeChain({ error: campaignUpdateError }));
  mockSendLogInsert = jest.fn().mockReturnValue(makeChain(sendLogInsertResult));

  // newsletter_campaigns.select: 1回目=fast-path(sent), 2回目=find-existing
  const campaignSelect = jest.fn()
    .mockReturnValueOnce(makeChain({ data: alreadySent ? [{ id: 'campaign-sent' }] : [] }))
    .mockReturnValueOnce(makeChain({ data: existingCampaign ? [{ id: 'campaign-existing' }] : [] }));

  const { createServiceRoleClient } = require('@/lib/supabase-server');
  createServiceRoleClient.mockReturnValue({
    from: jest.fn().mockImplementation((table: string) => {
      switch (table) {
        case 'newsletter_campaigns':
          return { select: campaignSelect, insert: mockCampaignInsert, update: mockCampaignUpdate };
        case 'bookings':
          return { select: jest.fn().mockReturnValue(makeChain({ count: bookingsCount })) };
        case 'reviews':
          return { select: jest.fn().mockReturnValue(makeChain({ count: reviewsCount })) };
        case 'facility_profiles':
          return { select: jest.fn().mockReturnValue(makeChain({ count: facilitiesCount })) };
        case 'facility_members':
          return { select: jest.fn().mockReturnValue(makeChain({ data: owners })) };
        case 'profiles':
          return { select: jest.fn().mockReturnValue(makeChain({ data: unsubProfiles })) };
        case 'newsletter_subscriptions':
          return { select: jest.fn().mockReturnValue(makeChain({ data: unsubNewsletter })) };
        case 'newsletter_send_log':
          return { select: jest.fn().mockReturnValue(makeChain({ data: ledger })), insert: mockSendLogInsert };
        case 'cron_logs':
          return { insert: jest.fn().mockResolvedValue({ error: null }) };
        default:
          return {};
      }
    }),
  });

  mockSend = sendRejects
    ? jest.fn().mockRejectedValue(new Error('Resend down'))
    : jest.fn().mockResolvedValue({ data: { id: 'email-1' } });
  const { Resend } = require('resend');
  Resend.mockImplementation(() => ({ emails: { send: mockSend } }));

  process.env.NEWSLETTER_UNSUBSCRIBE_SECRET = 'secret-key';
  process.env.RESEND_API_KEY = 'test-key';
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  setup();
});

function makeRequest() {
  return new Request('http://localhost/api/cron/newsletter-digest', {
    method: 'GET',
    headers: { authorization: 'Bearer cron-secret' },
  });
}

describe('GET /api/cron/newsletter-digest', () => {
  test('auth error → returns it', async () => {
    setup({ authError: new Response('no', { status: 401 }) });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(401);
  });

  test('NEWSLETTER_UNSUBSCRIBE_SECRET missing → 503', async () => {
    delete process.env.NEWSLETTER_UNSUBSCRIBE_SECRET;
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(503);
  });

  test('RESEND_API_KEY missing → 503', async () => {
    delete process.env.RESEND_API_KEY;
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(503);
  });

  test('already sent this month → skip, no send', async () => {
    setup({ alreadySent: true });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.skipped).toBe(true);
    expect(mockSend).not.toHaveBeenCalled();
    expect(logCronRun).toHaveBeenCalledWith('newsletter-digest', 'skipped', expect.any(Date), expect.any(Object));
  });

  test('happy path → sends to owner, records ledger, marks campaign sent, success log', async () => {
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.processed).toBe(1);
    expect(json.completed).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSendLogInsert).toHaveBeenCalledWith(
      expect.objectContaining({ period: expect.any(String), email: 'owner@example.com' }),
    );
    expect(mockCampaignUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'sent' }));
    expect(logCronRun).toHaveBeenCalledWith('newsletter-digest', 'success', expect.any(Date), expect.any(Object));
  });

  test('send uses deterministic idempotencyKey nl:period:email', async () => {
    await GET(makeRequest() as any);
    const call = mockSend.mock.calls[0];
    expect(call[1]).toEqual(expect.objectContaining({ idempotencyKey: expect.stringMatching(/^nl:\d{4}-\d{2}:owner@example\.com$/) }));
  });

  test('email already in ledger → skipped (exactly-once)', async () => {
    setup({ ledger: [{ email: 'owner@example.com' }] });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(mockSend).not.toHaveBeenCalled();
    expect(json.processed).toBe(0);
    expect(json.completed).toBe(true); // nothing to send → completed
    expect(mockCampaignUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'sent' }));
  });

  test('unsubscribed (profiles) excluded', async () => {
    setup({
      owners: [{ profiles: { email: 'a@x.com' } }, { profiles: { email: 'b@x.com' } }],
      unsubProfiles: [{ email: 'a@x.com' }],
    });
    await GET(makeRequest() as any);
    const sentTo = mockSend.mock.calls.map((c) => c[0].to[0]);
    expect(sentTo).toEqual(['b@x.com']);
  });

  test('unsubscribed (newsletter_subscriptions) excluded', async () => {
    setup({
      owners: [{ profiles: { email: 'a@x.com' } }, { profiles: { email: 'b@x.com' } }],
      unsubNewsletter: [{ email: 'b@x.com' }],
    });
    await GET(makeRequest() as any);
    const sentTo = mockSend.mock.calls.map((c) => c[0].to[0]);
    expect(sentTo).toEqual(['a@x.com']);
  });

  test('existing campaign this month → reused, no insert', async () => {
    setup({ existingCampaign: true });
    await GET(makeRequest() as any);
    expect(mockCampaignInsert).not.toHaveBeenCalled();
    expect(mockSendLogInsert).toHaveBeenCalledWith(expect.objectContaining({ campaign_id: 'campaign-existing' }));
  });

  test('no existing campaign → inserts new', async () => {
    await GET(makeRequest() as any);
    expect(mockCampaignInsert).toHaveBeenCalled();
  });

  test('campaign insert error → 500', async () => {
    setup({ campaignInsertError: { message: 'boom' } });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
    expect(logCronRun).toHaveBeenCalledWith('newsletter-digest', 'error', expect.any(Date), expect.any(Object));
  });

  test('send failure → not recorded, campaign NOT marked sent, skipped log', async () => {
    setup({ sendRejects: true });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.processed).toBe(0);
    expect(json.skipped).toBe(1);
    expect(json.completed).toBe(false);
    expect(mockSendLogInsert).not.toHaveBeenCalled();
    expect(mockCampaignUpdate).not.toHaveBeenCalled();
    expect(logCronRun).toHaveBeenCalledWith('newsletter-digest', 'skipped', expect.any(Date), expect.any(Object));
  });

  test('send-log insert 23505 (concurrent) → ignored, no error log', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    setup({ sendLogInsertResult: { error: { code: '23505' } } });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    expect(errSpy).not.toHaveBeenCalledWith('[newsletter-digest] send-log insert failed', expect.anything());
    errSpy.mockRestore();
  });

  test('send-log insert other error → logged', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    setup({ sendLogInsertResult: { error: { code: '42P01', message: 'no table' } } });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    expect(errSpy).toHaveBeenCalledWith('[newsletter-digest] send-log insert failed', expect.any(Object));
    errSpy.mockRestore();
  });

  test('campaign update error → logged, still 200', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    setup({ campaignUpdateError: { message: 'update boom' } });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    expect(errSpy).toHaveBeenCalledWith('[newsletter-digest] campaign status update failed — watcher may re-alert', expect.any(Object));
    errSpy.mockRestore();
  });

  test('owner profiles as array → email extracted', async () => {
    setup({ owners: [{ profiles: [{ email: 'arr@x.com' }] }] });
    await GET(makeRequest() as any);
    expect(mockSend.mock.calls[0][0].to[0]).toBe('arr@x.com');
  });

  test('owner with null profiles → filtered out', async () => {
    setup({ owners: [{ profiles: null }, { profiles: { email: 'ok@x.com' } }] });
    await GET(makeRequest() as any);
    const sentTo = mockSend.mock.calls.map((c) => c[0].to[0]);
    expect(sentTo).toEqual(['ok@x.com']);
  });

  test('duplicate owner emails deduped', async () => {
    setup({ owners: [{ profiles: { email: 'dup@x.com' } }, { profiles: { email: 'dup@x.com' } }] });
    await GET(makeRequest() as any);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  test('no sendable owners → completed, marks sent, no send', async () => {
    setup({ owners: [] });
    const res = await GET(makeRequest() as any);
    const json = await res.json();
    expect(mockSend).not.toHaveBeenCalled();
    expect(json.completed).toBe(true);
    expect(mockCampaignUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'sent' }));
  });

  test('unexpected exception (from throws inside try) → 500', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    // admin = createServiceRoleClient() は try 外なので、from() を投げさせて try 内で捕捉させる
    createServiceRoleClient.mockReturnValue({ from: jest.fn(() => { throw new Error('fatal'); }) });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
  });

  test('null stats counts → template falls back to 0, still sends', async () => {
    setup({ bookingsCount: null, reviewsCount: null, facilitiesCount: null });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.completed).toBe(true);
    // htmlBody に 0 が入った状態で送信される
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0].html).toContain('>0<');
  });

  test('non-Error throw → String(e) fallback, 500', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({ from: jest.fn(() => { throw 'plain string'; }) });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
    expect(logCronRun).toHaveBeenCalledWith('newsletter-digest', 'error', expect.any(Date), expect.any(Object));
  });

  test('time budget exceeded → defers, not completed, skipped log', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    setup({ owners: [{ profiles: { email: 'a@x.com' } }, { profiles: { email: 'b@x.com' } }] });
    // loopStart 後の最初のガードで予算超過させる
    jest.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValue(10_000_000);
    const res = await GET(makeRequest() as any);
    const json = await res.json();
    expect(json.deferred).toBe(2);
    expect(json.completed).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
    expect(logCronRun).toHaveBeenCalledWith('newsletter-digest', 'skipped', expect.any(Date), expect.any(Object));
    warnSpy.mockRestore();
  });
});
