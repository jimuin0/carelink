/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import {NextRequest,NextResponse} from 'next/server';
const actor='33333333-3333-4333-8333-333333333333',facility='22222222-2222-4222-8222-222222222222',id='11111111-1111-4111-8111-111111111111';
const menu='423e4567-e89b-12d3-a456-426614174001';
const mockContext=jest.fn(),mockRpc=jest.fn(),mockDirect=jest.fn();
jest.mock('@/lib/admin-api-context',()=>({getAdminApiContext:()=>mockContext()}));
jest.mock('@/lib/supabase-server',()=>({createServiceRoleClient:()=>({rpc:mockRpc,from:mockDirect})}));
jest.mock('@/lib/csrf',()=>({checkCsrf:jest.fn(()=>null)}));
jest.mock('@/lib/rate-limit',()=>({checkRateLimit:jest.fn(()=>false)}));
jest.mock('@/lib/audit-logger',()=>({writeAuditLog:jest.fn(),getRequestContext:()=>({ua:'test'})}));
import {PATCH} from '../route';
import {checkCsrf} from '@/lib/csrf';
import {checkRateLimit} from '@/lib/rate-limit';
import {writeAuditLog} from '@/lib/audit-logger';
function request(body:unknown={name:'Staff'}){return new NextRequest('http://localhost/api/admin/staff/'+id,{method:'PATCH',body:JSON.stringify(body),headers:{'Content-Type':'application/json'}});}
const props=(staff=id)=>({params:Promise.resolve({id:staff})});
beforeEach(()=>{jest.clearAllMocks();mockContext.mockResolvedValue({userId:actor,facilityId:facility});mockRpc.mockResolvedValue({data:{id,facility_id:facility,name:'Staff'},error:null});});
test('CSRF denial prevents context and mutation',async()=>{jest.mocked(checkCsrf).mockReturnValueOnce(NextResponse.json({error:'csrf'},{status:403}));expect((await PATCH(request(),props())).status).toBe(403);expect(mockContext).not.toHaveBeenCalled();});
test('rate guard keeps 20/60s and prevents mutation',async()=>{jest.mocked(checkRateLimit).mockResolvedValueOnce(true);expect((await PATCH(request(),props())).status).toBe(429);expect(checkRateLimit).toHaveBeenCalledWith(null,expect.any(String),20,60000,'admin-staff-patch');expect(mockRpc).not.toHaveBeenCalled();});
test('invalid staff ID prevents mutation',async()=>{expect((await PATCH(request(),props('bad'))).status).toBe(400);expect(mockRpc).not.toHaveBeenCalled();});
test.each([401,403])('context denial %s prevents mutation',async status=>{mockContext.mockResolvedValue(NextResponse.json({error:'denied'},{status}));expect((await PATCH(request(),props())).status).toBe(status);expect(mockRpc).not.toHaveBeenCalled();});
test.each([
 {name:''},{name:'n'.repeat(51)},{name:'S',instagram_url:'bad'}, {name:'S',specialties:Array(21).fill('S')},
 {name:'S',years_experience:100},{name:'S',nomination_fee:-1},{name:'S',nomination_fee:100000},
 {name:'S',nomination_fee:'12'},{name:'S',menu_ids:['bad']},{name:'S',menu_ids:Array(201).fill(menu)},null,
])('invalid body causes no mutation: %p',async body=>{expect((await PATCH(request(body),props())).status).toBe(400);expect(mockRpc).not.toHaveBeenCalled();});
test('invalid JSON causes no mutation',async()=>{const r=new NextRequest('http://localhost/api/admin/staff/'+id,{method:'PATCH',body:'{'});expect((await PATCH(r,props())).status).toBe(400);});
test('successful edit has one atomic call with verified actor and scope',async()=>{
 const r=await PATCH(request(),props());expect(r.status).toBe(200);expect(await r.json()).toEqual({staff:{id,facility_id:facility,name:'Staff'}});
 expect(mockRpc).toHaveBeenCalledWith('save_admin_staff_atomic',{p_actor_id:actor,p_facility_id:facility,p_staff_id:id,p_menu_ids:null,p_values:{name:'Staff',position:null,bio:null,specialties:[],years_experience:null,instagram_url:null,nomination_fee:0,line_works_channel_id:null,line_works_notify_all:false}});
 expect(mockDirect).not.toHaveBeenCalled();expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({userId:actor,facilityId:facility,recordId:id}));
});
test.each([[[]],[[menu]]])('assignment clear/replacement %p stays inside the atomic call',async menu_ids=>{expect((await PATCH(request({name:'S',menu_ids}),props())).status).toBe(200);expect(mockRpc.mock.calls[0][1].p_menu_ids).toEqual(menu_ids);expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({newValues:expect.objectContaining({menu_ids})}));expect(mockDirect).not.toHaveBeenCalled();});
test.each([false,true])('explicit is_active=%s is forwarded',async is_active=>{await PATCH(request({name:'S',is_active}),props());expect(mockRpc.mock.calls[0][1].p_values.is_active).toBe(is_active);});
test.each([0,99999])('nomination fee boundary %s survives',async nomination_fee=>{await PATCH(request({name:'S',nomination_fee}),props());expect(mockRpc.mock.calls[0][1].p_values.nomination_fee).toBe(nomination_fee);});
test('full optional fields survive without clearing is_active implicitly',async()=>{const body={name:'S',position:'Stylist',bio:'Bio',specialties:['Cut'],years_experience:2,instagram_url:'https://example.invalid/staff',nomination_fee:10,line_works_channel_id:'channel',line_works_notify_all:true};await PATCH(request(body),props());expect(mockRpc.mock.calls[0][1].p_values).toEqual(body);expect(mockRpc.mock.calls[0][1].p_values).not.toHaveProperty('is_active');});
test('empty instagram normalizes to null',async()=>{await PATCH(request({name:'S',instagram_url:''}),props());expect(mockRpc.mock.calls[0][1].p_values.instagram_url).toBeNull();});
test.each([['42501',403],['22023',400],['P0002',404],['23505',409],['40001',409],['XX000',500]])('atomic SQL error %s is not audited as successful',async(code,status)=>{mockRpc.mockResolvedValue({data:null,error:{code,message:'PRIVATE'}});const r=await PATCH(request({name:'S',menu_ids:[menu,menu]}),props());expect(r.status).toBe(status);expect(writeAuditLog).not.toHaveBeenCalled();expect(mockDirect).not.toHaveBeenCalled();});
