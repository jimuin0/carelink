/**
 * @jest-environment node
 *
 * Inquiry replies reserve a durable operation row before contacting Resend.
 * Tests use only synthetic rows and an in-memory database/provider.
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn() }));

const INQUIRY_UUID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const OPERATION_ID = '44444444-4444-4444-4444-444444444444';
const CONTACT = { id: INQUIRY_UUID, name: '合成問い合わせ', email: 'synthetic@example.invalid', ticket_status: 'open' };

const mockAdminFrom = jest.fn();
const mockAnonFrom = jest.fn();
const mockGetUser = jest.fn();
const mockSendInquiryReply = jest.fn();
const mockReconcileInquiryReply = jest.fn();
const mockBuildInquiryReplyEnvelope = jest.fn();
const PROVIDER_ID = '55555555-5555-4555-8555-555555555555';
const ENVELOPE = { from: 'Test <support@example.invalid>', to: CONTACT.email,
  replyTo: 'Test <support@example.invalid>', subject: '合成件名', html: '<p>合成本文</p>' };
let contacts: Array<Record<string, unknown>>;
let replies: Array<Record<string, unknown>>;
let failSentUpdate = false;
let sentUpdateCommittedBeforeError = false;
let sentUpdateReturnsNoRows = false;
let failTicketUpdate = false;
let ticketUpdateReturnsNoRows = false;
let replyReadFailure: 'contact' | 'operation' | 'operation-after-insert' | 'pending' | 'sent' | null = null;
let insertConflict: null | 'missing' | 'contact' | 'internal' | 'body' = null;
let insertAttempted = false;
let mockConsoleError: jest.SpyInstance;

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server-auth', () => ({
  createServerSupabaseAuthClient: async () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom }),
}));
jest.mock('@/lib/email', () => ({
  buildInquiryReplyEnvelope: (data: { to: string }) => mockBuildInquiryReplyEnvelope(data),
  deliverInquiryReply: async (envelope: unknown, operationId: string) => {
    const result = await mockSendInquiryReply({ ...(envelope as object), idempotencyKey: operationId });
    return result ? { state: 'accepted', messageId: PROVIDER_ID } : { state: 'unknown' };
  },
  reconcileInquiryReply: (...args: unknown[]) => mockReconcileInquiryReply(...args),
}));

import { NextRequest, NextResponse } from 'next/server';
import { GET, POST } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';

function profileChain(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

function matches(row: Record<string, unknown>, filters: Record<string, unknown>) {
  return Object.entries(filters).every(([key, value]) => {
    if (value === '__not_null__') return row[key] !== null && row[key] !== undefined;
    return row[key] === value;
  });
}

function tableQuery(table: 'contacts' | 'contact_replies') {
  const filters: Record<string, unknown> = {};
  let updateValues: Record<string, unknown> | null = null;
  let maxRows: number | null = null;
  const rows = () => (table === 'contacts' ? contacts : replies).filter((row) => matches(row, filters));
  const chain: Record<string, any> = {
    select: jest.fn(() => chain),
    eq: jest.fn((key: string, value: unknown) => { filters[key] = value; return chain; }),
    is: jest.fn((key: string, value: unknown) => { filters[key] = value; return chain; }),
    not: jest.fn((key: string, operator: string, value: unknown) => {
      if (operator === 'is' && value === null) filters[key] = '__not_null__';
      return chain;
    }),
    order: jest.fn(() => chain),
    limit: jest.fn((value: number) => { maxRows = value; return chain; }),
    maybeSingle: jest.fn(async () => {
      const readKind = table === 'contacts'
        ? 'contact'
        : filters.id
          ? 'operation'
          : filters.sent_at === '__not_null__'
            ? 'sent'
            : filters.sent_at === null
              ? 'pending'
              : null;
      if (readKind && (replyReadFailure === readKind
        || (readKind === 'operation' && replyReadFailure === 'operation-after-insert' && insertAttempted))) {
        replyReadFailure = null;
        return { data: null, error: { code: '08006' } };
      }
      const selected = rows().slice(0, maxRows ?? undefined);
      return selected.length > 1 ? { data: null, error: { code: 'PGRST116' } } : { data: selected[0] ?? null, error: null };
    }),
    insert: jest.fn(async (values: Record<string, unknown>) => {
      insertAttempted = true;
      if (insertConflict) {
        const conflict = insertConflict;
        insertConflict = null;
        if (conflict !== 'missing') {
          replies.push({
            author_name: '担当者', sent_at: null, created_at: new Date().toISOString(), ...values,
            ...(conflict === 'contact' ? { contact_id: '77777777-7777-4777-8777-777777777777' } : {}),
            ...(conflict === 'internal' ? { is_internal: true } : {}),
            ...(conflict === 'body' ? { body: '別の合成本文' } : {}),
          });
        }
        return { error: { code: '23505' } };
      }
      if (replies.some((row) => row.id === values.id)) return { error: { code: '23505' } };
      if (replies.some((row) => row.contact_id === values.contact_id && row.is_internal === false && row.sent_at === null)) {
        return { error: { code: '23505' } };
      }
      replies.push({ author_name: '担当者', sent_at: null, created_at: new Date().toISOString(), ...values });
      return { error: null };
    }),
    update: jest.fn((values: Record<string, unknown>) => { updateValues = values; return chain; }),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve().then(() => {
      const selected = rows();
      if (table === 'contact_replies' && updateValues?.sent_at && failSentUpdate) {
        failSentUpdate = false;
        if (sentUpdateCommittedBeforeError) {
          for (const row of selected) Object.assign(row, updateValues);
          sentUpdateCommittedBeforeError = false;
        }
        return { data: null, error: { code: '08006' } };
      }
      if (table === 'contact_replies' && updateValues?.sent_at && sentUpdateReturnsNoRows) {
        sentUpdateReturnsNoRows = false;
        return { data: [], error: null };
      }
      if (table === 'contacts' && updateValues?.ticket_status && failTicketUpdate) {
        failTicketUpdate = false;
        return { data: null, error: { code: '08006' } };
      }
      if (table === 'contacts' && updateValues?.ticket_status && ticketUpdateReturnsNoRows) {
        ticketUpdateReturnsNoRows = false;
        return { data: [], error: null };
      }
      for (const row of selected) Object.assign(row, updateValues);
      return { data: selected.map((row) => ({ id: row.id })), error: null };
    }).then(resolve, reject),
  };
  return chain;
}

function makeRequest(body: object = { body: '合成本文です', operationId: OPERATION_ID }) {
  return new NextRequest('http://localhost/api/admin/inquiries/' + INQUIRY_UUID + '/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeProps(id = INQUIRY_UUID) {
  return { params: Promise.resolve({ id }) };
}

function seedPending(overrides: Record<string, unknown> = {}) {
  replies.push({
    id: OPERATION_ID, contact_id: INQUIRY_UUID, author_id: USER_ID, author_name: '運営担当',
    body: '合成本文です', is_internal: false, sent_at: null, created_at: new Date().toISOString(),
    delivery_envelope: ENVELOPE, provider_message_id: null,
    ...overrides,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  contacts = [{ ...CONTACT }];
  replies = [];
  failSentUpdate = false;
  sentUpdateCommittedBeforeError = false;
  sentUpdateReturnsNoRows = false;
  failTicketUpdate = false;
  ticketUpdateReturnsNoRows = false;
  replyReadFailure = null;
  insertConflict = null;
  insertAttempted = false;
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  mockAnonFrom.mockReturnValue(profileChain({ is_platform_admin: true, display_name: '運営担当' }));
  mockSendInquiryReply.mockResolvedValue(true);
  mockBuildInquiryReplyEnvelope.mockImplementation((data: { to: string }) => ({ ...ENVELOPE, to: data.to }));
  mockReconcileInquiryReply.mockResolvedValue({ state: 'unknown' });
  mockAdminFrom.mockImplementation((table: string) => {
    if (table === 'contacts' || table === 'contact_replies') return tableQuery(table);
    throw new Error('unexpected table');
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('POST /api/admin/inquiries/[id]/reply', () => {
  test('照合時のDB読取失敗はproviderを呼ばず500にする', async () => {
    seedPending();
    replyReadFailure = 'operation';
    const response = await POST(makeRequest({ action: 'reconcile', operationId: OPERATION_ID, providerMessageId: PROVIDER_ID }), makeProps());
    expect(response.status).toBe(500);
    expect(mockReconcileInquiryReply).not.toHaveBeenCalled();
    expect(mockSendInquiryReply).not.toHaveBeenCalled();
  });

  test('不正な送信設定を予約も送信もせず400にする', async () => {
    mockBuildInquiryReplyEnvelope.mockReturnValue({ ...ENVELOPE, to: 'invalid' });
    expect((await POST(makeRequest(), makeProps())).status).toBe(400);
    expect(replies).toHaveLength(0);
    expect(mockSendInquiryReply).not.toHaveBeenCalled();
  });
  test('23時間後も受理証拠を照合でき、返信を再送しない', async () => {
    seedPending({ created_at: new Date(Date.now() - 48 * 3600000).toISOString() });
    mockReconcileInquiryReply.mockResolvedValue({ state: 'accepted', messageId: PROVIDER_ID });
    const response = await POST(makeRequest({ action: 'reconcile', operationId: OPERATION_ID, providerMessageId: PROVIDER_ID }), makeProps());
    expect(response.status).toBe(200);
    expect(replies[0]).toMatchObject({ provider_message_id: PROVIDER_ID, sent_at: expect.any(String) });
    expect(mockSendInquiryReply).not.toHaveBeenCalled();
    expect(mockReconcileInquiryReply).toHaveBeenCalledWith(ENVELOPE, OPERATION_ID, PROVIDER_ID, replies[0].created_at);
    const again = await POST(makeRequest({ action: 'reconcile', operationId: OPERATION_ID, providerMessageId: PROVIDER_ID }), makeProps());
    expect(await again.json()).toMatchObject({ ok: true, alreadySent: true });
    expect(mockReconcileInquiryReply).toHaveBeenCalledTimes(1);
  });

  test('照合の記録成功後にticket更新だけ失敗しても同じ照合で復旧できる', async () => {
    seedPending();
    contacts[0].ticket_status = 'resolved';
    contacts[0].resolved_at = '2026-01-01T00:00:00Z';
    failTicketUpdate = true;
    mockReconcileInquiryReply.mockResolvedValue({ state: 'accepted', messageId: PROVIDER_ID });
    const request = { action: 'reconcile', operationId: OPERATION_ID, providerMessageId: PROVIDER_ID };
    expect(await (await POST(makeRequest(request), makeProps())).json()).toMatchObject({ warning: 'ticket_status_update_failed' });
    expect(contacts[0].resolved_at).not.toBeNull();
    failTicketUpdate = true;
    expect(await (await POST(makeRequest(request), makeProps())).json()).toMatchObject({ ok: true, alreadySent: true, warning: 'ticket_status_update_failed' });
    expect(await (await POST(makeRequest(request), makeProps())).json()).toMatchObject({ ok: true, warning: null });
    expect(contacts[0]).toMatchObject({ ticket_status: 'in_progress', resolved_at: null });
    expect(mockReconcileInquiryReply).toHaveBeenCalledTimes(1);
    expect(mockSendInquiryReply).not.toHaveBeenCalled();
  });

  test.each([
    { contact_id: '77777777-7777-4777-8777-777777777777' }, { is_internal: true },
    { delivery_envelope: null }, { sent_at: '2026-01-01T00:00:00Z', provider_message_id: '66666666-6666-4666-8666-666666666666' },
  ])('照合の所属・旧履歴・確定記録の不一致を解除しない %j', async (override) => {
    seedPending(override);
    const response = await POST(makeRequest({ action: 'reconcile', operationId: OPERATION_ID, providerMessageId: PROVIDER_ID }), makeProps());
    expect(response.status).toBe(409);
    expect(mockSendInquiryReply).not.toHaveBeenCalled();
    expect(mockReconcileInquiryReply).not.toHaveBeenCalled();
  });

  test('証拠不足ならunknownを保持し別operationの送信を禁止する', async () => {
    seedPending();
    const response = await POST(makeRequest({ action: 'reconcile', operationId: OPERATION_ID, providerMessageId: PROVIDER_ID }), makeProps());
    expect(response.status).toBe(409);
    expect(replies[0].sent_at).toBeNull();
    expect((await POST(makeRequest({ body: '合成別返信', operationId: '66666666-6666-4666-8666-666666666666' }), makeProps())).status).toBe(409);
    expect(mockSendInquiryReply).not.toHaveBeenCalled();
  });

  test('照合でも記録失敗は成功にしない。provider IDを復旧用に返す', async () => {
    seedPending();
    failSentUpdate = true;
    mockReconcileInquiryReply.mockResolvedValue({ state: 'accepted', messageId: PROVIDER_ID });
    const response = await POST(makeRequest({ action: 'reconcile', operationId: OPERATION_ID, providerMessageId: PROVIDER_ID }), makeProps());
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ pending: true, providerMessageId: PROVIDER_ID });
    expect(replies[0].sent_at).toBeNull();
    expect(mockSendInquiryReply).not.toHaveBeenCalled();
  });

  test('連絡先が変更されても再試行は予約済み送信内容だけを使う', async () => {
    seedPending();
    contacts[0].email = 'changed@example.invalid';
    const response = await POST(makeRequest(), makeProps());
    expect(response.status).toBe(200);
    expect(mockSendInquiryReply).toHaveBeenCalledWith({ ...ENVELOPE, idempotencyKey: OPERATION_ID });
  });

  test('旧unknownの本文を再構築して送信しない', async () => {
    seedPending({ delivery_envelope: null });
    const response = await POST(makeRequest(), makeProps());
    expect(response.status).toBe(409);
    expect(mockSendInquiryReply).not.toHaveBeenCalled();
  });
  test('返信を先に予約しprovider冪等キーと同じ操作IDで一度送信する', async () => {
    mockSendInquiryReply.mockImplementation(async (data: Record<string, unknown>) => {
      expect(replies).toHaveLength(1);
      expect(replies[0]).toMatchObject({ id: OPERATION_ID, sent_at: null, body: '合成本文です' });
      expect(data.idempotencyKey).toBe(OPERATION_ID);
      return true;
    });
    const res = await POST(makeRequest(), makeProps());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, alreadySent: false, warning: null });
    expect(replies[0].sent_at).toEqual(expect.any(String));
    expect(mockSendInquiryReply).toHaveBeenCalledTimes(1);
  });

  test('結果不明後の同一操作再試行は同じproviderキーを再利用する', async () => {
    mockSendInquiryReply.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    expect((await POST(makeRequest(), makeProps())).status).toBe(502);
    expect(replies[0].sent_at).toBeNull();
    expect((await POST(makeRequest(), makeProps())).status).toBe(200);
    expect(replies[0].sent_at).toEqual(expect.any(String));
    expect(mockSendInquiryReply.mock.calls.map(([arg]) => arg.idempotencyKey)).toEqual([OPERATION_ID, OPERATION_ID]);
  });

  test('解決済みチケットへの返信は対応中と解決日時を一緒に更新する', async () => {
    contacts[0].ticket_status = 'resolved';
    contacts[0].resolved_at = '2026-01-01T00:00:00.000Z';
    expect((await POST(makeRequest(), makeProps())).status).toBe(200);
    expect(contacts[0]).toMatchObject({ ticket_status: 'in_progress', resolved_at: null });
  });

  test('送信済みoperationの再POSTはproviderを再呼出ししない', async () => {
    seedPending({ sent_at: new Date().toISOString() });
    failTicketUpdate = true;
    const res = await POST(makeRequest(), makeProps());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, alreadySent: true, warning: 'ticket_status_update_failed' });
    expect(mockSendInquiryReply).not.toHaveBeenCalled();
  });

  test('同じ操作IDの本文差替えを409で拒否する', async () => {
    seedPending();
    expect((await POST(makeRequest({ body: '別の内容', operationId: OPERATION_ID }), makeProps())).status).toBe(409);
    expect(mockSendInquiryReply).not.toHaveBeenCalled();
  });

  test.each(['missing', 'contact', 'internal', 'body'] as const)(
    'insert競合後の再読込が操作ID／ticket／種別／本文の異なる行を拒否する（%s）',
    async (conflict) => {
      insertConflict = conflict;
      expect((await POST(makeRequest(), makeProps())).status).toBe(409);
      expect(mockSendInquiryReply).not.toHaveBeenCalled();
    },
  );

  test('同じ操作ID・本文の一意競合は既存操作を再利用して進める', async () => {
    insertConflict = null;
    const originalInsert = tableQuery;
    // Simulate a competing request committing the exact reservation between the first
    // read and INSERT; the route must reread and continue with that exact operation.
    const competingReply = {
      id: OPERATION_ID, contact_id: INQUIRY_UUID, author_id: USER_ID, author_name: '運営担当',
      body: '合成本文です', is_internal: false, sent_at: null, created_at: new Date().toISOString(),
      delivery_envelope: ENVELOPE, provider_message_id: null,
    };
    replies = [];
    mockAdminFrom.mockImplementation((table: string) => {
      const query = originalInsert(table as 'contacts' | 'contact_replies');
      if (table !== 'contact_replies') return query;
      const insert = query.insert as jest.Mock;
      insert.mockImplementationOnce(async () => {
        replies.push(competingReply);
        return { error: { code: '23505' } };
      });
      return query;
    });

    const res = await POST(makeRequest(), makeProps());
    expect(res.status).toBe(200);
    expect(replies).toHaveLength(1);
    expect(mockSendInquiryReply).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: OPERATION_ID }));
  });

  test('一意競合後の操作再読込が失敗した場合はproviderへ送らない', async () => {
    insertConflict = 'missing';
    replyReadFailure = 'operation-after-insert';

    const res = await POST(makeRequest(), makeProps());

    expect(res.status).toBe(500);
    expect(mockSendInquiryReply).not.toHaveBeenCalled();
  });

  test('別operation IDで既存pendingを並行送信する要求を拒否する', async () => {
    seedPending();
    const otherId = '55555555-5555-4555-8555-555555555555';
    expect((await POST(makeRequest({ body: '別の操作', operationId: otherId }), makeProps())).status).toBe(409);
    expect(replies).toHaveLength(1);
    expect(mockSendInquiryReply).not.toHaveBeenCalled();
  });

  test('冪等保持期間を超えたpendingを自動再送しない', async () => {
    seedPending({ created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() });
    expect((await POST(makeRequest(), makeProps())).status).toBe(409);
    expect(mockSendInquiryReply).not.toHaveBeenCalled();
  });

  test('provider受理後の履歴更新失敗を同一IDで照合する', async () => {
    failSentUpdate = true;
    expect((await POST(makeRequest(), makeProps())).status).toBe(500);
    expect(replies[0].sent_at).toBeNull();
    expect((await POST(makeRequest(), makeProps())).status).toBe(200);
    expect(replies[0].sent_at).toEqual(expect.any(String));
    expect(mockSendInquiryReply.mock.calls.map(([arg]) => arg.idempotencyKey)).toEqual([OPERATION_ID, OPERATION_ID]);
  });

  test.each([false, true])('DBがsent_atを書いた後に応答だけ失われても成功として照合する（ticket更新失敗=%s）', async (ticketUpdateFails) => {
    failSentUpdate = true;
    sentUpdateCommittedBeforeError = true;
    failTicketUpdate = ticketUpdateFails;
    const res = await POST(makeRequest(), makeProps());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      alreadySent: true,
      warning: ticketUpdateFails ? 'ticket_status_update_failed' : null,
    });
    expect(replies[0].sent_at).toEqual(expect.any(String));
    expect(mockSendInquiryReply).toHaveBeenCalledTimes(1);
  });

  test('sent_at更新が0行なら成功にせず同一operationの照合を促す', async () => {
    sentUpdateReturnsNoRows = true;
    const res = await POST(makeRequest(), makeProps());
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ pending: true });
    expect(mockSendInquiryReply).toHaveBeenCalledTimes(1);
  });

  test('ticket状態更新失敗を警告に分離し再POSTで再送しない', async () => {
    failTicketUpdate = true;
    const first = await POST(makeRequest(), makeProps());
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ ok: true, warning: 'ticket_status_update_failed' });
    expect((await POST(makeRequest(), makeProps())).status).toBe(200);
    expect(mockSendInquiryReply).toHaveBeenCalledTimes(1);
  });

  test('ticket statusの0行更新はメールを再送せず警告する', async () => {
    ticketUpdateReturnsNoRows = true;
    const res = await POST(makeRequest(), makeProps());
    expect(await res.json()).toMatchObject({ ok: true, warning: 'ticket_status_update_failed' });
    expect(mockSendInquiryReply).toHaveBeenCalledTimes(1);
  });

  test('予約済operation照会のDB失敗ではproviderを呼ばない', async () => {
    replyReadFailure = 'operation';
    expect((await POST(makeRequest(), makeProps())).status).toBe(500);
    expect(mockSendInquiryReply).not.toHaveBeenCalled();
  });

  test('未確定返信照会のDB失敗では新しい返信を予約しない', async () => {
    replyReadFailure = 'pending';
    expect((await POST(makeRequest(), makeProps())).status).toBe(500);
    expect(replies).toHaveLength(0);
    expect(mockSendInquiryReply).not.toHaveBeenCalled();
  });

  test('問い合わせ読取のDB失敗を汎用500へ変換する', async () => {
    replyReadFailure = 'contact';
    const res = await POST(makeRequest(), makeProps());
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('synthetic@example.invalid');
    expect(mockSendInquiryReply).not.toHaveBeenCalled();
  });

  test('未認証・非admin・CSRF失敗では送信しない', async () => {
    mockAnonFrom.mockReturnValue(profileChain({ is_platform_admin: false, display_name: null }));
    expect((await POST(makeRequest(), makeProps())).status).toBe(401);
    mockAnonFrom.mockReturnValue(profileChain({ is_platform_admin: true, display_name: '運営担当' }));
    mockGetUser.mockResolvedValue({ data: { user: null } });
    expect((await POST(makeRequest(), makeProps())).status).toBe(401);
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
    const { checkCsrf } = jest.requireMock('@/lib/csrf');
    (checkCsrf as jest.Mock).mockReturnValueOnce(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    expect((await POST(makeRequest(), makeProps())).status).toBe(403);
    expect(mockSendInquiryReply).not.toHaveBeenCalled();
  });

  test('壊れたJSON・operation UUID欠損・空本文を拒否する', async () => {
    const malformed = new NextRequest('http://localhost/api/admin/inquiries/' + INQUIRY_UUID + '/reply', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'not json',
    });
    expect((await POST(malformed, makeProps())).status).toBe(400);
    expect((await POST(makeRequest({ body: 'text' }), makeProps())).status).toBe(400);
    expect((await POST(makeRequest({ body: '  ', operationId: OPERATION_ID }), makeProps())).status).toBe(400);
    expect(mockSendInquiryReply).not.toHaveBeenCalled();
  });

  test('不正ID、存在しないticket、メールなしを拒否する', async () => {
    expect((await POST(makeRequest(), makeProps('not-a-uuid'))).status).toBe(400);
    contacts = [];
    expect((await POST(makeRequest(), makeProps())).status).toBe(404);
    contacts = [{ ...CONTACT, email: null }];
    expect((await POST(makeRequest(), makeProps())).status).toBe(400);
    expect(mockSendInquiryReply).not.toHaveBeenCalled();
  });

  test('表示名が未設定でもDB defaultを使い、送信成功を記録する', async () => {
    mockAnonFrom.mockReturnValue(profileChain({ is_platform_admin: true, display_name: null }));
    const res = await POST(makeRequest(), makeProps());
    expect(res.status).toBe(200);
    expect(replies[0]).toMatchObject({ author_name: '担当者', sent_at: expect.any(String) });
  });

  test('問い合わせ者名が欠損しても固定fallbackで送信できる', async () => {
    contacts = [{ ...CONTACT, name: null }];
    const res = await POST(makeRequest(), makeProps());
    expect(res.status).toBe(200);
    expect(mockBuildInquiryReplyEnvelope).toHaveBeenCalledWith(expect.objectContaining({ inquirerName: 'お客様' }));
  });

  test('認証依存の例外を機密を含まないno-store 500へ変換する', async () => {
    mockGetUser.mockRejectedValue(new Error('private@example.invalid credential detail'));
    const res = await POST(makeRequest(), makeProps());
    expect(res.status).toBe(500);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.text();
    expect(body).toContain('サーバーエラーが発生しました');
    expect(body).not.toContain('private@example.invalid');
    expect(mockConsoleError.mock.calls.flat().join(' ')).not.toContain('private@example.invalid');
  });

  test('rate limitを429で拒否する', async () => {
    (checkRateLimit as jest.Mock).mockResolvedValueOnce(true);
    expect((await POST(makeRequest(), makeProps())).status).toBe(429);
    expect(mockSendInquiryReply).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/inquiries/[id]/reply', () => {
  test('最新返信をno-storeで返し冪等保持期間内だけretryableとする', async () => {
    seedPending({ created_at: new Date(Date.now() - 22 * 60 * 60 * 1000).toISOString() });
    const res = await GET(new NextRequest('http://localhost/api/admin/inquiries/' + INQUIRY_UUID + '/reply'), makeProps());
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toMatchObject({ reply: { operationId: OPERATION_ID, body: '合成本文です', sentAt: null, retryable: true } });
  });

  test('期間超過pendingはretryable=false、返信が無ければnull', async () => {
    seedPending({ created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() });
    const expired = await GET(new NextRequest('http://localhost/api/admin/inquiries/' + INQUIRY_UUID + '/reply'), makeProps());
    expect(await expired.json()).toMatchObject({ reply: { retryable: false } });
    replies = [];
    const empty = await GET(new NextRequest('http://localhost/api/admin/inquiries/' + INQUIRY_UUID + '/reply'), makeProps());
    expect(await empty.json()).toEqual({ reply: null });
  });

  test('新しい送信済み返信があっても古い未確定返信を優先表示する', async () => {
    const olderPendingAt = new Date(Date.now() - 60_000).toISOString();
    const newerSentAt = new Date().toISOString();
    const sentReply = {
      id: '66666666-6666-4666-8666-666666666666', contact_id: INQUIRY_UUID, author_id: USER_ID, author_name: '運営担当',
      body: '送信済みの合成本文', is_internal: false, sent_at: newerSentAt, created_at: new Date(Date.now() + 1_000).toISOString(),
    };
    replies = [
      {
        id: OPERATION_ID, contact_id: INQUIRY_UUID, author_id: USER_ID, author_name: '運営担当',
        body: '未確定の合成本文', is_internal: false, sent_at: null, created_at: olderPendingAt,
      },
      sentReply,
    ];

    const res = await GET(new NextRequest('http://localhost/api/admin/inquiries/' + INQUIRY_UUID + '/reply'), makeProps());
    expect(await res.json()).toMatchObject({ reply: { operationId: OPERATION_ID, body: '未確定の合成本文', sentAt: null } });

    replies = [sentReply];
    const sent = await GET(new NextRequest('http://localhost/api/admin/inquiries/' + INQUIRY_UUID + '/reply'), makeProps());
    expect(await sent.json()).toMatchObject({ reply: { body: '送信済みの合成本文', sentAt: newerSentAt, retryable: false } });
  });

  test('不正IDと非adminを拒否する', async () => {
    expect((await GET(new NextRequest('http://localhost/api/admin/inquiries/no/reply'), makeProps('no'))).status).toBe(400);
    mockAnonFrom.mockReturnValue(profileChain({ is_platform_admin: false, display_name: null }));
    const unauthorized = await GET(new NextRequest('http://localhost/api/admin/inquiries/' + INQUIRY_UUID + '/reply'), makeProps());
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get('Cache-Control')).toBe('no-store');
  });

  test('rate limit時はno-store 429を返す', async () => {
    (checkRateLimit as jest.Mock).mockResolvedValueOnce(true);
    const res = await GET(new NextRequest('http://localhost/api/admin/inquiries/' + INQUIRY_UUID + '/reply'), makeProps());
    expect(res.status).toBe(429);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  test.each(['pending', 'sent'] as const)('返信状態の%s照会DB失敗はno-store 500になる', async (failure) => {
    replyReadFailure = failure;
    const res = await GET(new NextRequest('http://localhost/api/admin/inquiries/' + INQUIRY_UUID + '/reply'), makeProps());
    expect(res.status).toBe(500);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  test('認証照会例外は機密を含まないno-store 500にする', async () => {
    mockGetUser.mockRejectedValue(new Error('private@example.invalid credential detail'));
    const res = await GET(new NextRequest('http://localhost/api/admin/inquiries/' + INQUIRY_UUID + '/reply'), makeProps());
    expect(res.status).toBe(500);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.text()).not.toContain('private@example.invalid');
    expect(mockConsoleError.mock.calls.flat().join(' ')).not.toContain('private@example.invalid');
  });
});
