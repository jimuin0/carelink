/** @jest-environment node */
import { NextRequest, NextResponse } from 'next/server';
import { getAdminApiContext } from '../admin-api-context';
import { POST as staffCreate } from '@/app/api/admin/staff/route';
import { PATCH as staffEdit } from '@/app/api/admin/staff/[id]/route';
import { GET as menuList, POST as menuCreate } from '@/app/api/admin/menus/route';
import { PATCH as menuEdit, DELETE as menuDelete } from '@/app/api/admin/menus/[id]/route';
import { PUT as scheduleReplace, POST as scheduleOverride, DELETE as scheduleDelete } from '@/app/api/admin/staff/[id]/schedule/route';

const mockGetUser = jest.fn();
const mockMembership = jest.fn();
const mockStaff = jest.fn();
const mockAuthClient = jest.fn();
const mockServiceClient = jest.fn();
const mockAuthFrom = jest.fn();
const mockServiceFrom = jest.fn();
jest.mock('../supabase-server-auth', () => ({ createServerSupabaseAuthClient: () => mockAuthClient() }));
jest.mock('../supabase-server', () => ({ createServiceRoleClient: () => mockServiceClient() }));
jest.mock('../csrf', () => ({ checkCsrf: () => null }));
jest.mock('../rate-limit', () => ({ checkRateLimit: async () => false }));
jest.mock('../audit-logger', () => ({ writeAuditLog: jest.fn(), getRequestContext: () => ({}) }));

const facilityId = '22222222-2222-2222-2222-222222222222';
const staffId = '11111111-1111-1111-1111-111111111111';
const error = { code: 'unavailable' };
function query(terminal: jest.Mock) {
  const chain = { select: jest.fn(), eq: jest.fn(), in: jest.fn(), maybeSingle: terminal };
  for (const step of [chain.select, chain.eq, chain.in]) step.mockReturnValue(chain);
  return chain;
}
function request(method = 'POST', selected: string | null = facilityId) {
  const url = new URL('https://carelink.invalid/api/admin/staff');
  if (selected !== null) url.searchParams.set('facility_id', selected);
  return new NextRequest(url, { method, ...(method === 'GET' ? {} : {
    headers: { 'Content-Type': 'application/json' }, body: '{}',
  }) });
}
beforeEach(() => {
  jest.resetAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'verified-user' } }, error: null });
  mockMembership.mockResolvedValue({ data: { facility_id: facilityId }, error: null });
  mockStaff.mockResolvedValue({ data: { id: staffId }, error: null });
  mockAuthFrom.mockReturnValue(query(mockMembership));
  mockServiceFrom.mockReturnValue(query(mockStaff));
  mockAuthClient.mockResolvedValue({ auth: { getUser: mockGetUser }, from: mockAuthFrom });
  mockServiceClient.mockReturnValue({ from: mockServiceFrom });
});
async function expectStatus(result: Promise<unknown>, status: number) {
  const response = await result;
  expect(response).toBeInstanceOf(NextResponse);
  expect((response as NextResponse).status).toBe(status);
  const body = await (response as NextResponse).json();
  if (status === 503) {
    expect(body.code).toBe('AUTH_UNAVAILABLE');
    expect((response as NextResponse).headers.get('Cache-Control')).toBe('no-store');
  }
}
test('verified membership retains the selected facility without a service-role lookup', async () => {
  expect(await getAdminApiContext(request())).toEqual({ userId: 'verified-user', facilityId });
  expect(mockAuthFrom).toHaveBeenCalledWith('facility_members');
  expect(mockServiceClient).not.toHaveBeenCalled();
});
test('schedule context verifies the requested staff only after membership', async () => {
  expect(await getAdminApiContext(request(), staffId)).toEqual({ userId: 'verified-user', facilityId });
  expect(mockServiceFrom).toHaveBeenCalledWith('staff_profiles');
});
test.each([null, '', 'malformed'])('missing or malformed selection is denied before membership %#', async selected => {
  await expectStatus(getAdminApiContext(request('POST', selected)), 401);
  expect(mockAuthFrom).not.toHaveBeenCalled();
  expect(mockServiceClient).not.toHaveBeenCalled();
});
test('authoritative missing identity is denied before membership', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
  await expectStatus(getAdminApiContext(request()), 401);
  expect(mockAuthFrom).not.toHaveBeenCalled();
});
test('a missing membership is denied without service access', async () => {
  mockMembership.mockResolvedValue({ data: null, error: null });
  await expectStatus(getAdminApiContext(request()), 401);
  expect(mockServiceClient).not.toHaveBeenCalled();
});
test('a mismatched membership cannot redirect the selected facility', async () => {
  mockMembership.mockResolvedValue({ data: { facility_id: staffId }, error: null });
  await expectStatus(getAdminApiContext(request()), 503);
  expect(mockServiceClient).not.toHaveBeenCalled();
});
test.each([null, { id: facilityId }])('missing or mismatched staff never grants a schedule context %#', async data => {
  mockStaff.mockResolvedValue({ data, error: null });
  await expectStatus(getAdminApiContext(request(), staffId), data === null ? 401 : 503);
});
test('creating the auth client may fail without granting access', async () => {
  mockAuthClient.mockRejectedValue(new Error('synthetic failure'));
  await expectStatus(getAdminApiContext(request()), 503);
  expect(mockServiceClient).not.toHaveBeenCalled();
});

const routes = [
  ['staff POST', 'POST', staffCreate, false], ['staff PATCH', 'PATCH', staffEdit, false],
  ['menus GET', 'GET', menuList, false], ['menus POST', 'POST', menuCreate, false],
  ['menus PATCH', 'PATCH', menuEdit, false], ['menus DELETE', 'DELETE', menuDelete, false],
  ['schedule PUT', 'PUT', scheduleReplace, true], ['schedule POST', 'POST', scheduleOverride, true],
  ['schedule DELETE', 'DELETE', scheduleDelete, true],
] as const;
test.each(routes)('%s rejects ambiguous identity and membership before service access', async (_name, method, handler) => {
  for (const failure of ['auth-with-data', 'auth-throw', 'member-with-data', 'member-throw']) {
    mockServiceClient.mockClear();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'verified-user' } }, error: null });
    mockMembership.mockResolvedValue({ data: { facility_id: facilityId }, error: null });
    if (failure === 'auth-with-data') mockGetUser.mockResolvedValue({ data: { user: { id: 'verified-user' } }, error });
    if (failure === 'auth-throw') mockGetUser.mockRejectedValue(new Error('synthetic failure'));
    if (failure === 'member-with-data') mockMembership.mockResolvedValue({ data: { facility_id: facilityId }, error });
    if (failure === 'member-throw') mockMembership.mockRejectedValue(new Error('synthetic failure'));
    await expectStatus(handler(request(method), { params: Promise.resolve({ id: staffId }) }), 503);
    expect(mockServiceClient).not.toHaveBeenCalled();
  }
});
test.each(routes.filter(route => route[3]))('%s refuses ambiguous staff before schedule mutations', async (_name, method, handler) => {
  for (const failure of ['staff-with-data', 'staff-throw', 'service-throw']) {
    mockServiceFrom.mockClear();
    mockStaff.mockResolvedValue({ data: { id: staffId }, error });
    if (failure === 'staff-throw') mockStaff.mockRejectedValue(new Error('synthetic failure'));
    if (failure === 'service-throw') mockServiceClient.mockImplementation(() => { throw new Error('synthetic failure'); });
    await expectStatus(handler(request(method), { params: Promise.resolve({ id: staffId }) }), 503);
    // The only privileged query permitted is the read-only staff scope check.
    expect(mockServiceFrom.mock.calls.every(([table]) => table === 'staff_profiles')).toBe(true);
  }
});

test.each([{}, { data: undefined, error: null }, null])('malformed membership envelope is unavailable rather than an authoritative denial %#', async result => {
  mockMembership.mockResolvedValue(result);
  await expectStatus(getAdminApiContext(request()), 503);
  expect(mockServiceClient).not.toHaveBeenCalled();
});
test.each([{}, { data: undefined, error: null }, null])('malformed staff envelope is unavailable %#', async result => {
  mockStaff.mockResolvedValue(result);
  await expectStatus(getAdminApiContext(request(), staffId), 503);
});
