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
const body = { hidden: true };
function request(value: unknown = body, origin = 'http://localhost', target = id) {
  return new Request(`http://localhost/api/admin/registrations/${target}/visibility`, { method: 'PATCH', headers: { origin, host: 'localhost', 'content-type': 'application/json' }, body: JSON.stringify(value) });
}
beforeEach(() => {
  jest.clearAllMocks(); process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  mockGetUser.mockResolvedValue({ data: { user: { id: actor } }, error: null });
  mockRpc.mockResolvedValue({ data: { outcome: 'updated', hidden: true, revision: 1 }, error: null });
});
test.each([true, false])('confirmed hide/restore %s uses the verified actor', async hidden => {
  mockRpc.mockResolvedValue({ data: { outcome: 'updated', hidden, revision: 2 }, error: null });
  const response = await PATCH(request({ hidden })); expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ success: true, hidden });
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(mockRpc).toHaveBeenCalledWith('set_salon_registration_visibility', { p_actor: actor, p_salon: id, p_hidden: hidden });
});
test('anonymous and cross-origin requests cannot hide', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
  expect((await PATCH(request())).status).toBe(401); expect(mockRpc).not.toHaveBeenCalled();
  expect((await PATCH(request(body, 'https://elsewhere.invalid'))).status).toBe(403); expect(mockRpc).not.toHaveBeenCalled();
});
test.each([null, {}, { hidden: 'true' }, { hidden: 1 }, { ...body, extra: true }])('invalid input cannot write %#', async value => {
  expect((await PATCH(request(value))).status).toBe(400); expect(mockRpc).not.toHaveBeenCalled();
});
test('invalid id cannot write', async () => { expect((await PATCH(request(body, 'http://localhost', 'bad'))).status).toBe(400); expect(mockRpc).not.toHaveBeenCalled(); });
test.each(['unchanged', 'not_found', 'invalid'])('unconfirmed database outcome %s fails closed', async outcome => {
  mockRpc.mockResolvedValue({ data: { outcome, hidden: true }, error: null }); expect((await PATCH(request())).status).toBe(409);
});
test('database rejects revoked platform administrator', async () => { mockRpc.mockResolvedValue({ data: { outcome: 'forbidden' }, error: null }); expect((await PATCH(request())).status).toBe(403); });
test.each([{ outcome: 'updated', hidden: false, revision: 1 }, { outcome: 'updated', hidden: true }])('wrong acknowledgement is not success %#', async data => {
  mockRpc.mockResolvedValue({ data, error: null }); expect((await PATCH(request())).status).toBe(409);
});
test.each([{ data: null, error: null }, { data: { outcome: 'updated', hidden: true, revision: 1, extra: 1 }, error: null }, { data: null, error: { message: 'private' } }])('malformed or failed database result reports failure %#', async data => {
  mockRpc.mockResolvedValue(data); const response = await PATCH(request()); expect(response.status).toBe(500); expect(await response.text()).not.toContain('private');
});
