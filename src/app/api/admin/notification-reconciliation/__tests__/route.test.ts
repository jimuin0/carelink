/** @jest-environment node */
const OP = '88888888-8888-4888-8888-888888888888', PROVIDER = '99999999-9999-4999-8999-999999999999';
const mockUser = jest.fn(), mockAuthFrom = jest.fn(), mockFrom = jest.fn(), mockVerify = jest.fn();
jest.mock('@/lib/supabase-server-auth', () => ({ createServerSupabaseAuthClient: () => ({ auth: { getUser: mockUser }, from: mockAuthFrom }) }));
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => ({ from: mockFrom }) }));
jest.mock('@/lib/event-email-delivery', () => ({ ...jest.requireActual('@/lib/event-email-delivery'), verifyEventEmailAcceptance: (...args: unknown[]) => mockVerify(...args) }));
jest.mock('resend', () => ({ Resend: jest.fn(() => ({ emails: { send: jest.fn() } })) }));
jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/alert', () => ({ postAlert: jest.fn(), alertCaughtError: jest.fn() }));
jest.mock('@/lib/safe', () => ({ safeCaptureException: jest.fn() }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn() }));
import { POST } from '../route';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
const row = { id: OP, webhook_type: 'manual_booking_confirmation', payload: {}, status: 'processing',
  email_envelope: { from: 'CareLink <noreply@carelink-jp.com>', to: 'synthetic@example.invalid', subject: 'fixture', html: '<p>fixture</p>' },
  claimed_at: '2026-10-01T00:00:00Z', delivery_started_at: '2026-10-01T00:00:01Z', provider_message_id: null };
let authChain: Record<string, jest.Mock>, chain: Record<string, jest.Mock>;
function req(input: unknown = { operationId: OP, providerMessageId: PROVIDER }) {
  return new Request('http://localhost/api/admin/notification-reconciliation', { method: 'POST', body: JSON.stringify(input) });
}
beforeEach(() => {
  jest.clearAllMocks(); process.env.RESEND_API_KEY = 'synthetic';
  (checkCsrf as jest.Mock).mockReturnValue(null); (checkRateLimit as jest.Mock).mockReturnValue(false);
  mockUser.mockResolvedValue({ data: { user: { id: OP } }, error: null }); mockVerify.mockResolvedValue(true);
  authChain = {}; chain = {};
  for (const c of [authChain, chain]) for (const key of ['select','eq','update']) c[key] = jest.fn(() => c);
  authChain.maybeSingle = jest.fn().mockResolvedValue({ data: { is_platform_admin: true }, error: null });
  chain.maybeSingle = jest.fn().mockResolvedValueOnce({ data: row, error: null }).mockResolvedValue({ data: { id: OP }, error: null });
  mockAuthFrom.mockReturnValue(authChain); mockFrom.mockReturnValue(chain);
});
test('provider evidence is checked before CAS; response has no envelope or recipient', async () => {
  const res = await POST(req() as never); expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ accepted: true }); expect(res.headers.get('cache-control')).toBe('no-store');
  expect(mockVerify).toHaveBeenCalledWith(expect.anything(), row.email_envelope, OP, PROVIDER, row.delivery_started_at);
  expect(mockVerify.mock.invocationCallOrder[0]).toBeLessThan(chain.update.mock.invocationCallOrder[0]);
  expect(chain.eq).toHaveBeenCalledWith('claimed_at', row.claimed_at);
  expect(chain.eq).toHaveBeenCalledWith('delivery_started_at', row.delivery_started_at);
});
test('CSRF and rate gates refuse before data access', async () => {
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(null, { status: 403 }));
  expect((await POST(req() as never)).status).toBe(403);
  (checkRateLimit as jest.Mock).mockReturnValueOnce(true);
  expect((await POST(req() as never)).status).toBe(429); expect(mockFrom).not.toHaveBeenCalled();
});
test.each([{}, null, { operationId: OP, providerMessageId: 'foreign' }])('invalid evidence input %j', async input => {
  expect((await POST(req(input) as never)).status).toBe(400); expect(mockFrom).not.toHaveBeenCalled();
});
test.each([null, { id: OP }])('no valid authentication %j', async user => {
  mockUser.mockResolvedValue({ data: { user }, error: user ? {} : null });
  expect((await POST(req() as never)).status).toBe(user ? 503 : 401); expect(mockFrom).not.toHaveBeenCalled();
});
test.each(['error', 'throw', 'malformed'])('Auth unavailable %s never reads provider evidence or writes acceptance', async mode => {
  if (mode === 'throw') mockUser.mockRejectedValue(new Error('synthetic dependency failure'));
  else mockUser.mockResolvedValue(mode === 'malformed' ? {} : { data: { user: null }, error: { status: 522 } });
  const response = await POST(req() as never);
  expect(response.status).toBe(503); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual(expect.objectContaining({ code: 'AUTH_UNAVAILABLE' }));
  expect(mockAuthFrom).not.toHaveBeenCalled(); expect(mockFrom).not.toHaveBeenCalled();
  expect(mockVerify).not.toHaveBeenCalled();
});
test.each([null, { is_platform_admin: false }, { is_platform_admin: 'true' }])('facility owner or missing platform role cannot reconcile %j', async data => {
  authChain.maybeSingle.mockResolvedValue({ data });
  expect((await POST(req() as never)).status).toBe(403); expect(mockFrom).not.toHaveBeenCalled();
});
test.each(['permission','read','write'])('DB %s failure is not acceptance', async step => {
  if (step === 'permission') authChain.maybeSingle.mockResolvedValue({ error: {} });
  if (step === 'read') chain.maybeSingle.mockReset().mockResolvedValue({ error: {} });
  if (step === 'write') chain.maybeSingle.mockReset().mockResolvedValueOnce({ data: row }).mockResolvedValueOnce({ error: {} });
  expect((await POST(req() as never)).status).toBe(500);
});
test.each(['data-with-error', 'throw'])('platform permission %s cannot observe or accept a notification', async mode => {
  if (mode === 'throw') authChain.maybeSingle.mockRejectedValue(new Error('synthetic private dependency'));
  else authChain.maybeSingle.mockResolvedValue({ data: { is_platform_admin: true }, error: { code: '08006' } });
  const response = await POST(req() as never);
  expect(response.status).toBe(500); expect(await response.text()).not.toContain('synthetic private dependency');
  expect(mockFrom).not.toHaveBeenCalled(); expect(mockVerify).not.toHaveBeenCalled();
});
test.each([null, { ...row, email_envelope: {} }, { ...row, status: 'pending' }, { ...row, claimed_at: null },
  { ...row, delivery_started_at: null }, { ...row, webhook_type: 'line_push' }])('unreconcilable row %j', async data => {
  chain.maybeSingle.mockReset().mockResolvedValue({ data });
  expect((await POST(req() as never)).status).toBe(409); expect(mockVerify).not.toHaveBeenCalled(); expect(chain.update).not.toHaveBeenCalled();
});
test('unavailable provider credential or foreign provider evidence never resets the fence', async () => {
  delete process.env.RESEND_API_KEY;
  expect((await POST(req() as never)).status).toBe(503);
  process.env.RESEND_API_KEY = 'synthetic'; chain.maybeSingle.mockReset().mockResolvedValue({ data: row }); mockVerify.mockResolvedValue(false);
  expect((await POST(req() as never)).status).toBe(409); expect(chain.update).not.toHaveBeenCalled();
});
test('CAS lost to another worker is not accepted', async () => {
  chain.maybeSingle.mockReset().mockResolvedValueOnce({ data: row }).mockResolvedValueOnce({ data: null });
  expect((await POST(req() as never)).status).toBe(409);
});
test.each([PROVIDER, OP])('already accepted row is idempotent only for the same provider ID %s', async id => {
  chain.maybeSingle.mockReset().mockResolvedValue({ data: { ...row, status: 'success', provider_message_id: PROVIDER } });
  const res = await POST(req({ operationId: OP, providerMessageId: id }) as never);
  expect(res.status).toBe(id === PROVIDER ? 200 : 409); expect(mockVerify).not.toHaveBeenCalled(); expect(chain.update).not.toHaveBeenCalled();
});
test('generic v1 email can be reconciled, legacy email cannot', async () => {
  chain.maybeSingle.mockReset().mockResolvedValueOnce({ data: { ...row, webhook_type: 'email', payload: { event_email_version: 1 } } }).mockResolvedValueOnce({ data: { id: OP } });
  expect((await POST(req() as never)).status).toBe(200);
  chain.maybeSingle.mockReset().mockResolvedValue({ data: { ...row, webhook_type: 'email', payload: {} } });
  expect((await POST(req() as never)).status).toBe(409);
});
