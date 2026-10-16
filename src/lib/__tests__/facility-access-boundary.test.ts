/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { NextRequest } from 'next/server';
import { GET as whiteLabelGet, POST as whiteLabelSet } from '@/app/api/admin/white-label/route';
import { POST as whiteLabelVerify } from '@/app/api/admin/white-label/verify/route';
import { GET as placeGet, POST as placeSet } from '@/app/api/admin/gbp/place/route';
import { GET as postsGet, POST as postsCreate, PATCH as postsEdit, DELETE as postsDelete } from '@/app/api/admin/gbp/posts/route';
import { fetchPlaceDetails } from '../gbp';
import { promises as dns } from 'dns';

const mockGetUser = jest.fn();
const mockMembership = jest.fn();
const mockFrom = jest.fn();
const mockServiceClient = jest.fn();
jest.mock('../supabase-server-auth', () => ({ createServerSupabaseAuthClient: async () => ({ auth: { getUser: mockGetUser }, from: mockFrom }) }));
jest.mock('../supabase-server', () => ({ createServiceRoleClient: () => mockServiceClient() }));
jest.mock('../csrf', () => ({ checkCsrf: () => null }));
jest.mock('../rate-limit', () => ({ checkRateLimit: async () => false }));
jest.mock('../audit-logger', () => ({ writeAuditLog: jest.fn(), getRequestContext: () => ({}) }));
jest.mock('../alert', () => ({ alertCaughtError: jest.fn() }));
jest.mock('../gbp', () => ({ fetchPlaceDetails: jest.fn(), calculateGbpScore: jest.fn() }));
jest.mock('dns', () => ({ promises: { resolveTxt: jest.fn() } }));

const facilityId = '22222222-2222-4222-8222-222222222222';
const routes = [
  ['white-label GET', 'GET', whiteLabelGet], ['white-label POST', 'POST', whiteLabelSet],
  ['white-label verify', 'POST', whiteLabelVerify], ['place GET', 'GET', placeGet],
  ['place POST', 'POST', placeSet], ['posts GET', 'GET', postsGet],
  ['posts POST', 'POST', postsCreate], ['posts PATCH', 'PATCH', postsEdit], ['posts DELETE', 'DELETE', postsDelete],
] as const;
function request(method: string) {
  return new NextRequest(`https://carelink.invalid/api/admin/test?facility_id=${facilityId}`, {
    method, ...(method === 'GET' ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ facility_id: facilityId }) }),
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'synthetic-user' } }, error: null });
  mockMembership.mockResolvedValue({ data: [{ facility_id: facilityId }], error: null });
  mockFrom.mockImplementation(table => {
    if (table !== 'facility_members') throw new Error('business access must not start');
    return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), in: mockMembership };
  });
  mockServiceClient.mockReturnValue({ from: mockFrom });
});
describe.each(routes)('%s', (_name, method, handler) => {
  test.each(['data-error', 'null-error', 'throw'])('uncertain auth %s stops before facility or business access', async fault => {
    if (fault === 'throw') mockGetUser.mockRejectedValue(new Error('private-auth-diagnostic'));
    else mockGetUser.mockResolvedValue({ data: { user: fault === 'data-error' ? { id: 'synthetic-user' } : null }, error: { message: 'private-auth-diagnostic' } });
    const response = await handler(request(method));
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ code: 'AUTH_UNAVAILABLE' });
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockServiceClient).not.toHaveBeenCalled();
    expect(fetchPlaceDetails).not.toHaveBeenCalled();
    expect(dns.resolveTxt).not.toHaveBeenCalled();
  });
  test.each(['data-error', 'null-error', 'throw'])('uncertain membership %s stops before business work', async fault => {
    if (fault === 'throw') mockMembership.mockRejectedValue(new Error('private-db-diagnostic'));
    else mockMembership.mockResolvedValue({ data: fault === 'data-error' ? [{ facility_id: facilityId }] : null, error: { code: '08006', message: 'private-db-diagnostic' } });
    const response = await handler(request(method));
    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).not.toContain('private-db-diagnostic');
    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalledWith('facility_members');
    expect(fetchPlaceDetails).not.toHaveBeenCalled();
    expect(dns.resolveTxt).not.toHaveBeenCalled();
  });
});
