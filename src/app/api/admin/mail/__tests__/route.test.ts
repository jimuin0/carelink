/** @jest-environment node */
import { NextResponse } from 'next/server';
import { GET, POST } from '../route';
import { PLATFORM_MAIL_FROM, PLATFORM_MAIL_REPLY_TO } from '@/lib/platform-mail-contract';

const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const at = new Date().toISOString();
const envelope = { from: PLATFORM_MAIL_FROM, replyTo: PLATFORM_MAIL_REPLY_TO, to: 'synthetic@example.invalid', subject: 'ご案内', text: '架空の本文' };
const base = { id, revision: 1, contact_id: null, recipient: envelope.to, subject: envelope.subject, body: envelope.text,
  state: 'draft', scheduled_at: null, reserved_at: null, accepted_at: null, provider_message_id: null,
  delivery_status: null, envelope: null, created_at: at, updated_at: at };
let mockProfile: { data: unknown; error: unknown };
let mockList: { data: unknown; error: unknown };
let mockContact: { data: unknown; error: unknown };
let mockRows: Record<string, unknown>;
let mockQueue: { data: unknown; error: unknown }[];
const mockInbox = jest.fn();
const mockEvidence = jest.fn();
const mockThread = jest.fn();
jest.mock('@/lib/admin-inquiry-list', () => ({ readAdminInquiryList: (...args: unknown[]) => mockInbox(...args) }));
jest.mock('@/lib/platform-mail-read', () => ({ readMailReplyEvidence: (...args: unknown[]) => mockEvidence(...args), readMailThread: (...args: unknown[]) => mockThread(...args) }));
const mockRpc = jest.fn();
const mockAudit = jest.fn();
const mockProvider = jest.fn();
const mockDispatch = jest.fn();
const mockInspect = jest.fn();
const mockCancel = jest.fn();
const mockFilters: Record<string, jest.Mock> = {};
function mockBuilder(result: () => unknown) {
  const chain: Record<string, unknown> = {};
  for (const key of ['select', 'eq', 'in', 'order', 'limit', 'or', 'abortSignal', 'maybeSingle']) {
    const fn = jest.fn(() => chain); chain[key] = fn; mockFilters[key] = fn;
  }
  chain.then = (resolve: (value: unknown) => unknown, reject: (value: unknown) => unknown) => Promise.resolve().then(result).then(resolve, reject);
  return chain;
}
const mockFrom = jest.fn((table: string) => mockBuilder(() => table === 'profiles' ? mockProfile : table === 'contacts' ? mockContact : mockList));
const mockDb = { from: mockFrom, rpc: mockRpc };
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => mockDb }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: (...args: unknown[]) => mockAudit(...args) }));
jest.mock('@/lib/platform-mail-delivery', () => ({
  platformMailProvider: () => mockProvider(), dispatchPlatformMail: (...args: unknown[]) => mockDispatch(...args),
  inspectPlatformMail: (...args: unknown[]) => mockInspect(...args), cancelPlatformMail: (...args: unknown[]) => mockCancel(...args),
}));
jest.mock('@/lib/with-route', () => {
  const { NextResponse: Response } = jest.requireActual('next/server');
  return { withRoute: (handler: (request: Request, context: unknown) => unknown) => (request: Request) => handler(request, { user: { id }, supabase: { from: mockFrom } }),
    serverError: () => Response.json({ error: 'safe dependency failure' }, { status: 500 }),
    authUnavailable: () => Response.json({ error: 'auth unavailable' }, { status: 503 }) };
});
const call = (command: unknown) => POST(new Request('https://example.invalid/api/admin/mail', { method: 'POST', body: JSON.stringify(command) }));
const read = (query = '') => GET(new Request('https://example.invalid/api/admin/mail' + query));
const draft = { id, revision: 0, contactId: null, to: envelope.to, subject: envelope.subject, body: envelope.text, scheduledAt: null };
beforeEach(() => {
  jest.clearAllMocks();
  mockProfile = { data: { is_platform_admin: true }, error: null };
  mockList = { data: [], error: null };
  mockContact = { data: { id: other, name: '合成問い合わせ', email: envelope.to, message: '架空の問い合わせ', inquiry_type: null, created_at: at }, error: null };
  mockRows = { read: base, save: base, reserve: { ...base, state: 'pending', envelope, reserved_at: at },
    observe: { ...base, state: 'sent', envelope, reserved_at: at, provider_message_id: other, accepted_at: at, delivery_status: 'accepted' },
    cancel: { ...base, state: 'cancelling', envelope, reserved_at: at, provider_message_id: other, accepted_at: at } };
  mockQueue = [];
  mockInbox.mockResolvedValue({ state: 'confirmed', contacts: [mockContact.data], nextCursor: null });
  mockEvidence.mockResolvedValue({ messages: [], replies: [] });
  mockThread.mockResolvedValue({ messages: [], replies: [] });
  mockRpc.mockImplementation((_name: string, args: { p_action: string }) => mockBuilder(() => mockQueue.length ? mockQueue.shift() : { data: mockRows[args.p_action], error: null }));
  mockProvider.mockReturnValue({ opaque: 'synthetic-provider' });
  mockDispatch.mockResolvedValue({ state: 'accepted', id: other });
  mockInspect.mockResolvedValue({ id: other, event: 'delivered' });
  mockCancel.mockResolvedValue({ id: other, event: 'cancelled' });
});
test.each(['read', 'post'])('ordinary account cannot access mail or service mutations: %s', async method => {
  mockProfile.data = { is_platform_admin: false };
  expect((await (method === 'read' ? read() : call({ action: 'save', draft }))).status).toBe(403);
  expect(mockRpc).not.toHaveBeenCalled(); expect(mockDispatch).not.toHaveBeenCalled();
});
test.each([null, {}])('absent profile privilege fails closed: %j', async profile => { mockProfile.data = profile; expect((await read()).status).toBe(403); });
test.each(['read', 'post'])('failed fresh role observation does not authorize: %s', async method => {
  mockProfile.error = { message: 'private' }; expect((await (method === 'read' ? read() : call({ action: 'save', draft }))).status).toBe(503);
});
test.each(['?unknown=1', '?folder=draft&folder=sent', '?id=bad', '?id=' + id + '&folder=draft', '?folder=invalid', '?cursor=bad', '?cursor={}', '?contactId=bad', '?contactId=' + id + '&id=' + id])('invalid list selectors are safe client errors: %s', async query => { expect((await read(query)).status).toBe(400); });
test('folders are no-store and not a fabricated empty success on failure', async () => {
  const result = await read(); expect(result.headers.get('Cache-Control')).toBe('no-store'); expect(await result.json()).toEqual({ messages: [], nextCursor: null });
  mockList.error = { message: 'private' }; expect((await read()).status).toBe(500);
  mockList = { data: [{}], error: null }; expect((await read()).status).toBe(500);
});
test('keyset pagination uses an observed timestamp and UUID, not offset', async () => {
  mockList.data = Array.from({ length: 41 }, (_, index) => ({ ...base, id: '11111111-1111-4111-8111-' + String(index).padStart(12, '0') }));
  const result = await read('?folder=sent&cursor=' + encodeURIComponent(JSON.stringify({ at, id })));
  const data = await result.json(); expect(data.messages).toHaveLength(40); expect(data.nextCursor.id).toBe((mockList.data as { id: string }[])[39].id);
  expect(mockFilters.or).toHaveBeenCalledWith('updated_at.lt.' + at + ',and(updated_at.eq.' + at + ',id.lt.' + id + ')');
});
test('single mail read rechecks current privilege atomically', async () => { expect((await read('?id=' + id)).status).toBe(200); expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_actor_id: id, p_mail_id: id, p_action: 'read' }); });
test.each([{ error: { code: 'P0002' }, expected: 404 }, { error: null, expected: 500 }])('invalid single result is never reported as saved: %j', async scenario => { mockQueue = [{ data: null, error: scenario.error }]; expect((await read('?id=' + id)).status).toBe(scenario.expected); });
test('contact deep-link resolves the exact selected stored inquiry', async () => { const result = await read('?contactId=' + other); expect((await result.json()).contact.id).toBe(other); });
test.each([{ data: null, error: null, status: 404 }, { data: {}, error: null, status: 500 }, { data: null, error: {}, status: 500 }])('contact read failure is explicit: %j', async scenario => { mockContact = scenario; expect((await read('?contactId=' + other)).status).toBe(scenario.status); });
test.each([null, {}, { action: 'save', draft: { ...draft, from: 'other@example.invalid' } }, { action: 'send', id, revision: 0 }, { action: 'cancel', id, extra: true }])('rejects invalid or additional sender fields: %j', async command => { expect((await call(command)).status).toBe(400); expect(mockDispatch).not.toHaveBeenCalled(); });
test('invalid JSON is a client error', async () => { expect((await POST(new Request('https://example.invalid', { method: 'POST', body: '{' }))).status).toBe(400); });
test('draft save has no delivery side effect and excludes customer content from audit', async () => {
  expect((await call({ action: 'save', draft })).status).toBe(200); expect(mockProvider).not.toHaveBeenCalled(); expect(mockDispatch).not.toHaveBeenCalled();
  expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ newValues: { event: 'draft_saved' } }));
});
test.each([['42501', 403], ['P0002', 404], ['40001', 409], ['PT409', 409], ['23505', 409], ['22023', 400], ['23514', 400], ['22P02', 400], ['XX000', 500]])('atomic save rejects unconfirmed writes: %s', async (code, status) => {
  mockQueue = [{ data: null, error: { code } }]; expect((await call({ action: 'save', draft })).status).toBe(status); expect(mockAudit).not.toHaveBeenCalled();
});
test.each([null, { ...base, id: other }])('malformed/mismatched mutation receipt is not saved: %j', async result => { mockQueue = [{ data: result, error: null }]; expect((await call({ action: 'save', draft })).status).toBe(500); });
test('send freezes the message before provider dispatch; accepted is not claimed delivered', async () => {
  const result = await call({ action: 'send', id, revision: 1 }); const record = (await result.json()).mail;
  expect(record.delivery_status).toBe('accepted'); expect(mockRpc.mock.calls.map(call => call[1].p_action)).toEqual(['read', 'reserve', 'observe']);
  expect(mockDispatch).toHaveBeenCalledWith(expect.anything(), envelope, id);
});
test('provider absence does not reserve a send and keeps the saved draft', async () => { mockProvider.mockReturnValue(null); expect((await call({ action: 'send', id, revision: 1 })).status).toBe(503); expect(mockRpc.mock.calls).toHaveLength(1); });
test.each(['scheduled', 'sent', 'cancelled', 'cancelling'])('a completed/frozen operation cannot dispatch again: %s', async state => {
  mockRows.read = { ...base, state, envelope, reserved_at: at, provider_message_id: other, accepted_at: at };
  expect((await call({ action: 'send', id, revision: 1 })).status).toBe(409); expect(mockDispatch).not.toHaveBeenCalled();
});
test.each([null, new Date(Date.now() - 24 * 3600000).toISOString()])('unknown operations outside the retry window cannot send: %s', async reserved_at => {
  mockRows.read = { ...base, state: 'pending', envelope, reserved_at };
  expect((await call({ action: 'send', id, revision: 1 })).status).toBe(409); expect(mockDispatch).not.toHaveBeenCalled();
});
test('unknown retry uses only the frozen original envelope', async () => {
  mockRows.read = { ...base, state: 'pending', envelope, reserved_at: at };
  expect((await call({ action: 'send', id, revision: 1 })).status).toBe(200); expect(mockDispatch.mock.calls[0][1]).toEqual(envelope);
});
test.each([{ recipient: '' }, { body: '' }, { scheduled_at: '2020-01-01T00:00:00Z' }])('invalid sendable draft never reaches provider: %j', async changed => { mockRows.read = { ...base, ...changed }; expect((await call({ action: 'send', id, revision: 1 })).status).toBe(400); expect(mockDispatch).not.toHaveBeenCalled(); });
test('role revocation/stale revision at reservation stops the external side effect', async () => {
  mockQueue = [{ data: base, error: null }, { data: null, error: { code: '42501' } }];
  expect((await call({ action: 'send', id, revision: 1 })).status).toBe(403); expect(mockDispatch).not.toHaveBeenCalled();
});
test('unknown dispatch is pending, not sent and never handed to another queue', async () => {
  mockDispatch.mockResolvedValue({ state: 'unknown' }); const result = await call({ action: 'send', id, revision: 1 });
  expect(result.status).toBe(202); expect((await result.json()).mail.state).toBe('pending'); expect(mockRpc.mock.calls).toHaveLength(2);
});
test.each([['42501', 403], ['XX000', 202]])('provider acceptance with failed DB confirmation stays recoverable: %s', async (code, status) => {
  mockQueue = [{ data: base, error: null }, { data: mockRows.reserve, error: null }, { data: null, error: { code } }];
  const result = await call({ action: 'send', id, revision: 1 }); expect(result.status).toBe(status);
  if (status === 202) expect((await result.json()).providerId).toBe(other);
});
test.each([{ provider_message_id: null }, { envelope: null }, { reserved_at: null }])('unconfirmed provider identity cannot cancel: %j', async changed => {
  mockRows.read = { ...base, state: 'scheduled', envelope, reserved_at: at, provider_message_id: other, ...changed };
  expect((await call({ action: 'cancel', id })).status).toBe(409); expect(mockCancel).not.toHaveBeenCalled();
});
test('client cannot substitute a different provider record', async () => {
  mockRows.read = { ...base, state: 'scheduled', envelope, reserved_at: at, provider_message_id: other };
  expect((await call({ action: 'refresh', id, providerId: id })).status).toBe(409); expect(mockInspect).not.toHaveBeenCalled();
});
test('lost provider acknowledgement can be reconciled without another send', async () => {
  mockRows.read = { ...base, state: 'pending', envelope, reserved_at: at };
  expect((await call({ action: 'refresh', id, providerId: other })).status).toBe(200); expect(mockInspect).toHaveBeenCalled(); expect(mockDispatch).not.toHaveBeenCalled();
});
test('known provider identity can be observed directly', async () => {
  mockRows.read = { ...base, state: 'scheduled', envelope, reserved_at: at, provider_message_id: other };
  expect((await call({ action: 'refresh', id })).status).toBe(200);
});
test('cancellation is reserved before provider cancellation', async () => {
  mockRows.read = { ...base, state: 'scheduled', envelope, reserved_at: at, provider_message_id: other };
  mockRows.observe = { ...(mockRows.cancel as object), state: 'cancelled', delivery_status: 'cancelled' };
  const result = await call({ action: 'cancel', id }); expect((await result.json()).mail.state).toBe('cancelled');
  expect(mockRpc.mock.calls.map(call => call[1].p_action)).toEqual(['read', 'cancel', 'observe']); expect(mockCancel).toHaveBeenCalled();
});
test('failed cancellation reservation cannot call provider', async () => {
  mockQueue = [{ data: { ...base, state: 'scheduled', envelope, reserved_at: at, provider_message_id: other }, error: null }, { data: null, error: { code: '40001' } }];
  expect((await call({ action: 'cancel', id })).status).toBe(409); expect(mockCancel).not.toHaveBeenCalled();
});
test.each(['refresh', 'cancel'])('unconfirmed provider status does not fabricate a completion: %s', async action => {
  mockRows.read = { ...base, state: 'scheduled', envelope, reserved_at: at, provider_message_id: other }; mockInspect.mockResolvedValue(null); mockCancel.mockResolvedValue(null);
  expect((await call({ action, id })).status).toBe(202);
});
test('failed status confirmation stays an error', async () => {
  mockQueue = [{ data: { ...base, state: 'scheduled', envelope, reserved_at: at, provider_message_id: other }, error: null }, { data: null, error: { code: 'XX000' } }];
  expect((await call({ action: 'refresh', id })).status).toBe(500);
});
test.each(['GET', 'POST'])('unexpected dependency exceptions are safely caught: %s', async method => {
  mockFrom.mockImplementationOnce(() => { throw new Error('private'); });
  const result = await (method === 'GET' ? read() : call({ action: 'save', draft })); expect(result.status).toBe(500); expect(await result.text()).not.toContain('private');
});
test('read errors before sending cannot dispatch', async () => { mockQueue = [{ data: null, error: { code: 'P0002' } }]; expect((await call({ action: 'send', id, revision: 1 })).status).toBe(404); expect(mockDispatch).not.toHaveBeenCalled(); });
test('all result paths keep no-store headers', async () => { const result = await call({ action: 'save', draft }); expect(result).toBeInstanceOf(NextResponse); expect(result.headers.get('Cache-Control')).toBe('no-store'); });

test('inbox links both stores without using ticket closure as a reply', async () => {
  mockEvidence.mockResolvedValue({ messages: [{ ...base, contact_id: other, state: 'draft' }], replies: [] });
  const result = await read('?folder=inbox');
  expect((await result.json()).contacts[0].replySummary).toEqual({ replied: false, draft: true, pending: false, scheduled: false, failed: false });
  expect(mockEvidence).toHaveBeenCalledWith(mockDb, [other]); expect(mockDispatch).not.toHaveBeenCalled();
});
test('inbox passes a validated contact cursor, rejecting malformed cursors', async () => {
  const cursor = { id, createdAt: at };
  expect((await read('?folder=inbox&cursor=' + encodeURIComponent(JSON.stringify(cursor)))).status).toBe(200);
  expect(mockInbox).toHaveBeenCalledWith(mockDb, { status: 'all', cursor });
  for (const value of ['bad', '{}']) expect((await read('?folder=inbox&cursor=' + encodeURIComponent(value))).status).toBe(400);
});
test('inbox joins only matching inquiry evidence', async () => {
  mockEvidence.mockResolvedValue({ messages: [{ ...base, contact_id: id, state: 'sent' }], replies: [{ contact_id: other, is_internal: false, sent_at: at }] });
  expect((await (await read('?folder=inbox')).json()).contacts[0].replySummary.replied).toBe(true);
});
test('inbox or history failure never fabricates an unreplied row', async () => {
  mockInbox.mockResolvedValueOnce({ state: 'unavailable' }); expect((await read('?folder=inbox')).status).toBe(500);
  mockEvidence.mockRejectedValueOnce(new Error('private')); expect((await read('?folder=inbox')).status).toBe(500);
  mockThread.mockRejectedValueOnce(new Error('private')); const result = await read('?contactId=' + other); expect(result.status).toBe(500); expect(await result.text()).not.toContain('private');
});
test('failure folder filters delivery receipts, since failed mail retains sent state', async () => {
  expect((await read('?folder=failed')).status).toBe(200);
  expect(mockFilters.in).toHaveBeenCalledWith('delivery_status', ['failed', 'bounced']);
});
