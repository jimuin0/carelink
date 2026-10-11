/** @jest-environment node */
jest.mock('@/lib/cron-auth',()=>({checkCronAuth:jest.fn(()=>null)}));
jest.mock('@/lib/cron-logger',()=>({logCronRun:jest.fn(),cronError:jest.fn(async(_job,_start,_cause,opts)=>new Response(JSON.stringify(opts?.extraBody??{}),{status:500}))}));
jest.mock('@/lib/platform-blog-threads',()=>({publishArticleToThreads:jest.fn(),reconcileArticleThreads:jest.fn()}));
jest.mock('@/lib/alert',()=>({alertDeliveryFailures:jest.fn()}));
const mockFrom=jest.fn();jest.mock('@/lib/supabase-server',()=>({createServiceRoleClient:()=>({from:mockFrom})}));
import { GET } from '../route';
import { checkCronAuth } from '@/lib/cron-auth';
import { cronError,logCronRun } from '@/lib/cron-logger';
import { publishArticleToThreads,reconcileArticleThreads } from '@/lib/platform-blog-threads';
const post={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',title:'Title',slug:'slug'};
function chain(result:unknown){
 const c:Record<string,unknown>={};for(const method of ['select','eq','is','or','order','limit'])c[method]=jest.fn(()=>c);
 c.then=(resolve:(value:unknown)=>unknown,reject:(error:unknown)=>unknown)=>Promise.resolve(result).then(resolve,reject);return c;
}
function setup({heldCount=0,held=[] as unknown[],candidates=[] as unknown[],eligible=candidates.length}={}){
 const chains=[chain({count:heldCount,error:null}),chain({data:held,error:null}),chain({count:eligible,error:null}),chain({data:candidates,error:null})];
 chains.forEach(c=>mockFrom.mockReturnValueOnce(c));return chains;
}
beforeEach(()=>{jest.clearAllMocks();mockFrom.mockReset();(checkCronAuth as jest.Mock).mockReturnValue(null);(publishArticleToThreads as jest.Mock).mockResolvedValue('published');(reconcileArticleThreads as jest.Mock).mockResolvedValue(false);});
test('Cron auth failure prevents all data/provider work',async()=>{
 (checkCronAuth as jest.Mock).mockReturnValue(new Response('{}',{status:401}));expect((await GET(new Request('http://localhost'))).status).toBe(401);expect(mockFrom).not.toHaveBeenCalled();
});
test('empty candidates with no held sends is skipped and uses no destructive stale reset',async()=>{
 const cs=setup();expect((await GET(new Request('http://localhost'))).status).toBe(200);expect(publishArticleToThreads).not.toHaveBeenCalled();
 expect(cs[2].is).toHaveBeenCalledWith('threads_delivery_started_at',null);expect(cs[2].or).toHaveBeenCalledWith(expect.stringContaining('threads_post_status.in.(claimed,permanent)'));
 expect(logCronRun).toHaveBeenCalledWith('threads-backfill','skipped',expect.any(Date),expect.any(Object));
});
test('legacy unknown send cannot disappear as a normal zero-candidate run',async()=>{
 setup({heldCount:1,held:[{id:post.id,threads_delivery_attempt_id:null,threads_creation_id:null}]});
 expect((await GET(new Request('http://localhost'))).status).toBe(500);expect(publishArticleToThreads).not.toHaveBeenCalled();expect(cronError).toHaveBeenCalledWith('threads-backfill',expect.any(Date),expect.any(Error),expect.objectContaining({extraBody:expect.objectContaining({uncertain:1})}));
});
test('read-only published reconciliation closes uncertainty without sending another post',async()=>{
 setup({heldCount:1,held:[{id:post.id,threads_delivery_attempt_id:'attempt',threads_creation_id:'123'}]});(reconcileArticleThreads as jest.Mock).mockResolvedValue(true);
 const res=await GET(new Request('http://localhost'));expect(res.status).toBe(200);expect(await res.json()).toEqual(expect.objectContaining({reconciled:1,processed:0}));expect(publishArticleToThreads).not.toHaveBeenCalled();
});
test.each(['ambiguous','unavailable','transient','permanent'])('candidate outcome %s never counts as successful run',async state=>{
 setup({candidates:[post]});(publishArticleToThreads as jest.Mock).mockResolvedValue(state);expect((await GET(new Request('http://localhost'))).status).toBe(500);expect(logCronRun).not.toHaveBeenCalled();
});
test('only verified publications count, with visible per-run truncation',async()=>{
 setup({candidates:[post],eligible:9});const res=await GET(new Request('http://localhost'));expect(res.status).toBe(200);expect(await res.json()).toEqual(expect.objectContaining({processed:1,truncated:true}));
});
test.each([{count:null,error:null},{count:0,error:{message:'partial'}}])('held count unknown/partial data fails before provider work',async value=>{
 mockFrom.mockReturnValue(chain(value));expect((await GET(new Request('http://localhost'))).status).toBe(500);expect(publishArticleToThreads).not.toHaveBeenCalled();expect(reconcileArticleThreads).not.toHaveBeenCalled();
});
test('unavailable candidate list fails before publication',async()=>{
 mockFrom.mockReturnValueOnce(chain({count:0,error:null})).mockReturnValueOnce(chain({data:[],error:null})).mockReturnValueOnce(chain({count:1,error:null})).mockReturnValueOnce(chain({data:null,error:null}));
 expect((await GET(new Request('http://localhost'))).status).toBe(500);expect(publishArticleToThreads).not.toHaveBeenCalled();
});

test('held post read with partial data and error never starts provider reconciliation or publication',async()=>{
 mockFrom.mockReturnValueOnce(chain({count:1,error:null})).mockReturnValueOnce(chain({data:[post],error:{message:'dependency'}}));
 expect((await GET(new Request('http://localhost'))).status).toBe(500);expect(reconcileArticleThreads).not.toHaveBeenCalled();expect(publishArticleToThreads).not.toHaveBeenCalled();
});
test('unconfirmed eligible count stops before reading or publishing candidates',async()=>{
 mockFrom.mockReturnValueOnce(chain({count:0,error:null})).mockReturnValueOnce(chain({data:[],error:null})).mockReturnValueOnce(chain({count:null,error:null}));
 expect((await GET(new Request('http://localhost'))).status).toBe(500);expect(mockFrom).toHaveBeenCalledTimes(3);expect(publishArticleToThreads).not.toHaveBeenCalled();
});
test('missing publication configuration stops the batch after its first skipped attempt',async()=>{
 setup({candidates:[post,{...post,id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}]});(publishArticleToThreads as jest.Mock).mockResolvedValue('skipped');
 const res=await GET(new Request('http://localhost'));expect(res.status).toBe(200);expect((await res.json()).skipped).toBe(1);expect(publishArticleToThreads).toHaveBeenCalledTimes(1);
 expect(logCronRun).toHaveBeenCalledWith('threads-backfill','skipped',expect.any(Date),expect.any(Object));
});
