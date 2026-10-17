/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * Tests for PATCH/DELETE /api/admin/menus/[id]
 * Key assertions:
 *   - facility_id in WHERE (defence-in-depth for cross-facility IDOR)
 *   - Duplicate name check → 409
 *   - photo_url must be valid URL or empty
 *   - facility_id query param required
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn() }));
jest.mock('@/lib/with-route', () => {
  const actual = jest.requireActual('@/lib/with-route');
  return { ...actual, serverError: jest.fn(actual.serverError) };
});
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));

const MENU_UUID = '11111111-1111-4111-8111-111111111111';
const FACILITY_UUID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';

const mockAdminFrom = jest.fn();
const mockRpc = jest.fn();
const mockAnonFrom = jest.fn();
const mockGetUser = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom, rpc: mockRpc }),
}));

import { NextRequest, NextResponse } from 'next/server';
import { PATCH } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';
import { writeAuditLog } from '@/lib/audit-logger';
import * as routeErrors from '@/lib/with-route';

function makeRequest(method: string, body?: object, facilityId: string | null = FACILITY_UUID) {
  const url = new URL(`http://localhost/api/admin/menus/${MENU_UUID}`);
  if (facilityId) url.searchParams.set('facility_id', facilityId);
  return new NextRequest(url.toString(), {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function makeProps(id = MENU_UUID) {
  return { params: Promise.resolve({ id }) };
}

function memberChain(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

function maybeSingleChain(data: unknown, error: unknown = null) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn(() => Promise.resolve({ data, error })),
  };
}


beforeEach(()=>{
 jest.clearAllMocks();mockRpc.mockReset();mockAdminFrom.mockReset();
 (checkRateLimit as jest.Mock).mockReturnValue(false);(checkCsrf as jest.Mock).mockReturnValue(null);
 mockGetUser.mockResolvedValue({data:{user:{id:USER_ID}}});mockAnonFrom.mockReturnValue(memberChain({facility_id:FACILITY_UUID}));
 mockRpc.mockResolvedValue({data:{id:MENU_UUID,facility_id:FACILITY_UUID},error:null});
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='test-key';
});
test('PATCH unauthenticated',async()=>{mockGetUser.mockResolvedValue({data:{user:null}});expect((await PATCH(makeRequest('PATCH',{price:100}),makeProps())).status).toBe(401);expect(mockRpc).not.toHaveBeenCalled();});
test('PATCH missing facility',async()=>{expect((await PATCH(makeRequest('PATCH',{price:100},null),makeProps())).status).toBe(401);});
test('PATCH invalid ID',async()=>{expect((await PATCH(makeRequest('PATCH',{price:100}),makeProps('bad'))).status).toBe(400);});
test('PATCH no membership',async()=>{mockAnonFrom.mockReturnValue(memberChain(null));expect((await PATCH(makeRequest('PATCH',{price:100}),makeProps())).status).toBe(401);});
test('PATCH CSRF',async()=>{(checkCsrf as jest.Mock).mockReturnValue(NextResponse.json({}, {status:403}));expect((await PATCH(makeRequest('PATCH',{price:100}),makeProps())).status).toBe(403);});
test('PATCH rate limit',async()=>{(checkRateLimit as jest.Mock).mockReturnValue(true);expect((await PATCH(makeRequest('PATCH',{price:100}),makeProps())).status).toBe(429);});
test.each([{name:''},{name:'x'.repeat(101)},{category:''},{category:'x'.repeat(51)},{price:-1},{price:10000000},{duration_minutes:-1},{duration_minutes:1441},{sort_order:-1},{sort_order:1000000},{photo_url:'bad'},{description:'x'.repeat(501)},{price_note:'x'.repeat(101)}])('PATCH rejects invalid field: %p',async payload=>{
 expect((await PATCH(makeRequest('PATCH',payload),makeProps())).status).toBe(400);expect(mockRpc).not.toHaveBeenCalled();
});
test('PATCH old reorder rejected',async()=>{expect((await PATCH(makeRequest('PATCH',{sort_order:3}),makeProps())).status).toBe(409);expect(mockRpc).not.toHaveBeenCalled();});
test.each([{price:100},{photo_url:''},{photo_url:null},{name:'Rename',description:'New'},{is_featured:false},{duration_minutes:0}])('PATCH scoped save: %p',async payload=>{
 const r=await PATCH(makeRequest('PATCH',payload),makeProps());expect(r.status).toBe(200);expect((await r.json()).menu.id).toBe(MENU_UUID);
 expect(mockRpc).toHaveBeenCalledWith('save_admin_menu_atomic',expect.objectContaining({p_actor_id:USER_ID,p_facility_id:FACILITY_UUID,p_menu_id:MENU_UUID}));expect(writeAuditLog).toHaveBeenCalledTimes(1);
 const values=mockRpc.mock.calls[0][1].p_values;if('photo_url' in payload)expect(values.photo_url).toBeNull();else expect(values).not.toHaveProperty('photo_url');
});
test.each([['42501',403],['P0002',404],['23505',409],['40001',409],['22023',400],['57014',500]])('PATCH SQL failure %s cannot audit success',async(code,status)=>{
 mockRpc.mockResolvedValue({data:null,error:{code,message:'PRIVATE_DETAIL'}});const r=await PATCH(makeRequest('PATCH',{price:100}),makeProps());expect(r.status).toBe(status);expect(writeAuditLog).not.toHaveBeenCalled();expect(JSON.stringify(await r.json())).not.toContain('PRIVATE_DETAIL');
});
const STOCK='https://images.unsplash.com/existing';
test('PATCH retains a legacy photo only with the observed value bound into SQL',async()=>{
 mockAdminFrom.mockReturnValue(maybeSingleChain({photo_url:STOCK}));expect((await PATCH(makeRequest('PATCH',{photo_url:STOCK,price:200}),makeProps())).status).toBe(200);
 expect(mockRpc.mock.calls[0][1]).toMatchObject({p_check_photo:true,p_expected_photo:STOCK});
});
test.each([null,'https://images.unsplash.com/different'])('PATCH cannot add stock image over %p',async photo=>{
 mockAdminFrom.mockReturnValue(maybeSingleChain({photo_url:photo}));expect((await PATCH(makeRequest('PATCH',{photo_url:STOCK}),makeProps())).status).toBe(400);expect(mockRpc).not.toHaveBeenCalled();
});
test('PATCH missing photo row',async()=>{mockAdminFrom.mockReturnValue(maybeSingleChain(null));expect((await PATCH(makeRequest('PATCH',{photo_url:STOCK}),makeProps())).status).toBe(404);expect(mockRpc).not.toHaveBeenCalled();});
test.each([null,{photo_url:STOCK}])('PATCH photo query failure stops before mutation: %p',async data=>{
 mockAdminFrom.mockReturnValue(maybeSingleChain(data,{code:'08006',message:'PRIVATE_DETAIL'}));const r=await PATCH(makeRequest('PATCH',{photo_url:STOCK}),makeProps());expect(r.status).toBe(500);expect(mockRpc).not.toHaveBeenCalled();expect(writeAuditLog).not.toHaveBeenCalled();expect(jest.mocked(routeErrors.serverError).mock.calls[0][1].message).toBe('DATABASE_FAILURE:08006');
});
test('PATCH malformed JSON',async()=>{expect((await PATCH(new NextRequest('http://localhost/api/admin/menus/'+MENU_UUID+'?facility_id='+FACILITY_UUID,{method:'PATCH',body:'{'}),makeProps())).status).toBe(400);});
