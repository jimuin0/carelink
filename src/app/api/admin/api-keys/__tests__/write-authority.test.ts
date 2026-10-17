/** @jest-environment node */
jest.mock('@/lib/supabase-server-auth');
jest.mock('@/lib/supabase-server');
jest.mock('@/lib/rate-limit',()=>({checkRateLimit:jest.fn(()=>false)}));
jest.mock('@/lib/csrf',()=>({checkCsrf:jest.fn(()=>null)}));
jest.mock('@/lib/audit-logger',()=>({writeAuditLog:jest.fn(),getRequestContext:()=>({})}));
jest.mock('@/lib/safe',()=>({safeCaptureException:jest.fn()}));
jest.mock('@/lib/alert',()=>({alertCaughtError:jest.fn()}));
import { NextRequest } from 'next/server';
import { POST } from '../route';
import { DELETE } from '../[id]/route';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
const actor='33333333-3333-4333-8333-333333333333',facility='22222222-2222-4222-8222-222222222222',id='11111111-1111-4111-8111-111111111111';
const rpc=jest.fn(), direct=jest.fn();
const key={id,facility_id:facility,name:'Synthetic',key_prefix:'ck_live_12345678',scopes:['bookings:read'],is_active:true,last_used_at:null,expires_at:null,created_at:'2026-10-17T00:00:00Z'};
const body={facility_id:facility,name:'Synthetic',scopes:['bookings:read']};
function request(value:unknown=body){return new NextRequest('http://localhost/api/admin/api-keys',{method:'POST',body:JSON.stringify(value)});}
beforeEach(()=>{jest.clearAllMocks();const member={select:jest.fn().mockReturnThis(),eq:jest.fn().mockReturnThis(),in:jest.fn().mockReturnThis(),maybeSingle:jest.fn().mockResolvedValue({data:{role:'owner'},error:null})};
(createServerSupabaseAuthClient as jest.Mock).mockResolvedValue({auth:{getUser:jest.fn().mockResolvedValue({data:{user:{id:actor}},error:null})},from:jest.fn(()=>member)});
const write={select:()=>({single:async()=>({data:key,error:null})}),eq:()=>({eq:()=>({select:async()=>({data:[key],error:null})})})};direct.mockReturnValue(write);
(createServiceRoleClient as jest.Mock).mockReturnValue({rpc,from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{facility_id:facility},error:null})})}),insert:direct,update:direct})});rpc.mockResolvedValue({data:key,error:null});});
test('owner removed after HTTP precheck cannot issue a key or emit a raw credential',async()=>{rpc.mockResolvedValue({data:key,error:{code:'42501'}});const res=await POST(request());expect(res.status).toBe(403);expect(await res.json()).not.toHaveProperty('raw_key');expect(direct).not.toHaveBeenCalled();expect(require('@/lib/audit-logger').writeAuditLog).not.toHaveBeenCalled();});
test('membership removed after HTTP precheck cannot revoke or claim success',async()=>{rpc.mockResolvedValue({data:{...key,is_active:false},error:{code:'42501'}});const res=await DELETE(request(),{params:Promise.resolve({id})});expect(res.status).toBe(404);expect(direct).not.toHaveBeenCalled();expect(require('@/lib/audit-logger').writeAuditLog).not.toHaveBeenCalled();});
test.each([null,[],1,'body'])('invalid JSON shape %p is bounded 400',async value=>{expect((await POST(request(value))).status).toBe(400);expect(rpc).not.toHaveBeenCalled();});
test.each([[null],[{}],[{toString:'bad'}]].map(scopes=>[scopes]))('non-string scope %p cannot throw',async scopes=>{expect((await POST(request({...body,scopes}))).status).toBe(400);expect(rpc).not.toHaveBeenCalled();});
test('raw key only leaves after committed receipt; hash never leaves, duplicate scopes deduped',async()=>{rpc.mockImplementation(async(_name,args)=>({data:{...key,key_hash:args.p_values.key_hash},error:null}));const res=await POST(request({...body,scopes:['bookings:read','bookings:read']}));expect(res.status).toBe(201);expect(res.headers.get('Cache-Control')).toBe('no-store');const data=await res.json();expect(data.raw_key).toMatch(/^ck_live_[a-f0-9]{64}$/);expect(data.key).not.toHaveProperty('key_hash');expect(data.key).not.toHaveProperty('facility_id');const args=rpc.mock.calls[0][1];expect(args.p_actor_id).toBe(actor);expect(args.p_values.scopes).toEqual(['bookings:read']);expect(args.p_values.key_hash).toBe(require('crypto').createHash('sha256').update(data.raw_key).digest('hex'));});
