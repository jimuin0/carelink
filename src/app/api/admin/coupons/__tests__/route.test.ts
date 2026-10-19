/** @jest-environment node */
jest.mock('@/lib/admin-api-context', () => ({ getAdminApiContext: jest.fn() }));
jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn(), getRequestContext: jest.fn(() => ({ ua: 'test' })) }));
jest.mock('@/lib/safe', () => ({ safeCaptureException: jest.fn() }));
jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));
const mockRpc = jest.fn(); const mockFrom = jest.fn();
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => ({ rpc: mockRpc, from: mockFrom }) }));
import { NextRequest, NextResponse } from 'next/server';
import { GET, POST } from '../route';
import { getAdminApiContext } from '@/lib/admin-api-context';
import { checkRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';
import { writeAuditLog } from '@/lib/audit-logger';
const facilityId='22222222-2222-4222-8222-222222222222';
const actorId='33333333-3333-4333-8333-333333333333';
function request(method='POST',body: unknown={name:'Coupon',discount_type:'fixed',discount_value:500}) {
 return new NextRequest(`https://localhost/api/admin/coupons?facility_id=${facilityId}`, {method, ...(method==='POST'?{body:JSON.stringify(body)}:{})});
}
beforeEach(()=>{
 jest.clearAllMocks();
 (checkCsrf as jest.Mock).mockReturnValue(null); (checkRateLimit as jest.Mock).mockReturnValue(false);
 (getAdminApiContext as jest.Mock).mockResolvedValue({userId:actorId,facilityId});
 mockRpc.mockResolvedValue({data:{was_replay:false,outcome:'saved',coupon:{id:'fa810003-0000-4000-8000-000000000001',facility_id:facilityId}},error:null});
 mockFrom.mockReturnValue({select:jest.fn().mockReturnThis(),eq:jest.fn().mockReturnThis(),order:jest.fn().mockResolvedValue({data:[],error:null})});
});
test.each([GET,POST])('rate limited route performs no writes',async route=>{
 (checkRateLimit as jest.Mock).mockReturnValue(true);expect((await route(request(route===GET?'GET':'POST'))).status).toBe(429);expect(mockRpc).not.toHaveBeenCalled();
});
test.each([401,503])('verified context refusal %s never saves',async status=>{
 (getAdminApiContext as jest.Mock).mockResolvedValue(NextResponse.json({error:'context'}, {status}));
 expect((await GET(request('GET'))).status).toBe(status);expect((await POST(request())).status).toBe(status);expect(mockRpc).not.toHaveBeenCalled();
});
test('CSRF refusal is returned before context/save',async()=>{(checkCsrf as jest.Mock).mockReturnValue(NextResponse.json({}, {status:403}));expect((await POST(request())).status).toBe(403);expect(mockRpc).not.toHaveBeenCalled();});
test('GET scoped list succeeds',async()=>{expect((await GET(request('GET'))).status).toBe(200);expect(mockFrom().eq).toHaveBeenCalledWith('facility_id',facilityId);});
test('GET database failure is visible',async()=>{mockFrom().order.mockResolvedValue({data:null,error:{code:'08006',message:'private'}});expect((await GET(request('GET'))).status).toBe(500);});
test('POST saves coupon and restriction with one gateway call and audit only after success',async()=>{
 const target=['44444444-4444-4444-8444-444444444444'];
 const res=await POST(request('POST',{name:'Limited',discount_type:'fixed',discount_value:500,target_menu_ids:target}));
 expect(res.status).toBe(201);expect(mockFrom).not.toHaveBeenCalled();
 expect(mockRpc).toHaveBeenCalledTimes(1);expect(mockRpc).toHaveBeenCalledWith('manage_admin_coupon_with_receipt_atomic',expect.objectContaining({p_actor_id:actorId,p_facility_id:facilityId,p_coupon_id:null,p_target_menu_ids:target,p_kind:'create',p_operation_id:expect.any(String)}));
 expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({newValues:expect.objectContaining({target_menu_ids:target})}));
});
test('omitted targets creates unrestricted coupon, inactive flag preserved',async()=>{await POST(request('POST',{name:'Inactive',discount_type:'percentage',discount_value:100,is_active:false}));expect(mockRpc).toHaveBeenCalledWith('manage_admin_coupon_with_receipt_atomic',expect.objectContaining({p_fields:expect.objectContaining({is_active:false,special_price:null}),p_target_menu_ids:[]}));});
test.each([
 {name:''}, {discount_type:'bad'}, {coupon_type:'bad'}, {discount_type:'percentage',discount_value:101},
 {discount_type:'fixed',discount_value:0}, {discount_type:'fixed',discount_value:100001},
 {discount_type:'special_price',special_price:null}, {target_menu_ids:['bad']},
])('invalid input cannot invoke transaction: %j',async fields=>{expect((await POST(request('POST',{name:'Coupon',discount_type:'fixed',discount_value:500,...fields}))).status).toBe(400);expect(mockRpc).not.toHaveBeenCalled();});
test('invalid JSON is rejected',async()=>{const r=new NextRequest('https://localhost/api/admin/coupons',{method:'POST',body:'{'});expect((await POST(r)).status).toBe(400);});
test('special price normalization and maximum are preserved',async()=>{expect((await POST(request('POST',{name:'Special',discount_type:'special_price',special_price:9999999,discount_value:500}))).status).toBe(201);expect(mockRpc).toHaveBeenCalledWith('manage_admin_coupon_with_receipt_atomic',expect.objectContaining({p_fields:expect.objectContaining({discount_value:null,special_price:9999999})}));});
test.each([['42501',401],['22023',400],['08006',500]])('gateway error %s yields %s without compensation writes or success audit',async(code,status)=>{mockRpc.mockResolvedValue({data:null,error:{code,message:'private'}});expect((await POST(request())).status).toBe(status);expect(mockFrom).not.toHaveBeenCalled();expect(writeAuditLog).not.toHaveBeenCalled();});
test('missing transaction receipt is not phantom success',async()=>{mockRpc.mockResolvedValue({data:null,error:null});expect((await POST(request())).status).toBe(500);expect(writeAuditLog).not.toHaveBeenCalled();});

function operationRequest(query:string){return new NextRequest(`https://localhost/api/admin/coupons?facility_id=${facilityId}&${query}`);}
const OP='fa830000-0000-4000-8000-000000000001';
test.each(['absent','saved','retired'])('operation recovery returns confirmed %s without another write',async state=>{mockRpc.mockResolvedValue({data:state,error:null});expect(await (await GET(operationRequest(`operation_id=${OP}&kind=create`))).json()).toEqual({state});expect(mockFrom).not.toHaveBeenCalled();});
test('update operation recovery binds its coupon target',async()=>{mockRpc.mockResolvedValue({data:'saved',error:null});expect((await GET(operationRequest(`operation_id=${OP}&kind=update&coupon_id=${OP}`))).status).toBe(200);expect(mockRpc).toHaveBeenCalledWith('get_admin_coupon_operation',expect.objectContaining({p_coupon_id:OP,p_kind:'update'}));});
test.each([`operation_id=bad&kind=create`,`operation_id=${OP}`,`operation_id=${OP}&kind=bad`,`operation_id=${OP}&kind=create&coupon_id=${OP}`,`operation_id=${OP}&kind=update`,`operation_id=${OP}&kind=retire&coupon_id=bad`])('malformed recovery query cannot read operations: %s',async query=>{expect((await GET(operationRequest(query))).status).toBe(400);expect(mockRpc).not.toHaveBeenCalled();});
test.each([null,'bad'])('invalid recovery result is not absent: %j',async data=>{mockRpc.mockResolvedValue({data,error:null});expect((await GET(operationRequest(`operation_id=${OP}&kind=create`))).status).toBe(500);});
test('recovery database failure is visible',async()=>{mockRpc.mockResolvedValue({data:null,error:{code:'08006'}});expect((await GET(operationRequest(`operation_id=${OP}&kind=create`))).status).toBe(500);});
test.each([['23505',409],['P0002',410]])('create operation refusal %s is %s',async(code,status)=>{mockRpc.mockResolvedValue({data:null,error:{code}});expect((await POST(request())).status).toBe(status);expect(writeAuditLog).not.toHaveBeenCalled();});
test('supplied create operation ID is reused and replay has no duplicate audit',async()=>{mockRpc.mockResolvedValue({data:{was_replay:true,outcome:'saved',coupon:{id:OP,facility_id:facilityId}},error:null});const r=request();r.headers.set('Idempotency-Key',OP);expect((await POST(r)).status).toBe(201);expect(mockRpc).toHaveBeenCalledWith('manage_admin_coupon_with_receipt_atomic',expect.objectContaining({p_operation_id:OP}));expect(writeAuditLog).not.toHaveBeenCalled();});
test('invalid create operation header never mutates',async()=>{const r=request();r.headers.set('Idempotency-Key','bad');expect((await POST(r)).status).toBe(400);expect(mockRpc).not.toHaveBeenCalled();});

test.each([{valid_from:'0000-01-01'},{valid_until:'2026-02-30'},{valid_from:'2026-12-31',valid_until:'2026-01-01'}])('invalid coupon calendar date %p cannot save',async fields=>{
 expect((await POST(request('POST',{name:'Coupon',discount_type:'fixed',discount_value:500,...fields}))).status).toBe(400);expect(mockRpc).not.toHaveBeenCalled();
});
