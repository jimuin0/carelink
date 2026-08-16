/**
 * @jest-environment node
 *
 * Tests for POST /api/admin/inquiries/[id]/reply
 *
 * このエンドポイントは「送ったつもりで届いていない」が最も致命的（相手は返事を待ち続けるのに
 * 運営は対応済みと誤認する）。メール送信の成否と contact_replies への記録が食い違わないことを
 * 退行させないよう固定する。
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn() }));

const INQUIRY_UUID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '33333333-3333-3333-3333-333333333333';

const mockAdminFrom = jest.fn();
const mockAnonFrom = jest.fn();
const mockGetUser = jest.fn();
const mockSendInquiryReply = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom }),
}));
jest.mock('@/lib/email', () => ({
  sendInquiryReply: (...args: unknown[]) => mockSendInquiryReply(...args),
}));

import { NextRequest, NextResponse } from 'next/server';
import { POST } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';

function makeRequest(body: object = { body: 'ご連絡ありがとうございます。' }) {
  return new NextRequest(`http://localhost/api/admin/inquiries/${INQUIRY_UUID}/reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeProps(id = INQUIRY_UUID) {
  return { params: Promise.resolve({ id }) };
}

// profiles.select('is_platform_admin, display_name').eq('id').single()
function profileChain(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

// contacts.select(...).eq('id').maybeSingle()
function contactChain(data: unknown, error: unknown = null) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn(() => Promise.resolve({ data, error })),
  };
}

const insertMock = jest.fn(() => Promise.resolve({ error: null }));
const updateEqMock = jest.fn(() => Promise.resolve({ error: null }));

function repliesChain() {
  return { insert: insertMock };
}
function contactsUpdateChain() {
  return { update: jest.fn().mockReturnValue({ eq: updateEqMock }) };
}

const CONTACT = { id: INQUIRY_UUID, name: '山田太郎', email: 'customer@example.com' };

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  mockAnonFrom.mockReturnValue(profileChain({ is_platform_admin: true, display_name: '運営担当' }));
  mockSendInquiryReply.mockResolvedValue(true);
  // 1回目: contacts 取得 / 2回目: contact_replies insert / 3回目: contacts 更新
  mockAdminFrom
    .mockReturnValueOnce(contactChain(CONTACT))
    .mockReturnValueOnce(repliesChain())
    .mockReturnValueOnce(contactsUpdateChain());
});

describe('POST /api/admin/inquiries/[id]/reply', () => {
  test('管理者が返信するとメールが送られ contact_replies に記録される', async () => {
    const res = await POST(makeRequest(), makeProps());
    expect(res.status).toBe(200);

    expect(mockSendInquiryReply).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'customer@example.com', inquirerName: '山田太郎' })
    );
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ contact_id: INQUIRY_UUID, author_id: USER_ID, is_internal: false })
    );
  });

  // 最重要の不変条件：送信できていないのに「返信済み」と記録すると、相手は待ち続けるのに
  // 運営は対応済みと誤認する。送信失敗時は記録せず 502 を返すこと。
  test('メール送信に失敗したら記録せず502を返す', async () => {
    mockSendInquiryReply.mockResolvedValue(false);

    const res = await POST(makeRequest(), makeProps());
    expect(res.status).toBe(502);
    expect(insertMock).not.toHaveBeenCalled();
  });

  test('プラットフォーム管理者でなければ401', async () => {
    mockAnonFrom.mockReturnValue(profileChain({ is_platform_admin: false, display_name: null }));

    const res = await POST(makeRequest(), makeProps());
    expect(res.status).toBe(401);
    expect(mockSendInquiryReply).not.toHaveBeenCalled();
  });

  test('未ログインなら401', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const res = await POST(makeRequest(), makeProps());
    expect(res.status).toBe(401);
    expect(mockSendInquiryReply).not.toHaveBeenCalled();
  });

  test('存在しないチケットは404', async () => {
    mockAdminFrom.mockReset();
    mockAdminFrom.mockReturnValueOnce(contactChain(null));

    const res = await POST(makeRequest(), makeProps());
    expect(res.status).toBe(404);
    expect(mockSendInquiryReply).not.toHaveBeenCalled();
  });

  test('メールアドレス未登録の問い合わせには送信せず400', async () => {
    mockAdminFrom.mockReset();
    mockAdminFrom.mockReturnValueOnce(contactChain({ ...CONTACT, email: null }));

    const res = await POST(makeRequest(), makeProps());
    expect(res.status).toBe(400);
    expect(mockSendInquiryReply).not.toHaveBeenCalled();
  });

  test('本文が空なら400（空メールを送らない）', async () => {
    const res = await POST(makeRequest({ body: '   ' }), makeProps());
    expect(res.status).toBe(400);
    expect(mockSendInquiryReply).not.toHaveBeenCalled();
  });

  test('不正なIDは400', async () => {
    const res = await POST(makeRequest(), makeProps('not-a-uuid'));
    expect(res.status).toBe(400);
    expect(mockSendInquiryReply).not.toHaveBeenCalled();
  });

  test('レート制限超過は429', async () => {
    (checkRateLimit as jest.Mock).mockResolvedValueOnce(true);

    const res = await POST(makeRequest(), makeProps());
    expect(res.status).toBe(429);
    expect(mockSendInquiryReply).not.toHaveBeenCalled();
  });

  // CSRF 検証は最初のゲート。ここを通り抜けると外部サイトから返信送信を仕掛けられる。
  test('CSRF検証に失敗したら送信しない', async () => {
    const { checkCsrf } = jest.requireMock('@/lib/csrf');
    (checkCsrf as jest.Mock).mockReturnValueOnce(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    );

    const res = await POST(makeRequest(), makeProps());
    expect(res.status).toBe(403);
    expect(mockSendInquiryReply).not.toHaveBeenCalled();
  });

  test('contacts 取得エラーは500', async () => {
    mockAdminFrom.mockReset();
    mockAdminFrom.mockReturnValueOnce(contactChain(null, { message: 'boom' }));

    const res = await POST(makeRequest(), makeProps());
    expect(res.status).toBe(500);
  });

  // 送信は完了しているため、履歴保存の失敗で 500 を返すと運営が二重送信しかねない。
  test('履歴保存に失敗しても送信済みなら成功を返す', async () => {
    mockAdminFrom.mockReset();
    mockAdminFrom
      .mockReturnValueOnce(contactChain(CONTACT))
      .mockReturnValueOnce({ insert: jest.fn(() => Promise.resolve({ error: { message: 'insert failed' } })) })
      .mockReturnValueOnce(contactsUpdateChain());

    const res = await POST(makeRequest(), makeProps());
    expect(res.status).toBe(200);
  });

  test('返信後はチケットを対応中へ進める', async () => {
    await POST(makeRequest(), makeProps());
    expect(updateEqMock).toHaveBeenCalledWith('id', INQUIRY_UUID);
  });

  test('display_name が無くても送信できる', async () => {
    mockAnonFrom.mockReturnValue(profileChain({ is_platform_admin: true, display_name: null }));

    const res = await POST(makeRequest(), makeProps());
    expect(res.status).toBe(200);
    // contact_replies.author_name は NOT NULL DEFAULT '担当者'（migration 20260417000008）。
    // display_name が null のときに author_name: null を明示挿入すると NOT NULL 制約違反で
    // insert が失敗する実バグだったため、route.ts 側は author_name キー自体を省略して
    // DB の DEFAULT '担当者' に委ねるよう修正済み。このテストは旧・誤った期待値
    // （author_name: null が渡ること）を検証していたので、修正後の正しい挙動
    // （author_name キーを渡さないこと）に合わせて更新する。
    expect(insertMock).toHaveBeenCalled();
    const insertedRow = insertMock.mock.calls[0][0];
    expect(insertedRow).not.toHaveProperty('author_name');
  });

  test('名前が無い問い合わせには既定の敬称で送る', async () => {
    mockAdminFrom.mockReset();
    mockAdminFrom
      .mockReturnValueOnce(contactChain({ ...CONTACT, name: null }))
      .mockReturnValueOnce(repliesChain())
      .mockReturnValueOnce(contactsUpdateChain());

    await POST(makeRequest(), makeProps());
    expect(mockSendInquiryReply).toHaveBeenCalledWith(
      expect.objectContaining({ inquirerName: 'お客様' })
    );
  });

  test('JSONでない本文は400', async () => {
    const req = new NextRequest(`http://localhost/api/admin/inquiries/${INQUIRY_UUID}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });

    const res = await POST(req, makeProps());
    expect(res.status).toBe(400);
  });
});
