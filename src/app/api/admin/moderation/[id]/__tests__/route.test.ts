/** @jest-environment node */
jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn(), getRequestContext: jest.fn(() => ({ ip: '127.0.0.1', ua: 'test' })) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));
const QUEUE_UUID = '11111111-1111-1111-1111-111111111111';
const REVIEW_UUID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const mockAdminFrom = jest.fn(); const mockAdminRpc = jest.fn();
const mockAnonFrom = jest.fn(); const mockGetUser = jest.fn();
jest.mock('@supabase/ssr', () => ({ createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }) }));
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => ({ from: mockAdminFrom, rpc: mockAdminRpc }) }));
import { PATCH } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';
import { writeAuditLog } from '@/lib/audit-logger';
function request(body: unknown = { decision: 'approved' }, id = QUEUE_UUID) {
  return new Request(`http://localhost/api/admin/moderation/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body && typeof body === 'object' ? { expected_status: 'pending', expected_reviewed_at: null, ...body } : body) }) as Parameters<typeof PATCH>[0];
}
function props(id = QUEUE_UUID) { return { params: Promise.resolve({ id }) }; }
function chain(data: unknown, error: unknown = null) {
  const value = { select: jest.fn(() => value), eq: jest.fn(() => value), single: jest.fn(async () => ({ data, error })), maybeSingle: jest.fn(async () => ({ data, error })) }; return value;
}
const item = { id: QUEUE_UUID, content_type: 'review', content_id: REVIEW_UUID, status: 'pending' };
beforeEach(() => {
  jest.clearAllMocks(); mockAdminFrom.mockReset(); mockAdminRpc.mockReset(); mockAnonFrom.mockReset(); mockGetUser.mockReset();
  (checkCsrf as jest.Mock).mockReturnValue(null); (checkRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  mockAnonFrom.mockReturnValue(chain({ is_platform_admin: true }));
  mockAdminFrom.mockReturnValue(chain(item));
  mockAdminRpc.mockResolvedValue({ data: [{ ...item, replayed: false }], error: null });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});
test.each(['approved', 'rejected', 'escalated'])('decision %s uses one atomic RPC and logs only confirmed commit', async decision => {
  const res = await PATCH(request({ decision, review_note: '合成審査' }), props());
  expect(res.status).toBe(200); expect(await res.json()).toEqual({ success: true, decision });
  expect(mockAdminRpc).toHaveBeenCalledWith('moderate_content_atomic', { p_actor_id: USER_ID, p_queue_id: QUEUE_UUID, p_expected_status: 'pending', p_expected_reviewed_at: null, p_decision: decision, p_review_note: '合成審査' });
  expect(mockAdminFrom).toHaveBeenCalledTimes(1); expect(mockAdminFrom).toHaveBeenCalledWith('moderation_queue');
  expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: decision === 'approved' ? 'approve' : decision === 'rejected' ? 'reject' : 'update' }));
});
test('lost-response replay is accepted and records the persisted result', async () => {
  mockAdminRpc.mockResolvedValue({ data: [{ ...item, replayed: true }], error: null });
  expect((await PATCH(request({ decision: 'rejected' }), props())).status).toBe(200);
  expect(mockAdminRpc).toHaveBeenCalledWith('moderate_content_atomic', expect.objectContaining({ p_review_note: null }));
  expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ newValues: expect.objectContaining({ replayed: true }) }));
});
test.each([['MODERATION_PERMISSION_REVOKED', 403], ['MODERATION_REVISION_CONFLICT', 409], ['MODERATION_REVIEW_UNAVAILABLE', 409], ['review hide failed', 500]])('atomic failure %s is visible and never logs successful moderation', async (message, expected) => {
  mockAdminRpc.mockResolvedValue({ data: [{ ...item }], error: { message } });
  expect((await PATCH(request({ decision: 'rejected' }), props())).status).toBe(expected);
  expect(writeAuditLog).not.toHaveBeenCalled(); expect(mockAdminFrom).toHaveBeenCalledTimes(1);
});
test.each([[], null, [{ ...item, id: REVIEW_UUID }], [{ ...item }, { ...item }]])('unconfirmed result %j never claims success', async data => {
  mockAdminRpc.mockResolvedValue({ data, error: null });
  expect((await PATCH(request(), props())).status).toBe(Array.isArray(data) && data.length === 0 ? 404 : 500);
  expect(writeAuditLog).not.toHaveBeenCalled();
});
test('missing queue is 404 without mutation', async () => {
  mockAdminFrom.mockReturnValue(chain(null)); expect((await PATCH(request(), props())).status).toBe(404); expect(mockAdminRpc).not.toHaveBeenCalled();
});
test('read failure with data is 500 instead of missing/success', async () => {
  mockAdminFrom.mockReturnValue(chain(item, { message: '08006' })); expect((await PATCH(request(), props())).status).toBe(500); expect(mockAdminRpc).not.toHaveBeenCalled();
});
test('invalid stored content id is rejected before mutation', async () => {
  mockAdminFrom.mockReturnValue(chain({ ...item, content_id: 'not-uuid' })); expect((await PATCH(request(), props())).status).toBe(500); expect(mockAdminRpc).not.toHaveBeenCalled();
});
test('RPC transport rejection is handled as failure without audit', async () => {
  mockAdminRpc.mockRejectedValue(new Error('synthetic dependency')); expect((await PATCH(request(), props())).status).toBe(500); expect(writeAuditLog).not.toHaveBeenCalled();
});
test.each([null, { is_platform_admin: false }])('non-admin profile %j is forbidden', async data => {
  mockAnonFrom.mockReturnValue(chain(data)); expect((await PATCH(request(), props())).status).toBe(403); expect(mockAdminFrom).not.toHaveBeenCalled();
});
test('unauthenticated is forbidden', async () => { mockGetUser.mockResolvedValue({ data: { user: null } }); expect((await PATCH(request(), props())).status).toBe(403); });
test('rate limited is 429', async () => { (checkRateLimit as jest.Mock).mockReturnValue(true); expect((await PATCH(request(), props())).status).toBe(429); });
test('CSRF rejection is preserved', async () => { const response = new Response('csrf', { status: 403 }); (checkCsrf as jest.Mock).mockReturnValue(response); expect(await PATCH(request(), props())).toBe(response); });
test('invalid route id is 400', async () => { expect((await PATCH(request(), props('bad-id'))).status).toBe(400); });
test.each([{ decision: 'deleted' }, { decision: 'rejected', review_note: 'x'.repeat(501) }, null])('invalid body is 400', async body => { expect((await PATCH(request(body), props())).status).toBe(400); });
test('malformed JSON is 400', async () => {
  const req = new Request('http://localhost/api/admin/moderation/test', { method: 'PATCH', body: 'bad-json' }) as Parameters<typeof PATCH>[0];
  expect((await PATCH(req, props())).status).toBe(400);
});

test('old client without observed state receives explicit reload guidance', async () => {
  const req = new Request(`http://localhost/api/admin/moderation/${QUEUE_UUID}`, { method: 'PATCH', body: JSON.stringify({ decision: 'approved' }) }) as Parameters<typeof PATCH>[0];
  const response = await PATCH(req, props()); expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: expect.stringContaining('再読み込み') });
  expect(mockAdminFrom).not.toHaveBeenCalled(); expect(mockAdminRpc).not.toHaveBeenCalled();
});
test('lost A approval response, B rejection, then A retry retains original expected state and cannot overwrite B', async () => {
  mockAdminFrom.mockReturnValue(chain({ ...item, status: 'rejected' }));
  mockAdminRpc.mockImplementation(async (_name, args) => ({ data: null,
    error: args.p_expected_status === 'pending' ? { message: 'MODERATION_REVISION_CONFLICT' } : null }));
  const response = await PATCH(request({ decision: 'approved', expected_status: 'pending' }), props());
  expect(response.status).toBe(409);
  expect(mockAdminRpc).toHaveBeenCalledWith('moderate_content_atomic', expect.objectContaining({ p_expected_status: 'pending' }));
  expect(writeAuditLog).not.toHaveBeenCalled();
});

test('legacy missing review revision cannot silently use fresh server state', async () => {
  const req = new Request(`http://localhost/api/admin/moderation/${QUEUE_UUID}`, { method: 'PATCH', body: JSON.stringify({ decision: 'approved', expected_status: 'pending' }) }) as Parameters<typeof PATCH>[0];
  expect((await PATCH(req, props())).status).toBe(409); expect(mockAdminRpc).not.toHaveBeenCalled();
});
test('original review revision is forwarded despite a later same-status ABA state', async () => {
  const original = '2026-10-08T00:00:00.000Z';
  mockAdminFrom.mockReturnValue(chain({ ...item, status: 'approved', reviewed_at: '2026-10-08T00:03:00.000Z' }));
  mockAdminRpc.mockResolvedValue({ data: null, error: { message: 'MODERATION_REVISION_CONFLICT' } });
  expect((await PATCH(request({ decision: 'rejected', expected_status: 'approved', expected_reviewed_at: original }), props())).status).toBe(409);
  expect(mockAdminRpc).toHaveBeenCalledWith('moderate_content_atomic', expect.objectContaining({ p_expected_reviewed_at: original }));
  expect(writeAuditLog).not.toHaveBeenCalled();
});
