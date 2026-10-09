/** @jest-environment node */
jest.mock('@/lib/rate-limit', () => ({ mutationRateLimit: {}, checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn(), getRequestContext: jest.fn(() => ({ ua: 'test', ip: '127.0.0.1' })) }));
jest.mock('@/lib/admin-date', () => ({ todayJst: jest.fn(() => '2026-10-08') }));
jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));
const mockCleanupVersion = jest.fn(); const mockGetAll = jest.fn(); const mockGetUser = jest.fn(); const mockFrom = jest.fn(); const mockDeleteUser = jest.fn();
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: mockGetAll }) }));
jest.mock('@supabase/ssr', () => ({ createServerClient: () => ({ auth: { getUser: mockGetUser } }) }));
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => ({ from: mockFrom, rpc: mockCleanupVersion, auth: { admin: { deleteUser: mockDeleteUser } } })) }));
import { POST } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';
import { writeAuditLog } from '@/lib/audit-logger';
import { createClient } from '@supabase/supabase-js';
const USER='user-delete-test';
function request(body: unknown = { confirmation: 'DELETE' }, cleanupHeader: string | null = '1') {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (cleanupHeader !== null) headers.set('X-CareLink-Client-Cleanup', cleanupHeader);
  return new Request('http://localhost/api/account/delete', { method: 'POST', headers, body: JSON.stringify(body) });
}
function setup({ own = 0, facility = 0, ownError = null, facilityError = null, memberships = [] as unknown, membershipError = null }: {own?: number | null; facility?: number | null; ownError?: unknown; facilityError?: unknown; memberships?: unknown; membershipError?: unknown} = {}) {
  mockFrom.mockImplementation((table: string) => {
    if (table==='facility_members') return { select: () => ({ eq: () => ({ eq: async () => ({ data: memberships, error: membershipError }) }) }) };
    if(table==='bookings') {
      let ownRead=false; const chain={ eq: jest.fn(() => { ownRead=true;return chain; }), in: jest.fn(() => chain), gte: jest.fn(async () => ({ count: ownRead ? own : facility, error: ownRead ? ownError : facilityError })) };
      return { select: jest.fn(() => chain) };
    }
    throw new Error(`unexpected non-atomic application cleanup of ${table}`);
  });
}
beforeEach(() => {
  jest.clearAllMocks(); (checkRateLimit as jest.Mock).mockResolvedValue(false); (checkCsrf as jest.Mock).mockReturnValue(null);
  mockGetAll.mockReturnValue([]); mockGetUser.mockResolvedValue({ data: { user: { id: USER } }, error: null }); mockDeleteUser.mockResolvedValue({ error: null }); mockCleanupVersion.mockReset().mockResolvedValue({ data: 1, error: null }); setup();
  process.env.NEXT_PUBLIC_SUPABASE_URL='https://test.supabase.co'; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='anon'; process.env.SUPABASE_SERVICE_ROLE_KEY='service';
});
test('CSRF and rate limits block even Auth lookup', async () => {
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response('{}',{status:403})); expect((await POST(request())).status).toBe(403);
  (checkRateLimit as jest.Mock).mockResolvedValueOnce(true); expect((await POST(request())).status).toBe(429); expect(mockGetUser).not.toHaveBeenCalled(); expect(mockDeleteUser).not.toHaveBeenCalled();
});
test.each([{ data: { user: null }, error: null }, { data: { user: { id: USER } }, error: { message: 'identity failed' } }])('verified identity required even with accompanying data', async identity => {
  mockGetUser.mockResolvedValue(identity); expect((await POST(request())).status).toBe(401); expect(mockFrom).not.toHaveBeenCalled(); expect(mockDeleteUser).not.toHaveBeenCalled();
});
test.each([{}, { confirmation: 'delete' }, null, 'DELETE', []])('explicit DELETE confirmation required', async body => {
  expect((await POST(request(body))).status).toBe(400); expect(mockFrom).not.toHaveBeenCalled(); expect(mockDeleteUser).not.toHaveBeenCalled();
});
test('malformed JSON safely rejected', async () => {
  const req=new Request('http://localhost/api/account/delete',{method:'POST',body:'invalid'}); expect((await POST(req)).status).toBe(400); expect(mockDeleteUser).not.toHaveBeenCalled();
});
test.each([null, '', '0', 'true', '2', '1, 1'])('missing/invalid local cleanup consumer marker %p rejects old retirement tabs before privileged work', async marker => {
  const res = await POST(request({ confirmation: 'DELETE' }, marker));
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual(expect.objectContaining({ code: 'CLIENT_CLEANUP_REQUIRED', error: expect.stringContaining('退会画面を開き直して') }));
  expect(res.headers.get('Cache-Control')).toBe('no-store');
  expect(res.headers.get('set-cookie')).toBeNull();
  expect(mockGetUser).toHaveBeenCalledTimes(1);
  expect(createClient).not.toHaveBeenCalled();
  expect(mockFrom).not.toHaveBeenCalled();
  expect(mockCleanupVersion).not.toHaveBeenCalled();
  expect(mockDeleteUser).not.toHaveBeenCalled();
  expect(writeAuditLog).not.toHaveBeenCalled();
});
test.each([{ own: 1 }, { memberships: [{ facility_id: 'facility' }], facility: 1 }])('active own/owned-facility bookings prevent all deletion', async cfg => {
  setup(cfg); const res=await POST(request()); expect(res.status).toBe(409); expect((await res.json()).error).toContain('未完了の予約'); expect(mockDeleteUser).not.toHaveBeenCalled(); expect(writeAuditLog).not.toHaveBeenCalled();
});
test.each([{ own: null }, { ownError: { message: 'failed' } }, { own: 2, ownError: { message: 'partial data rejected' } }])('unknown own booking count stays failure', async cfg => {
  setup(cfg); expect((await POST(request())).status).toBe(500); expect(mockDeleteUser).not.toHaveBeenCalled();
});
test.each([{ memberships: null }, { memberships: [] , membershipError: { message: 'failed' } }, { memberships: [{ facility_id: 'facility' }], membershipError: { message: 'partial data rejected' } }])('unknown memberships stay failure', async cfg => {
  setup(cfg); expect((await POST(request())).status).toBe(500); expect(mockDeleteUser).not.toHaveBeenCalled();
});
test.each([{ facility: null }, { facilityError: { message: 'failed' } }, { facility: 2, facilityError: { message: 'partial data rejected' } }])('unknown facility count stays failure', async cfg => {
  setup({ memberships: [{ facility_id: 'facility' }], ...cfg }); expect((await POST(request())).status).toBe(500); expect(mockDeleteUser).not.toHaveBeenCalled();
});
test.each([{ memberships: [] }, { memberships: [{ facility_id: 'facility' }] }])('successful retirement performs only one Auth transaction, no HTTP cleanup/presuspension', async ({ memberships }) => {
  setup({ memberships }); const res=await POST(request()); expect(res.status).toBe(200); expect(await res.json()).toEqual({success:true});
  expect(mockDeleteUser).toHaveBeenCalledTimes(1); expect(mockDeleteUser).toHaveBeenCalledWith(USER);
  expect(mockFrom.mock.calls.map(call=>call[0])).toEqual(memberships.length ? ['bookings','facility_members','bookings'] : ['bookings','facility_members']);
  expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({userId:null,recordId:USER,tableName:'profiles'}));
});
test('Auth failure leaves account context to its transaction; no premature cleanup, suspension or success audit', async () => {
  setup({ memberships: [{ facility_id: 'facility' }] }); mockDeleteUser.mockResolvedValue({error:{message:'Auth database failure'}});
  expect((await POST(request())).status).toBe(500); expect(mockFrom.mock.calls.map(call=>call[0])).toEqual(['bookings','facility_members','bookings']); expect(writeAuditLog).not.toHaveBeenCalled();
});
test.each([new Error('Auth dependency threw'), { message:'plain provider failure' }])('thrown Auth dependency failures are visible', async error => {
  mockDeleteUser.mockRejectedValue(error); expect((await POST(request())).status).toBe(500); expect(writeAuditLog).not.toHaveBeenCalled();
});
test('successful retirement clears only Auth cookies after commit', async () => {
  mockGetAll.mockReturnValue([{name:'sb-project-auth-token',value:'synthetic'},{name:'sb-project-auth-token.0',value:'synthetic'},{name:'_cm_mbr_cache',value:'synthetic'},{name:'theme',value:'dark'}]);
  const res=await POST(request()); expect(res.status).toBe(200); const cookies=res.headers.get('set-cookie') || '';
  expect(cookies).toContain('sb-project-auth-token='); expect(cookies).toContain('sb-project-auth-token.0='); expect(cookies).toContain('Max-Age=0'); expect(cookies).not.toContain('theme='); expect(cookies).not.toContain('_cm_mbr_cache=');
});
test('failed Auth transaction never clears session cookies', async () => {
  mockGetAll.mockReturnValue([{name:'sb-project-auth-token',value:'synthetic'}]); mockDeleteUser.mockResolvedValue({error:{message:'cleanup trigger failed'}});
  const res=await POST(request()); expect(res.status).toBe(500); expect(res.headers.get('set-cookie')).toBeNull();
});

test.each([{data:null,error:null},{data:0,error:null},{data:'1',error:null},{data:[1],error:null},{data:1,error:{message:'unknown response'}}])('migration gate unconfirmed %# prevents Auth deletion and all other writes',async readiness=>{
  mockCleanupVersion.mockResolvedValue(readiness);const res=await POST(request());expect(res.status).toBe(503);expect((await res.json()).code).toBe('ACCOUNT_DELETE_UNAVAILABLE');
  expect(mockCleanupVersion).toHaveBeenCalledWith('account_deletion_cleanup_version');expect(mockDeleteUser).not.toHaveBeenCalled();expect(writeAuditLog).not.toHaveBeenCalled();expect(res.headers.get('Cache-Control')).toBe('no-store');
});
test('thrown readiness request also returns safe503 before Auth',async()=>{
 mockCleanupVersion.mockRejectedValue(new Error('readiness network failed'));expect((await POST(request())).status).toBe(503);expect(mockDeleteUser).not.toHaveBeenCalled();
});

test('only confirmed Auth success sets a host-only non-secret cleanup marker for legacy tabs',async()=>{
 const res=await POST(request());expect(res.status).toBe(200);const marker=res.cookies.get('carelink_client_cleanup');
 expect(marker?.value).toBe('1');expect(marker?.path).toBe('/');expect(marker?.sameSite).toBe('lax');expect(marker?.maxAge).toBe(604800);expect(marker?.domain).toBeUndefined();expect(marker?.httpOnly).not.toBe(true);
 const header=res.headers.get('set-cookie')||'';expect(header).not.toContain(USER);expect(header).not.toContain('facility');
});
