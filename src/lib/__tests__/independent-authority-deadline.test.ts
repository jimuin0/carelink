/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { NextRequest } from 'next/server';
import { GET as listKeys, POST as createKey } from '@/app/api/admin/api-keys/route';
import { DELETE as revokeKey } from '@/app/api/admin/api-keys/[id]/route';
import { PATCH as settings } from '@/app/api/admin/settings/route';
import { POST as publish } from '@/app/api/admin/chain/bulk-publish/route';

const mockMember = jest.fn();
const mockKey = jest.fn();
const mockRpc = jest.fn();
const mockAuthFrom = jest.fn();
const mockServiceFrom = jest.fn();
const actor = 'fa7e0000-0000-4000-8000-000000000021';
const facility = 'fa7e0001-0000-4000-8000-000000000021';
const key = 'fa7e0002-0000-4000-8000-000000000021';
jest.mock('@/lib/supabase-server-auth', () => ({ createServerSupabaseAuthClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: actor } }, error: null }) }, from: mockAuthFrom,
}) }));
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => ({ from: mockServiceFrom, rpc: mockRpc }) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: () => null }));
jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => false }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn(), getRequestContext: () => ({}) }));
function chain(terminal: jest.Mock) {
  const c: Record<string, unknown> = {};
  for (const step of ['select', 'eq', 'in']) c[step] = () => c;
  c.maybeSingle = terminal;
  c.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(terminal()).then(resolve, reject);
  return c;
}
function request(path: string, method: string, body?: object) {
  return new NextRequest(`https://carelink.invalid${path}`, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
}
beforeEach(() => {
  jest.resetAllMocks(); jest.useFakeTimers();
  mockMember.mockResolvedValue({ data: { role: 'owner', facility_id: facility }, error: null });
  mockKey.mockResolvedValue({ data: { facility_id: facility }, error: null });
  mockRpc.mockResolvedValue({ data: [], error: null });
  mockAuthFrom.mockImplementation(() => chain(mockMember));
  mockServiceFrom.mockImplementation(table => chain(table === 'api_keys' ? mockKey : mockMember));
});
afterEach(() => jest.useRealTimers());
const operations = [
  ['key list', () => listKeys(request(`/api/admin/api-keys?facility_id=${facility}`, 'GET'))],
  ['key creation', () => createKey(request('/api/admin/api-keys', 'POST', { facility_id: facility, name: 'Synthetic', scopes: ['bookings:read'] }))],
  ['key revocation', () => revokeKey(request(`/api/admin/api-keys/${key}`, 'DELETE'), { params: Promise.resolve({ id: key }) })],
  ['facility settings', () => settings(request(`/api/admin/settings?facility_id=${facility}`, 'PATCH', { name: 'Synthetic' }))],
  ['bulk publication', () => publish(request('/api/admin/chain/bulk-publish', 'POST', { facility_ids: [facility], is_published: false }))],
] as const;
test.each(operations)('%s stops pending authorization before a late role can start a write', async (_name, invoke) => {
  let resolve!: (value: unknown) => void;
  mockMember.mockReturnValue(new Promise(r => { resolve = r; }));
  let settled = false;
  const result = invoke().then(r => { settled = true; return r; });
  try {
    await jest.advanceTimersByTimeAsync(5000);
    expect(settled).toBe(true);
    const response = await result;
    expect(response.status).toBe(500); expect(response.headers.get('Cache-Control')).toBe('no-store');
    resolve({ data: [{ role: 'owner', facility_id: facility }], error: null });
    await jest.advanceTimersByTimeAsync(0);
    expect(mockRpc).not.toHaveBeenCalled();
  } finally {
    resolve({ data: [], error: { code: '08006' } }); await result;
  }
});
