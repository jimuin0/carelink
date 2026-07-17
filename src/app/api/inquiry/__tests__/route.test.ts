/**
 * @jest-environment node
 *
 * Tests for POST /api/inquiry (施設問い合わせの唯一の登録経路)
 * Key assertions:
 *   - CSRF check required (withRoute csrf:true)
 *   - Rate limiting (5 req/min per IP, prefix 'facility-inquiry')
 *   - Schema validation (required fields, email/phone format, max lengths)
 *   - Facility existence/published check (server-authoritative facility_name)
 *   - service_role insert → returns { success, id }
 *   - Insert error / no-data / exception → 500
 *   - Slack通知（fire-and-forget）: sendNotify を type:'facility_inquiry' で直接呼ぶ
 *     （/api/notify 廃止・サーバー側直接送信への移行の回帰防止）
 */

jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({
  mutationRateLimit: 'mutationLimit',
  checkRateLimit: jest.fn(),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: jest.fn(),
}));
jest.mock('@/lib/email', () => ({ sendNewInquiryNotification: jest.fn() }));
jest.mock('@/lib/safe', () => ({ safeCaptureException: jest.fn() }));
jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));
// Slack 通知は同一サーバー内の sendNotify を直接呼ぶ（HTTP 往復しない・/api/notify 廃止）。
jest.mock('@/lib/notify', () => ({ sendNotify: jest.fn() }));

import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { sendNewInquiryNotification } from '@/lib/email';
import { safeCaptureException } from '@/lib/safe';
import { alertCaughtError } from '@/lib/alert';
import { sendNotify } from '@/lib/notify';
import { POST } from '../route';

const FACILITY_ID = '550e8400-e29b-41d4-a716-446655440000';

let mockInsert: jest.Mock;
let mockInsertSingle: jest.Mock;
let mockFacilityMaybeSingle: jest.Mock;

function setupDefaultMocks(
  opts: {
    insertError?: boolean; noData?: boolean; noFacility?: boolean;
    ownerUserIds?: string[]; ownerEmails?: (string | null)[];
    ownerRowsDataNull?: boolean; ownerProfilesDataNull?: boolean;
  } = {}
) {
  (checkCsrf as jest.Mock).mockReturnValue(null);

  mockFacilityMaybeSingle = jest.fn().mockResolvedValue({
    data: opts.noFacility ? null : { id: FACILITY_ID, name: 'リラクサロン ABC' },
  });
  const facilityEqStatus = jest.fn().mockReturnValue({ maybeSingle: mockFacilityMaybeSingle });
  const facilityEqId = jest.fn().mockReturnValue({ eq: facilityEqStatus });
  const facilitySelect = jest.fn().mockReturnValue({ eq: facilityEqId });

  mockInsertSingle = jest.fn().mockResolvedValue({
    data: opts.noData ? null : { id: 'new-inquiry-id' },
    error: opts.insertError ? { message: 'Insert failed' } : null,
  });
  mockInsert = jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({ single: mockInsertSingle }),
  });

  // オーナー通知（facility_members → profiles でメール解決）用チェーン。
  // デフォルトはオーナー0件（通知ロジックが到達しても no-op で成功パスに影響しない）。
  // role フィルタは .eq('role','owner')→.in('role',['owner','admin']) に変わったため（2026年7月17日
  // admin ロールへのメール通知統一）、.eq/.in どちらで終端されても同じ結果に解決する共有モックにし、
  // かつ呼び出し引数を検証できるよう外に返す。
  const ownerRows = opts.ownerRowsDataNull ? null : (opts.ownerUserIds ?? []).map((id) => ({ user_id: id }));
  const membersRoleFilter = jest.fn().mockResolvedValue({ data: ownerRows });
  const ownersChain = { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: membersRoleFilter, in: membersRoleFilter }) }) };
  const profileRows = opts.ownerProfilesDataNull ? null : (opts.ownerEmails ?? []).map((email) => ({ email }));
  const profilesChain = { select: jest.fn().mockReturnValue({ in: jest.fn().mockResolvedValue({ data: profileRows }) }) };

  (createServiceRoleClient as jest.Mock).mockReturnValue({
    from: jest.fn((table: string) => {
      if (table === 'facility_profiles') return { select: facilitySelect };
      if (table === 'facility_members') return ownersChain;
      if (table === 'profiles') return profilesChain;
      return { insert: mockInsert };
    }),
  });

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';

  return { membersRoleFilter };
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockResolvedValue(false);
  (sendNewInquiryNotification as jest.Mock).mockResolvedValue(true);
  (sendNotify as jest.Mock).mockResolvedValue({ ok: true, ts: '123.456' });
  setupDefaultMocks();
});

const validInquiry = {
  facility_id: FACILITY_ID,
  name: '山田 太郎',
  email: 'owner@example.com',
  phone: '090-1234-5678',
  message: 'ご予約について質問があります。',
};

function makeRequest(body: unknown, ip = '192.168.1.1') {
  return new Request('http://localhost/api/inquiry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

describe('POST /api/inquiry', () => {
  test('CSRF check failed → 403', async () => {
    const csrfError = new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 });
    (checkCsrf as jest.Mock).mockReturnValue(csrfError as any);

    const res = await POST(makeRequest(validInquiry) as any);
    expect(res.status).toBe(403);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('rate limiting → 429', async () => {
    (checkRateLimit as jest.Mock).mockResolvedValue(true);

    const res = await POST(makeRequest(validInquiry) as any);
    expect(res.status).toBe(429);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('rate limit configured with facility-inquiry prefix, limit 5', async () => {
    await POST(makeRequest(validInquiry) as any);
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[2]).toBe(5);
    expect(call[3]).toBe(60_000);
    expect(call[4]).toBe('facility-inquiry');
  });

  test('valid payload → 200 with id', async () => {
    const res = await POST(makeRequest(validInquiry) as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.id).toBe('new-inquiry-id');
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  test('insert uses server-authoritative facility_name and maps empty phone to null', async () => {
    await POST(makeRequest({ ...validInquiry, phone: '' }) as any);
    const inserted = mockInsert.mock.calls[0][0];
    expect(inserted.facility_id).toBe(FACILITY_ID);
    expect(inserted.facility_name).toBe('リラクサロン ABC'); // from facility_profiles, not client
    expect(inserted.phone).toBeNull();
    expect(inserted.name).toBe(validInquiry.name);
    expect(inserted.message).toBe(validInquiry.message);
  });

  test('omitted phone → inserted as null', async () => {
    const { phone, ...rest } = validInquiry;
    void phone;
    const res = await POST(makeRequest(rest) as any);
    expect(res.status).toBe(200);
    const inserted = mockInsert.mock.calls[0][0];
    expect(inserted.phone).toBeNull();
  });

  test('facility not found / unpublished → 404', async () => {
    setupDefaultMocks({ noFacility: true });
    const res = await POST(makeRequest(validInquiry) as any);
    expect(res.status).toBe(404);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('missing required name → 400', async () => {
    const { name, ...rest } = validInquiry;
    void name;
    const res = await POST(makeRequest(rest) as any);
    expect(res.status).toBe(400);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('invalid facility_id (not uuid) → 400', async () => {
    const res = await POST(makeRequest({ ...validInquiry, facility_id: 'not-uuid' }) as any);
    expect(res.status).toBe(400);
  });

  test('invalid email → 400', async () => {
    const res = await POST(makeRequest({ ...validInquiry, email: 'not-an-email' }) as any);
    expect(res.status).toBe(400);
  });

  test('invalid phone format → 400', async () => {
    const res = await POST(makeRequest({ ...validInquiry, phone: 'abc-def' }) as any);
    expect(res.status).toBe(400);
  });

  test('empty message → 400', async () => {
    const res = await POST(makeRequest({ ...validInquiry, message: '' }) as any);
    expect(res.status).toBe(400);
  });

  test('message over 1000 chars → 400', async () => {
    const res = await POST(makeRequest({ ...validInquiry, message: 'a'.repeat(1001) }) as any);
    expect(res.status).toBe(400);
  });

  // 【2026年7月8日 恒久根治の回帰防止】.trim() 追加前は "   "(空白のみ)が min(1) を素通りし、
  // スペースのみの名前・内容が保存され得た。
  test('name がスペースのみ → 400', async () => {
    const res = await POST(makeRequest({ ...validInquiry, name: '   ' }) as any);
    expect(res.status).toBe(400);
  });

  test('message がスペースのみ → 400', async () => {
    const res = await POST(makeRequest({ ...validInquiry, message: '   ' }) as any);
    expect(res.status).toBe(400);
  });

  test('null body (invalid JSON) → 400', async () => {
    const req = new Request('http://localhost/api/inquiry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
      body: 'not json',
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });

  test('DB insert error → 500', async () => {
    setupDefaultMocks({ insertError: true });
    const res = await POST(makeRequest(validInquiry) as any);
    expect(res.status).toBe(500);
  });

  test('insert returns no data → 500', async () => {
    setupDefaultMocks({ noData: true });
    const res = await POST(makeRequest(validInquiry) as any);
    expect(res.status).toBe(500);
  });

  test('exception (createServiceRoleClient throws) → 500', async () => {
    (createServiceRoleClient as jest.Mock).mockImplementation(() => {
      throw new Error('boom');
    });
    const res = await POST(makeRequest(validInquiry) as any);
    expect(res.status).toBe(500);
  });
});

// INQ-1: 施設存在確認の error を握り潰さず 500（404 偽装の防止）
test('INQ-1: 施設確認でDBエラー → 500', async () => {
  mockFacilityMaybeSingle.mockResolvedValue({ data: null, error: { message: 'db down' } });
  const res = await POST(makeRequest(validInquiry));
  expect(res.status).toBe(500);
});

// 【2026年7月10日 恒久根治の回帰】施設への問い合わせがオーナーに届かない構造的欠陥の修正。
describe('オーナー通知（施設への問い合わせがオーナーに届く経路）', () => {
  test('オーナー1名 → メール通知が送られる', async () => {
    setupDefaultMocks({ ownerUserIds: ['owner-1'], ownerEmails: ['owner1@example.com'] });
    const res = await POST(makeRequest(validInquiry) as any);
    expect(res.status).toBe(200);
    expect(sendNewInquiryNotification).toHaveBeenCalledTimes(1);
    const arg = (sendNewInquiryNotification as jest.Mock).mock.calls[0][0];
    expect(arg.facilityEmail).toBe('owner1@example.com');
    expect(arg.facilityName).toBe('リラクサロン ABC');
    expect(arg.inquirerName).toBe(validInquiry.name);
    expect(arg.inquirerEmail).toBe(validInquiry.email);
    expect(arg.inquirerPhone).toBe(validInquiry.phone);
    expect(arg.message).toBe(validInquiry.message);
  });

  test('phone未指定の問い合わせ → 通知の inquirerPhone は null', async () => {
    setupDefaultMocks({ ownerUserIds: ['owner-1'], ownerEmails: ['owner1@example.com'] });
    const { phone, ...rest } = validInquiry;
    void phone;
    await POST(makeRequest(rest) as any);
    const arg = (sendNewInquiryNotification as jest.Mock).mock.calls[0][0];
    expect(arg.inquirerPhone).toBeNull();
  });

  test('複数オーナー → 重複を除いた全員にメール通知が送られる（/api/bookingと同じ全オーナー通知パターン）', async () => {
    setupDefaultMocks({
      ownerUserIds: ['owner-1', 'owner-2'],
      ownerEmails: ['owner1@example.com', 'owner2@example.com', 'owner1@example.com'], // 重複含む
    });
    await POST(makeRequest(validInquiry) as any);
    expect(sendNewInquiryNotification).toHaveBeenCalledTimes(2);
    const sentEmails = (sendNewInquiryNotification as jest.Mock).mock.calls.map((c) => c[0].facilityEmail).sort();
    expect(sentEmails).toEqual(['owner1@example.com', 'owner2@example.com']);
  });

  // 【2026年7月17日 admin ロールへのメール通知統一】facility_members の admin ロールは
  // push.ts(sendPushToFacilityOwners) では通知対象だが、メール通知は .eq('role','owner') のため
  // 対象外という非対称があった。role フィルタが push.ts と同じ .in('role',['owner','admin']) で
  // 呼ばれること（.eq('role','owner') に戻す退行があれば失敗する）と、admin ロールのメンバーにも
  // 実際にメールが届くこと（owner・admin混在で重複排除も維持されること）を検証する。
  test('owner+adminが混在 → 両ロールへメール通知が送られ、role フィルタは owner/admin 両方を含む', async () => {
    const { membersRoleFilter } = setupDefaultMocks({
      ownerUserIds: ['owner-1', 'admin-1'],
      ownerEmails: ['owner1@example.com', 'admin1@example.com'],
    });
    await POST(makeRequest(validInquiry) as any);
    expect(membersRoleFilter).toHaveBeenCalledWith('role', ['owner', 'admin']);
    expect(sendNewInquiryNotification).toHaveBeenCalledTimes(2);
    const sentEmails = (sendNewInquiryNotification as jest.Mock).mock.calls.map((c) => c[0].facilityEmail).sort();
    expect(sentEmails).toEqual(['admin1@example.com', 'owner1@example.com']);
  });

  test('owner+adminが同じメールアドレス → 重複排除で1通のみ', async () => {
    const { membersRoleFilter } = setupDefaultMocks({
      ownerUserIds: ['owner-1', 'admin-1'],
      ownerEmails: ['shared@example.com', 'shared@example.com'],
    });
    await POST(makeRequest(validInquiry) as any);
    expect(membersRoleFilter).toHaveBeenCalledWith('role', ['owner', 'admin']);
    expect(sendNewInquiryNotification).toHaveBeenCalledTimes(1);
    expect((sendNewInquiryNotification as jest.Mock).mock.calls[0][0].facilityEmail).toBe('shared@example.com');
  });

  test('オーナー0件 → 通知は送られない（保存自体は200のまま）', async () => {
    setupDefaultMocks({ ownerUserIds: [], ownerEmails: [] });
    const res = await POST(makeRequest(validInquiry) as any);
    expect(res.status).toBe(200);
    expect(sendNewInquiryNotification).not.toHaveBeenCalled();
  });

  test('email が null のオーナーは送信対象から除外される', async () => {
    setupDefaultMocks({ ownerUserIds: ['owner-1'], ownerEmails: [null] });
    await POST(makeRequest(validInquiry) as any);
    expect(sendNewInquiryNotification).not.toHaveBeenCalled();
  });

  test('facility_members クエリが data:null を返しても例外にならず通知スキップ（?? [] フォールバック）', async () => {
    setupDefaultMocks({ ownerRowsDataNull: true });
    const res = await POST(makeRequest(validInquiry) as any);
    expect(res.status).toBe(200);
    expect(sendNewInquiryNotification).not.toHaveBeenCalled();
  });

  test('profiles クエリが data:null を返しても例外にならず通知スキップ（?? [] フォールバック）', async () => {
    setupDefaultMocks({ ownerUserIds: ['owner-1'], ownerProfilesDataNull: true });
    const res = await POST(makeRequest(validInquiry) as any);
    expect(res.status).toBe(200);
    expect(sendNewInquiryNotification).not.toHaveBeenCalled();
  });

  test('通知送信が false を返す（失敗）→ 保存は200のまま、失敗は無音にせず可視化する', async () => {
    setupDefaultMocks({ ownerUserIds: ['owner-1'], ownerEmails: ['owner1@example.com'] });
    (sendNewInquiryNotification as jest.Mock).mockResolvedValue(false);
    const res = await POST(makeRequest(validInquiry) as any);
    expect(res.status).toBe(200);
    expect(safeCaptureException).toHaveBeenCalledWith(expect.any(Error), 'inquiry-email-owner');
    expect(alertCaughtError).toHaveBeenCalledWith('inquiry-email-owner', expect.any(Error), '/api/inquiry');
  });

  test('通知送信が例外を投げる → catchされ保存は200のまま、失敗は可視化される', async () => {
    setupDefaultMocks({ ownerUserIds: ['owner-1'], ownerEmails: ['owner1@example.com'] });
    (sendNewInquiryNotification as jest.Mock).mockRejectedValue(new Error('network down'));
    const res = await POST(makeRequest(validInquiry) as any);
    expect(res.status).toBe(200);
    expect(safeCaptureException).toHaveBeenCalledWith(expect.any(Error), 'inquiry-email-owner');
    expect(alertCaughtError).toHaveBeenCalledWith('inquiry-email-owner', expect.any(Error), '/api/inquiry');
  });
});

// 【2026年7月16日 恒久根治】/api/notify（認証なし公開POST・偽Slackアラート経路）廃止に伴い、
// Slack通知は保存成功後にこのサーバーから sendNotify を type:'facility_inquiry' で直接呼ぶ
// （contact.ts/salons.ts と同型の fire-and-forget）。従来 InquiryForm.tsx がクライアントの
// facilityName prop を使っていたが、なりすまし防止と表示の一貫性のためサーバー権威の
// facility.name を使うことも合わせて検証する。
describe('Slack通知（sendNotify 直接呼び出し・fire-and-forget）', () => {
  test('保存成功 → sendNotify が type:facility_inquiry で、サーバー権威の facility.name を使って呼ばれる', async () => {
    await POST(makeRequest(validInquiry) as any);

    expect(sendNotify).toHaveBeenCalledWith({
      type: 'facility_inquiry',
      data: {
        facility_name: 'リラクサロン ABC', // facility_profiles から取得した値（クライアント値は使わない）
        name: validInquiry.name,
        email: validInquiry.email,
        phone: validInquiry.phone,
        message: validInquiry.message,
      },
    });
  });

  test('phone未指定 → sendNotify の phone は「未入力」', async () => {
    const { phone, ...rest } = validInquiry;
    void phone;
    await POST(makeRequest(rest) as any);

    const call = (sendNotify as jest.Mock).mock.calls[0][0];
    expect(call.data.phone).toBe('未入力');
  });

  test('DB insert失敗時は sendNotify が呼ばれない（保存に成功した場合のみ通知）', async () => {
    setupDefaultMocks({ insertError: true });
    const res = await POST(makeRequest(validInquiry) as any);
    expect(res.status).toBe(500);
    expect(sendNotify).not.toHaveBeenCalled();
  });

  test('施設が見つからない場合は sendNotify が呼ばれない', async () => {
    setupDefaultMocks({ noFacility: true });
    const res = await POST(makeRequest(validInquiry) as any);
    expect(res.status).toBe(404);
    expect(sendNotify).not.toHaveBeenCalled();
  });

  test('sendNotify が ok:false を返しても 200（通知失敗はログのみ・本体は成功のまま）', async () => {
    (sendNotify as jest.Mock).mockResolvedValue({ ok: false, error: 'not_configured' });
    const res = await POST(makeRequest(validInquiry) as any);
    expect(res.status).toBe(200);
    expect(sendNotify).toHaveBeenCalled();
  });

  test('sendNotify が例外を投げても 200（fire-and-forget・本体を止めない）', async () => {
    (sendNotify as jest.Mock).mockRejectedValue(new Error('network error'));
    const res = await POST(makeRequest(validInquiry) as any);
    expect(res.status).toBe(200);
  });
});
