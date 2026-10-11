/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { AuthRetryableFetchError } from '@supabase/supabase-js';
import { GET, POST } from '../route';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

jest.mock('@/lib/rate-limit', () => ({ mutationRateLimit: 'limit', checkRateLimit: jest.fn() }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn() }));
jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));
jest.mock('@supabase/ssr', () => ({ createServerClient: jest.fn() }));
jest.mock('next/headers', () => ({ cookies: jest.fn() }));
const mockRpc = jest.fn(), mockFrom = jest.fn(), mockUser = jest.fn();
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => ({ rpc: mockRpc, from: mockFrom }) }));
const USE = 'bead0000-0000-4000-8000-000000000001';
let own: unknown, used: unknown, usedError: unknown, insertError: unknown;
function req(body: unknown = { code: 'ABC12345' }) {
  return new Request('http://localhost/api/referral', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '127.0.0.1' } });
}
function getReq() { return new Request('http://localhost/api/referral') as never; }
beforeEach(() => {
  jest.clearAllMocks(); own = null; used = null; usedError = null; insertError = null;
  (checkCsrf as jest.Mock).mockReturnValue(null); (checkRateLimit as jest.Mock).mockResolvedValue(false);
  mockUser.mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null });
  (cookies as jest.Mock).mockResolvedValue({ getAll: () => [] });
  (createServerClient as jest.Mock).mockImplementation((_url, _key, options) => {
    options.cookies.getAll(); return { auth: { getUser: mockUser } };
  });
  mockFrom.mockImplementation(table => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => table === 'referral_uses' ? { data: used, error: usedError } : { data: own, error: null } }) }),
    insert: async () => ({ error: insertError }),
  }));
  mockRpc.mockResolvedValue({ data: [{ use_id: USE, code: 'ABC12345', replayed: false }], error: null });
});

describe('GET existing behavior', () => {
  test('rate limit and unauthenticated requests stop before code creation', async () => {
    (checkRateLimit as jest.Mock).mockResolvedValueOnce(true); expect((await GET(getReq())).status).toBe(429);
    mockUser.mockResolvedValueOnce({ data: { user: null }, error: null }); expect((await GET(getReq())).status).toBe(401);
    expect(mockFrom).not.toHaveBeenCalled();
  });
  test.each([false, true])('existing own code returns its recorded count and referral state (%s)', async hasUse => {
    own = { code: 'ABC12345', used_count: 2 }; used = hasUse ? { id: USE } : null;
    const response = await GET(getReq()); expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ code: 'ABC12345', used_count: 2, already_referred: hasUse });
  });
  test('failed use observation does not falsely claim an application; own code still returns', async () => {
    own = { code: 'ABC12345', used_count: 2 }; used = { id: USE }; usedError = { code: '500' };
    expect((await (await GET(getReq())).json()).already_referred).toBe(false);
  });
  test('new code retains eight-character nonambiguous alphabet', async () => {
    const response = await GET(getReq()); expect(response.status).toBe(200);
    expect((await response.json()).code).toMatch(/^[A-HJ-NPQ-Z23456789]{8}$/);
  });
  test('failed insertion and thrown auth are visible errors', async () => {
    insertError = { code: '500' }; expect((await GET(getReq())).status).toBe(500);
    mockUser.mockRejectedValueOnce(new Error('synthetic')); expect((await GET(getReq())).status).toBe(500);
  });
});

describe('POST atomic referral use', () => {
  test('CSRF and rate limit stop before any transaction', async () => {
    (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(null, { status: 403 })); expect((await POST(req() as never)).status).toBe(403);
    (checkRateLimit as jest.Mock).mockResolvedValueOnce(true); expect((await POST(req() as never)).status).toBe(429);
    expect(mockRpc).not.toHaveBeenCalled();
  });
  test('authoritative missing session is 401; SDK-returned 522 and thrown auth are 503', async () => {
    mockUser.mockResolvedValueOnce({ data: { user: null }, error: null }); expect((await POST(req() as never)).status).toBe(401);
    mockUser.mockResolvedValueOnce({ data: { user: null }, error: new AuthRetryableFetchError('private details', 522) }); expect((await POST(req() as never)).status).toBe(503);
    mockUser.mockRejectedValueOnce(new Error('private details')); expect((await POST(req() as never)).status).toBe(503); expect(mockRpc).not.toHaveBeenCalled();
  });
  test.each([{}, { code: '' }, { code: 2 }, { code: 'x'.repeat(101) }])('invalid code refuses mutation (%j)', async body => {
    expect((await POST(req(body) as never)).status).toBe(400); expect(mockRpc).not.toHaveBeenCalled();
  });
  test('invalid JSON refuses mutation', async () => { expect((await POST(new Request('http://localhost/api/referral', { method: 'POST', body: 'not-json' }) as never)).status).toBe(400); });
  test.each([false, true])('fresh/replayed transaction is attested and has no application-level CAS or credit writes (%s)', async replayed => {
    mockRpc.mockResolvedValueOnce({ data: [{ use_id: USE, code: 'ABC12345', replayed }], error: null });
    const response = await POST(req({ code: 'abc12345' }) as never); expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, replayed });
    expect(mockRpc).toHaveBeenCalledWith('apply_referral_code_atomic', { p_user_id: 'user-123', p_code: 'ABC12345' }); expect(mockFrom).not.toHaveBeenCalled();
  });
  test.each([['REFERRAL_CODE_INVALID','無効'],['REFERRAL_SELF_USE','自分'],['REFERRAL_ALREADY_APPLIED','使用済み']])('known transaction rejection %s is actionable', async (message, visible) => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message } }); const response = await POST(req() as never);
    expect(response.status).toBe(400); expect((await response.json()).error).toContain(visible); expect(mockFrom).not.toHaveBeenCalled();
  });
  test.each([{ code: 'P0001', message: 'REFERRAL_COUNT_NOT_CONFIRMED' }, { code: '42883', message: 'missing RPC' }, { code: '522', message: 'lost response' }])('unknown/missing/count failure never falls back to separate writes (%j)', async error => {
    mockRpc.mockResolvedValueOnce({ data: null, error }); expect((await POST(req() as never)).status).toBe(500); expect(mockFrom).not.toHaveBeenCalled();
  });
  test.each([null, [], [{ use_id: USE, code: 'ABC12345', replayed: false }, { use_id: USE }], [{ use_id: 'wrong', code: 'ABC12345', replayed: false }], [{ use_id: USE, code: 'OTHER', replayed: false }], [{ use_id: USE, code: 'ABC12345', replayed: null }]])('unattested response never succeeds (%j)', async data => {
    mockRpc.mockResolvedValueOnce({ data, error: null }); expect((await POST(req() as never)).status).toBe(500); expect(mockFrom).not.toHaveBeenCalled();
  });
  test('throwing RPC stays visible and causes no fallback mutation', async () => { mockRpc.mockRejectedValueOnce(new Error('synthetic')); expect((await POST(req() as never)).status).toBe(500); expect(mockFrom).not.toHaveBeenCalled(); });
});
