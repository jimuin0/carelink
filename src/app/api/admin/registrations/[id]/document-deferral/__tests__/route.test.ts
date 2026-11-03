/** @jest-environment node */
const mockGetUser = jest.fn();
const mockRpc = jest.fn();
jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));
jest.mock('@supabase/ssr', () => ({ createServerClient: () => ({ auth: { getUser: mockGetUser } }) }));
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => ({ rpc: mockRpc }) }));
import { PATCH } from '../route';
const actor = '74000000-0000-4000-8000-000000000001';
const id = '74000000-0000-4000-8000-000000000002';
const body = { deferred: true };
function request(value: unknown = body, origin = 'http://localhost', target = id) {
  return new Request(`http://localhost/api/admin/registrations/${target}/document-deferral`, { method: 'PATCH', headers: { origin, host: 'localhost', 'content-type': 'application/json' }, body: JSON.stringify(value) });
}
beforeEach(() => {
  jest.clearAllMocks(); process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  mockGetUser.mockResolvedValue({ data: { user: { id: actor } }, error: null });
  mockRpc.mockResolvedValue({ data: { outcome: 'updated', deferred: true, revision: 1, facility_published: false }, error: null });
});
test.each([[true, false], [false, true]])('confirmed deferral %s uses the verified actor (published=%s)', async (deferred, published) => {
  mockRpc.mockResolvedValue({ data: { outcome: 'updated', deferred, revision: 2, facility_published: published }, error: null });
  const response = await PATCH(request({ deferred })); expect(response.status).toBe(200);
  // 外しても公開中の店舗はそのまま公開される。画面がそう伝えられるよう、公開中かを返す。
  expect(await response.json()).toEqual({ success: true, deferred, facilityPublished: published });
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(mockRpc).toHaveBeenCalledWith('set_listing_verification_deferral', { p_actor: actor, p_salon: id, p_deferred: deferred });
});
test('anonymous and cross-origin requests cannot change deferral', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
  expect((await PATCH(request())).status).toBe(401); expect(mockRpc).not.toHaveBeenCalled();
  expect((await PATCH(request(body, 'https://elsewhere.invalid'))).status).toBe(403); expect(mockRpc).not.toHaveBeenCalled();
});
test.each([null, {}, { deferred: 'true' }, { deferred: 1 }, { ...body, extra: true }])('invalid input cannot write %#', async value => {
  expect((await PATCH(request(value))).status).toBe(400); expect(mockRpc).not.toHaveBeenCalled();
});
test('invalid id cannot write', async () => { expect((await PATCH(request(body, 'http://localhost', 'bad'))).status).toBe(400); expect(mockRpc).not.toHaveBeenCalled(); });
test.each(['unchanged', 'not_found', 'invalid'])('unconfirmed database outcome %s fails closed', async outcome => {
  mockRpc.mockResolvedValue({ data: { outcome, deferred: true }, error: null }); expect((await PATCH(request())).status).toBe(409);
});
test('a rejected registration cannot be deferred', async () => {
  mockRpc.mockResolvedValue({ data: { outcome: 'rejected' }, error: null });
  const response = await PATCH(request()); expect(response.status).toBe(409);
  expect((await response.json()).error).toContain('却下した申込');
});
test('database rejects revoked platform administrator', async () => { mockRpc.mockResolvedValue({ data: { outcome: 'forbidden' }, error: null }); expect((await PATCH(request())).status).toBe(403); });
// 配信と migration の順番に関係なく、確定した更新を失敗と返さない（公開中かが分からなければ null）。
test('a database without the published flag still confirms the update', async () => {
  mockRpc.mockResolvedValue({ data: { outcome: 'updated', deferred: true, revision: 1 }, error: null });
  const response = await PATCH(request()); expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ success: true, deferred: true, facilityPublished: null });
});
test.each([{ outcome: 'updated', deferred: false, revision: 1, facility_published: false }, { outcome: 'updated', deferred: true, facility_published: false }])('wrong acknowledgement is not success %#', async data => {
  mockRpc.mockResolvedValue({ data, error: null }); expect((await PATCH(request())).status).toBe(409);
});
test.each([{ data: null, error: null }, { data: { outcome: 'updated', deferred: true, revision: 1, facility_published: false, extra: 1 }, error: null }, { data: null, error: { message: 'private' } }])('malformed or failed database result reports failure %#', async data => {
  mockRpc.mockResolvedValue(data); const response = await PATCH(request()); expect(response.status).toBe(500); expect(await response.text()).not.toContain('private');
});
