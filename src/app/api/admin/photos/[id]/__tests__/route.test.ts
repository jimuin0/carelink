/** @jest-environment node */
jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn(), getRequestContext: jest.fn(() => ({ ip: '127.0.0.1', ua: 'test' })) }));
const mockGetUser = jest.fn(); const mockRpc = jest.fn();
jest.mock('@/lib/supabase-server-auth', () => ({ createServerSupabaseAuthClient: async () => ({ auth: { getUser: mockGetUser } }) }));
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => ({ rpc: mockRpc }) }));
import { DELETE } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';
import { writeAuditLog } from '@/lib/audit-logger';
const photoId = '44000000-0000-4000-8000-000000000001';
const facilityId = '44000000-0000-4000-8000-000000000002';
const userId = '44000000-0000-4000-8000-000000000003';
function request(fid: string | null = facilityId) { return new Request(`http://localhost/api/admin/photos/${photoId}${fid === null ? '' : `?facility_id=${fid}`}`, { method: 'DELETE' }); }
function props(id = photoId) { return { params: Promise.resolve({ id }) }; }
beforeEach(() => {
  jest.clearAllMocks(); mockRpc.mockReset(); mockGetUser.mockReset();
  (checkCsrf as jest.Mock).mockReturnValue(null); (checkRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
  mockRpc.mockResolvedValue({ data: [{ id: photoId }], error: null });
});
test('deletion uses verified actor and exact facility/photo in one RPC', async () => {
  const response = await DELETE(request(), props());
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, photoId });
  expect(mockRpc).toHaveBeenCalledWith('delete_facility_photo_atomic', { p_actor_id: userId, p_facility_id: facilityId, p_photo_id: photoId });
  expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'delete', recordId: photoId, facilityId }));
});
test.each([['FACILITY_PERMISSION_REVOKED', 403], ['metadata clear failure', 500]])('RPC %s prevents successful audit', async (message, status) => {
  mockRpc.mockResolvedValue({ data: [{ id: photoId }], error: { message } });
  expect((await DELETE(request(), props())).status).toBe(status); expect(writeAuditLog).not.toHaveBeenCalled();
});
test.each([[], null, [{ id: facilityId }], [{ id: photoId }, { id: photoId }]])('unexpected result %j is not success', async data => {
  mockRpc.mockResolvedValue({ data, error: null });
  expect((await DELETE(request(), props())).status).toBe(Array.isArray(data) && data.length === 0 ? 404 : 500); expect(writeAuditLog).not.toHaveBeenCalled();
});
test('transport failure is caught and does not record successful deletion', async () => {
  mockRpc.mockRejectedValue(new Error('synthetic')); expect((await DELETE(request(), props())).status).toBe(500); expect(writeAuditLog).not.toHaveBeenCalled();
});
test.each([null, 'bad-id'])('missing/invalid facility %s is 400 before RPC', async fid => { expect((await DELETE(request(fid), props())).status).toBe(400); expect(mockRpc).not.toHaveBeenCalled(); });
test('invalid photo id is 400', async () => { expect((await DELETE(request(), props('bad-id'))).status).toBe(400); expect(mockRpc).not.toHaveBeenCalled(); });
test('no login is 401', async () => { mockGetUser.mockResolvedValue({ data: { user: null }, error: null }); expect((await DELETE(request(), props())).status).toBe(401); expect(mockRpc).not.toHaveBeenCalled(); });
test('unavailable auth is 503 without business mutation', async () => { mockGetUser.mockResolvedValue({ data: { user: { id: userId } }, error: { status: 522 } }); expect((await DELETE(request(), props())).status).toBe(503); expect(mockRpc).not.toHaveBeenCalled(); });
test('rate limit is 429', async () => { (checkRateLimit as jest.Mock).mockReturnValue(true); expect((await DELETE(request(), props())).status).toBe(429); expect(mockRpc).not.toHaveBeenCalled(); });
test('CSRF rejection passes through', async () => { const response = new Response('csrf', { status: 403 }); (checkCsrf as jest.Mock).mockReturnValue(response); expect(await DELETE(request(), props())).toBe(response); expect(mockRpc).not.toHaveBeenCalled(); });
