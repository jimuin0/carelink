/** @jest-environment node */
jest.mock('@/lib/supabase-server-auth');jest.mock('@/lib/supabase-server');
jest.mock('@/lib/rate-limit',()=>({checkRateLimit:jest.fn(()=>false)}));jest.mock('@/lib/csrf',()=>({checkCsrf:jest.fn(()=>null)}));
jest.mock('@/lib/audit-logger',()=>({writeAuditLog:jest.fn(),getRequestContext:()=>({})}));
jest.mock('@/lib/safe',()=>({safeCaptureException:jest.fn()}));jest.mock('@/lib/alert',()=>({alertCaughtError:jest.fn()}));
jest.mock('@/lib/gbp',()=>({fetchPlaceDetails:jest.fn(),calculateGbpScore:()=>({score:80,items:[]})}));
jest.mock('dns',()=>({promises:{resolveTxt:jest.fn()}}));
import { NextRequest } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';import { createServiceRoleClient } from '@/lib/supabase-server';
import { GET as refresh,POST as connect } from '../gbp/place/route';import {POST as configure} from '../white-label/route';import {POST as verify} from '../white-label/verify/route';
import {fetchPlaceDetails} from '@/lib/gbp';import {promises as dns} from 'dns';
const actor='fa800000-0000-4000-8000-000000000001',facility='fa800001-0000-4000-8000-000000000001';
const rpc=jest.fn(),direct=jest.fn();const config={id:actor,facility_id:facility,domain:'old.example.invalid',txt_record:'carelink-verify='+ 'a'.repeat(32)};
function request(body:unknown={}){return new NextRequest('http://localhost/api/admin/test',{method:'POST',body:JSON.stringify(body)});}
function run(kind:string){if(kind==='gbp:refresh')return refresh(new NextRequest('http://localhost/api/admin/gbp/place'));if(kind==='gbp:connect')return connect(request({gbp_place_id:'NewPlace'}));if(kind==='domain:configure')return configure(request({domain:'new.example.invalid'}));return verify(request());}
beforeEach(()=>{jest.clearAllMocks();const membership={select:jest.fn().mockReturnThis(),eq:jest.fn().mockReturnThis(),in:jest.fn().mockResolvedValue({data:[{facility_id:facility}],error:null})};const read={select:jest.fn().mockReturnThis(),eq:jest.fn().mockReturnThis(),single:jest.fn().mockResolvedValue({data:{gbp_place_id:'OldPlace',name:'Synthetic'},error:null}),maybeSingle:jest.fn().mockResolvedValue({data:{gbp_place_id:'OldPlace',name:'Synthetic'},error:null})};
const row={select:jest.fn().mockReturnThis(),eq:jest.fn().mockReturnThis(),single:jest.fn().mockResolvedValue({data:config,error:null}),maybeSingle:jest.fn().mockResolvedValue({data:config,error:null})};
(createServerSupabaseAuthClient as jest.Mock).mockResolvedValue({auth:{getUser:jest.fn().mockResolvedValue({data:{user:{id:actor}},error:null})},from:(table:string)=>table==='facility_members'?membership:table==='gbp_audit_cache'?{upsert:direct}:read});
const writes={select:()=>Object.assign(Promise.resolve({data:[{facility_id:facility}],error:null}),{single:async()=>({data:config,error:null}),maybeSingle:async()=>({data:{id:facility},error:null})}),eq:()=>writes,then:(r:(v:unknown)=>unknown)=>Promise.resolve({data:[{id:facility}],error:null}).then(r)};direct.mockReturnValue(writes);
(createServiceRoleClient as jest.Mock).mockReturnValue({rpc,from:(table:string)=>table==='facility_members'?membership:{...row,update:direct,upsert:direct}});
(fetchPlaceDetails as jest.Mock).mockResolvedValue({rating:5,user_ratings_total:30});(dns.resolveTxt as jest.Mock).mockResolvedValue([[config.txt_record]]);rpc.mockResolvedValue({data:{id:facility,facility_id:facility},error:{code:'42501'}});});
test.each(['gbp:connect','gbp:refresh','domain:configure','domain:verify'])('%s rechecks revoked authority after precheck',async kind=>{const res=await run(kind);expect(res.status).toBe(403);expect(direct).not.toHaveBeenCalled();expect(require('@/lib/audit-logger').writeAuditLog).not.toHaveBeenCalled();});
test('old Google response cannot overwrite a changed place',async()=>{rpc.mockResolvedValue({data:null,error:{code:'40001'}});expect((await run('gbp:refresh')).status).toBe(409);expect(rpc).toHaveBeenCalledWith('save_admin_facility_integration_atomic',expect.objectContaining({p_expected:{place_id:'OldPlace'}}));});
test('domain replacement invalidates stale DNS result',async()=>{rpc.mockResolvedValue({data:null,error:{code:'40001'}});const res=await run('domain:verify');expect(await res.json()).toEqual({verified:false,reason:'Domain configuration changed during verification'});expect(require('@/lib/audit-logger').writeAuditLog).not.toHaveBeenCalled();});
test.each(['gbp:connect','domain:configure','domain:verify'])('%s rejects null JSON',async kind=>{const fn=kind==='gbp:connect'?connect:kind==='domain:configure'?configure:verify;expect((await fn(request(null))).status).toBe(400);});

test.each(['gbp:connect','domain:configure','domain:verify'])('%s malformed JSON stops before any mutation',async kind=>{const fn=kind==='gbp:connect'?connect:kind==='domain:configure'?configure:verify;const res=await fn(new NextRequest('http://localhost/api/admin/test',{method:'POST',body:'not-json'}));expect(res.status).toBe(400);expect(direct).not.toHaveBeenCalled();expect(rpc).not.toHaveBeenCalled();});
