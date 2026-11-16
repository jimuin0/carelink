/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
jest.mock('@/lib/line-support-readiness',()=>({lineSupportReadiness:jest.fn(()=>({configured:false,missing:['drafts']}))}));
jest.mock('@/lib/with-route',()=>({withRoute:jest.fn(handler=>handler),authUnavailable:jest.fn(()=>new Response('{}',{status:503})),serverError:jest.fn(()=>new Response('{}',{status:500}))}));
jest.mock('@/lib/line-support-store',()=>({lineSupportRpc:jest.fn(),supportOperationSchema:{}}));
jest.mock('@/lib/line-support-processor',()=>({processLineSupportPending:jest.fn()}));
jest.mock('@/lib/audit-logger',()=>({writeAuditLog:jest.fn()}));
import { lineSupportReadiness } from '../line-support-readiness';
import { GET,POST } from '@/app/api/admin/line-support/route';
import { lineSupportRpc } from '@/lib/line-support-store';
import { processLineSupportPending } from '@/lib/line-support-processor';
import { writeAuditLog } from '@/lib/audit-logger';
import type { RouteContext } from '@/lib/with-route';
const id='10000000-0000-4000-8000-000000000001';const rpc=lineSupportRpc as jest.Mock;
let maybeSingle:jest.Mock;
let ctx:RouteContext;
function request(body:unknown,path=''){return new Request('https://example.test/api/admin/line-support'+path,{method:'POST',body:JSON.stringify(body)});}
const callGet=(path='')=>(GET as unknown as (request:Request,ctx:RouteContext)=>Promise<Response>)(new Request('https://example.test/api/admin/line-support'+path),ctx);
const callPost=(body:unknown)=>(POST as unknown as (request:Request,ctx:RouteContext)=>Promise<Response>)(request(body),ctx);
beforeEach(()=>{jest.clearAllMocks();(lineSupportReadiness as jest.Mock).mockReset().mockReturnValue({configured:false,missing:['drafts']});rpc.mockReset().mockResolvedValue({status:'saved'});maybeSingle=jest.fn().mockResolvedValue({data:{is_platform_admin:true},error:null});
 const query={select:jest.fn().mockReturnThis(),eq:jest.fn().mockReturnThis(),abortSignal:jest.fn().mockReturnThis(),maybeSingle};
 ctx={user:{id},supabase:{from:jest.fn(()=>query)}} as unknown as RouteContext;
});
test.each([false,null])('non-admin profile %s cannot read or mutate support',async allowed=>{maybeSingle.mockResolvedValue({data:allowed===null?null:{is_platform_admin:allowed},error:null});expect((await callGet()).status).toBe(403);expect((await callPost({action:'unbind'})).status).toBe(403);expect(rpc).not.toHaveBeenCalled();});
test('unavailable permissions never become permission granted',async()=>{maybeSingle.mockResolvedValue({data:null,error:{message:'private'}});expect((await callGet()).status).toBe(503);expect(rpc).not.toHaveBeenCalled();});
test.each(['?other=1','?id=bad','?id='+id+'&id='+id])('rejects invalid detail filters %s before storage',async path=>{expect((await callGet(path)).status).toBe(400);expect(rpc).not.toHaveBeenCalled();});
test('list and detail reads carry the authenticated actor to the DB authorization',async()=>{expect((await callGet()).status).toBe(200);expect(rpc.mock.calls[0][1]).toEqual({p_actor_id:id});await callGet('?id='+id);expect(rpc.mock.calls[1][1]).toEqual({p_actor_id:id,p_conversation_id:id});});
test.each([{},null,{action:'pair_confirm',recipient:'Uwrong'},{action:'mode',conversationId:id,revision:-1,mode:'automatic'}])('rejects malformed commands %j',async command=>{expect((await callPost(command)).status).toBe(400);expect(rpc).not.toHaveBeenCalled();});
test('pair start returns a one-time code but saves and audits no plaintext code',async()=>{
 const response=await callPost({action:'pair_start'});const body=await response.json();expect(body.pairingText).toMatch(/^CareLink連携 [A-Za-z0-9_-]{32}$/);expect(body.expiresInSeconds).toBe(600);
 expect(rpc.mock.calls[0][1].p_values.hash).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify(rpc.mock.calls)).not.toContain(body.pairingText.split(' ')[1]);expect(JSON.stringify((writeAuditLog as jest.Mock).mock.calls)).not.toContain(body.pairingText.split(' ')[1]);expect(response.headers.get('cache-control')).toBe('no-store');
});
test.each([{action:'rollout',mode:'observe'},{action:'mode',conversationId:id,revision:2,mode:'human'},{action:'unbind'},{action:'pair_confirm'}])('validated operation %j is scoped to current actor',async command=>{expect((await callPost(command)).status).toBe(200);expect(rpc.mock.calls[0][1]).toMatchObject({p_actor_id:id,p_action:command.action});});
test('recovery reports partial failure without pretending all drafts succeeded',async()=>{(processLineSupportPending as jest.Mock).mockResolvedValueOnce({processed:1,failed:1});const response=await callPost({action:'recover'});expect(await response.json()).toEqual({processed:1,failed:1});expect(rpc).not.toHaveBeenCalled();});
test.each([['42501',403],['PT409',409],['23505',409],['P0002',404],['22023',400],['22P02',400],['other',500]])('database failure %s maps to HTTP %s without raw details',async(code,status)=>{rpc.mockRejectedValueOnce({code,message:'private content'});const response=await callPost({action:'unbind'});expect(response.status).toBe(status);expect(await response.text()).not.toContain('private content');});
test('read failure is also classified without leaking database details',async()=>{rpc.mockRejectedValueOnce({code:'42501'});expect((await callGet()).status).toBe(403);});
test('unclassified null database errors fail closed',async()=>{rpc.mockRejectedValueOnce(null);expect((await callGet()).status).toBe(500);});
test('invalid JSON cannot invoke a command',async()=>{const malformed=new Request('https://example.test/api/admin/line-support',{method:'POST',body:'{'});expect((await (POST as unknown as (r:Request,c:RouteContext)=>Promise<Response>)(malformed,ctx)).status).toBe(400);expect(rpc).not.toHaveBeenCalled();});
test('live activation is refused before storage when required runtime configuration is absent',async()=>{
 const response=await callPost({action:'rollout',mode:'live'});
 expect(response.status).toBe(503);expect(rpc).not.toHaveBeenCalled();expect(writeAuditLog).not.toHaveBeenCalled();
});

test('configured runtime still delegates activation to fresh DB recipient/role authorization',async()=>{
 (lineSupportReadiness as jest.Mock).mockReturnValue({configured:true,missing:[]});const response=await callPost({action:'rollout',mode:'live'});expect(response.status).toBe(200);expect(rpc).toHaveBeenCalledWith('manage_line_support',expect.objectContaining({p_actor_id:id,p_action:'rollout',p_values:{mode:'live'}}),expect.anything());
});
test('authenticated list exposes safe configuration categories without modifying settings',async()=>{
 rpc.mockResolvedValueOnce({settings:{rollout:'observe'},conversations:[]});const response=await callGet();expect((await response.json()).readiness).toEqual({configured:false,missing:['drafts']});expect(writeAuditLog).not.toHaveBeenCalled();
});
