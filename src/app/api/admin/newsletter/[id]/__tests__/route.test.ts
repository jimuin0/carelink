/** @jest-environment node */
jest.mock('@/lib/csrf',()=>({checkCsrf:jest.fn(()=>null)}));
jest.mock('@/lib/rate-limit',()=>({checkRateLimit:jest.fn(()=>false)}));
jest.mock('@/lib/platform-admin',()=>({requirePlatformAdmin:jest.fn(()=>({id:'e1000000-0000-4000-8000-000000000002'}))}));
jest.mock('@/lib/audit-logger',()=>({writeAuditLog:jest.fn(),getRequestContext:()=>({})}));
const mockFrom=jest.fn();jest.mock('@/lib/supabase-server',()=>({createServiceRoleClient:()=>({from:mockFrom})}));
jest.mock('@/lib/newsletter-send',()=>{const actual=jest.requireActual('@/lib/newsletter-send');return {...actual,inspectNewsletterOperation:jest.fn(),publishNewsletterOperation:jest.fn()};});
import {PATCH} from '../route';import {NextRequest} from 'next/server';import {checkCsrf} from '@/lib/csrf';import {checkRateLimit} from '@/lib/rate-limit';import {requirePlatformAdmin} from '@/lib/platform-admin';import {inspectNewsletterOperation,publishNewsletterOperation,NewsletterSendError} from '@/lib/newsletter-send';
const id='e1000000-0000-4000-8000-000000000001';const revision='2026-10-09T00:00:00Z';const campaign={id,status:'draft',campaign_type:'user_digest',updated_at:revision};
function chain(data:unknown,error:unknown=null){const c:Record<string,unknown>={};for(const m of ['select','eq','update'])c[m]=jest.fn(()=>c);c.single=jest.fn().mockResolvedValue({data,error});c.then=(resolve:(x:unknown)=>unknown)=>Promise.resolve({data,error}).then(resolve);return c;}
const req=(body:unknown)=>new NextRequest(`http://localhost/api/admin/newsletter/${id}`,{method:'PATCH',body:JSON.stringify(body),headers:{'Content-Type':'application/json'}});
const props={params:Promise.resolve({id})};
beforeEach(()=>{jest.clearAllMocks();(checkCsrf as jest.Mock).mockReturnValue(null);(checkRateLimit as jest.Mock).mockReturnValue(false);(requirePlatformAdmin as jest.Mock).mockResolvedValue({id});mockFrom.mockReturnValue(chain(campaign));(inspectNewsletterOperation as jest.Mock).mockResolvedValue(null);(publishNewsletterOperation as jest.Mock).mockResolvedValue({operation_id:id});});
test('csrf guard',async()=>{(checkCsrf as jest.Mock).mockReturnValue(new Response('',{status:403}));expect((await PATCH(req({action:'send'}),props)).status).toBe(403);expect(mockFrom).not.toHaveBeenCalled();});
test('rate guard',async()=>{(checkRateLimit as jest.Mock).mockResolvedValue(true);expect((await PATCH(req({}),props)).status).toBe(429);});
test('UUID guard',async()=>{expect((await PATCH(req({}),{params:Promise.resolve({id:'bad'})})).status).toBe(400);});
test('fresh platform guard',async()=>{(requirePlatformAdmin as jest.Mock).mockResolvedValue(null);expect((await PATCH(req({}),props)).status).toBe(403);});
test.each([{data:null,error:null},{data:null,error:{code:'PGRST116'}}])('definite absent =>404 %p',async r=>{mockFrom.mockReturnValue(chain(r.data,r.error));expect((await PATCH(req({}),props)).status).toBe(404);});
test('campaign data plus error never continues',async()=>{mockFrom.mockReturnValue(chain(campaign,{code:'08006'}));expect((await PATCH(req({action:'send'}),props)).status).toBe(500);expect(inspectNewsletterOperation).not.toHaveBeenCalled();});
test.each(['cancel','schedule'])('%s CAS empty returns conflict',async action=>{mockFrom.mockReturnValueOnce(chain({...campaign,status:action==='cancel'?'scheduled':'draft'})).mockReturnValueOnce(chain([]));expect((await PATCH(req({action}),props)).status).toBe(409);});
test.each(['cancel','schedule'])('%s guard',async action=>{mockFrom.mockReturnValue(chain({...campaign,status:'sent'}));expect((await PATCH(req({action}),props)).status).toBe(400);});
test.each(['cancel','schedule'])('%s success exactly one campaign',async action=>{const next={...campaign,status:action==='cancel'?'cancelled':'scheduled'};mockFrom.mockReturnValueOnce(chain({...campaign,status:action==='cancel'?'scheduled':'draft'})).mockReturnValueOnce(chain([next]));expect((await (await PATCH(req({action}),props)).json()).campaign).toEqual(next);});
test('unknown action',async()=>{expect((await PATCH(req({action:'bad'}),props)).status).toBe(400);});
test('new send passes original observed revision and returns queue receipt',async()=>{const res=await PATCH(req({action:'send',expected_updated_at:revision}),props);expect(res.status).toBe(200);expect(publishNewsletterOperation).toHaveBeenCalledWith(expect.anything(),id,campaign,revision);expect((await res.json()).message).toContain('送信キュー');});
test('response loss retry retains same operation even campaign now sending',async()=>{mockFrom.mockReturnValue(chain({...campaign,status:'sending'}));(inspectNewsletterOperation as jest.Mock).mockResolvedValue({operation_id:id});expect((await PATCH(req({action:'send',expected_updated_at:'old'}),props)).status).toBe(200);expect(publishNewsletterOperation).not.toHaveBeenCalled();});
test('inspect missing operation never creates one',async()=>{const json=await (await PATCH(req({action:'inspect'}),props)).json();expect(json.receipt).toBeNull();expect(publishNewsletterOperation).not.toHaveBeenCalled();});
test('SQL first not ready stops before provider or any fallback',async()=>{(inspectNewsletterOperation as jest.Mock).mockRejectedValue(new NewsletterSendError(503,'unavailable'));expect((await PATCH(req({action:'send'}),props)).status).toBe(503);expect(publishNewsletterOperation).not.toHaveBeenCalled();});
test('publication response unknown never resets draft',async()=>{(publishNewsletterOperation as jest.Mock).mockRejectedValue(new Error('network'));expect((await PATCH(req({action:'send',expected_updated_at:revision}),props)).status).toBe(500);expect(mockFrom).toHaveBeenCalledTimes(1);});
test('receipt exists but readback unavailable is visibly unknown',async()=>{mockFrom.mockReturnValueOnce(chain(campaign)).mockReturnValueOnce(chain(campaign,{message:'readback'}));expect((await PATCH(req({action:'send',expected_updated_at:revision}),props)).status).toBe(503);});

test('legacy sending without operation remains held, never republished',async()=>{mockFrom.mockReturnValue(chain({...campaign,status:'sending'}));expect((await PATCH(req({action:'send',expected_updated_at:revision}),props)).status).toBe(409);expect(publishNewsletterOperation).not.toHaveBeenCalled();});

test.each(['cancel','schedule'])('%s data plus SDK error cannot report a successful state transition',async action=>{
 const original={...campaign,status:action==='cancel'?'scheduled':'draft'};
 mockFrom.mockReturnValueOnce(chain(original)).mockReturnValueOnce(chain([{...original,status:action==='cancel'?'cancelled':'scheduled'}],{code:'08006'}));
 const res=await PATCH(req({action}),props);expect(res.status).toBe(500);expect((await res.json()).campaign).toBeUndefined();
 expect(publishNewsletterOperation).not.toHaveBeenCalled();
});
