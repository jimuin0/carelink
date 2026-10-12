/** @jest-environment node */
jest.mock('@/lib/cron-auth',()=>({checkCronAuth:jest.fn(()=>null)}));
jest.mock('@/lib/cron-logger',()=>({logCronRun:jest.fn(async()=>undefined),cronError:jest.fn(async()=>new Response('{}',{status:500}))}));
jest.mock('@/lib/alert',()=>({alertWarning:jest.fn()}));
const rpc=jest.fn(),select=jest.fn(),directUpdate=jest.fn();
jest.mock('@supabase/supabase-js',()=>({createClient:()=>({rpc:(...args:unknown[])=>rpc(...args),from:()=>({select:(...args:unknown[])=>select(...args),update:directUpdate})})}));
import {GET} from '../route';
import {checkCronAuth} from '@/lib/cron-auth';
import {logCronRun} from '@/lib/cron-logger';
const fid='11111111-1111-4111-8111-111111111111';
const id=(n:number)=>`22222222-2222-4222-8222-${String(n).padStart(12,'0')}`;
const reviews=[1,2,3].map(n=>({id:id(n),facility_id:fid,reviewer_ip:'192.0.2.1'}));
let bulk:unknown[]=reviews,duplicate:unknown[]=[],bulkError:unknown=null,duplicateError:unknown=null;
const request=()=>new Request('https://example.invalid/api/cron/flag-reviews');
beforeEach(()=>{
 jest.clearAllMocks();rpc.mockReset();select.mockReset();(checkCronAuth as jest.Mock).mockReturnValue(null);
 bulk=reviews;duplicate=[];bulkError=null;duplicateError=null;
 rpc.mockImplementation((name:string,args:{p_items?:typeof reviews})=>name==='find_bulk_review_ips'
  ?Promise.resolve({data:[{reviewer_ip:'192.0.2.1'}],error:null})
  :Promise.resolve({data:args.p_items!.map(row=>({id:row.id})),error:null}));
 select.mockImplementation(()=>{
  const query:any={};for(const method of ['eq','gte','not','order'])query[method]=jest.fn(()=>query);
  query.eq.mockImplementation(()=>query);query.not.mockImplementation(()=>{query.duplicate=true;return query;});
  query.range=jest.fn((offset:number,through:number)=>Promise.resolve({data:(query.duplicate?duplicate:bulk).slice(offset,through+1),error:query.duplicate?duplicateError:bulkError}));
  return query;
 });
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic';
});
test('Cron authentication stops before any database access',async()=>{
 const response=new Response('{}',{status:401});(checkCronAuth as jest.Mock).mockReturnValue(response);
 expect(await GET(request())).toBe(response);expect(rpc).not.toHaveBeenCalled();
});
test('bulk candidates use one atomic flag/queue RPC and count confirmed rows only',async()=>{
 const response=await GET(request());expect(response.status).toBe(200);expect(await response.json()).toEqual({processed:3,skipped:0});
 expect(rpc).toHaveBeenCalledWith('find_bulk_review_ips',{p_since:expect.any(String),p_threshold:3});
 expect(rpc).toHaveBeenCalledWith('flag_review_group_atomic',{p_items:reviews,p_flag_type:'bulk_submission'});
 expect(directUpdate).not.toHaveBeenCalled();
});
test('already reviewed or concurrently removed candidates return a smaller authoritative count',async()=>{
 rpc.mockImplementation((name:string)=>Promise.resolve({data:name==='find_bulk_review_ips'?[{reviewer_ip:'192.0.2.1'}]:[{id:id(2)}],error:null}));
 expect(await (await GET(request())).json()).toEqual({processed:1,skipped:0});
});
test.each([null,[]])('no bulk IPs %j is a successful empty run',async data=>{
 rpc.mockResolvedValue({data,error:null});bulk=[];expect(await(await GET(request())).json()).toEqual({processed:0,skipped:0});
});
test('no candidate rows do not dispatch a flag mutation',async()=>{
 bulk=[];expect((await GET(request())).status).toBe(200);expect(rpc.mock.calls.filter(([name])=>name==='flag_review_group_atomic')).toEqual([]);
});
test('duplicate-facility groups preserve IPv6 and actual facility selectors',async()=>{
 bulk=[];duplicate=reviews.slice(0,2).map(row=>({...row,reviewer_ip:'2001:db8::1'}));
 expect(await(await GET(request())).json()).toEqual({processed:2,skipped:0});
 expect(rpc).toHaveBeenCalledWith('flag_review_group_atomic',{p_items:reviews.slice(0,2).map(row=>({id:row.id,facility_id:fid})),p_flag_type:'duplicate_facility'});
});
test('one per IP/facility is not a duplicate',async()=>{
 bulk=[];duplicate=[reviews[0],{...reviews[1],facility_id:id(9)}];
 expect(await(await GET(request())).json()).toEqual({processed:0,skipped:0});
});
test('bulk and duplicate paging retain candidates beyond 1000 rows',async()=>{
 bulk=Array.from({length:1255},(_,n)=>({id:id(n+1),facility_id:fid}));
 expect(await(await GET(request())).json()).toEqual({processed:1255,skipped:0});
 expect(rpc.mock.calls.find(([name])=>name==='flag_review_group_atomic')![1].p_items).toHaveLength(1255);
});
test.each(['bulk','duplicate'])('%s read failure is never reported as an empty successful run',async phase=>{
 bulk=[];if(phase==='bulk')bulkError={message:'read unavailable'};else duplicateError={message:'read unavailable'};
 expect((await GET(request())).status).toBe(500);expect(logCronRun).not.toHaveBeenCalled();
 expect(rpc.mock.calls.some(([name])=>name==='flag_review_group_atomic')).toBe(false);
});
test('IP detection read error does not continue with partial success',async()=>{
 rpc.mockResolvedValue({data:[{reviewer_ip:'192.0.2.1'}],error:{message:'permission denied',code:'42501'}});
 expect((await GET(request())).status).toBe(500);expect(select).not.toHaveBeenCalled();expect(logCronRun).not.toHaveBeenCalled();
});
test.each([null,{},[{id:'bad'}],[{id:id(8)}],[{id:id(1)},{id:id(1)}],[null],[{id:1}]])('unconfirmed result %j cannot inflate the processed count',async data=>{
 rpc.mockImplementation((name:string)=>Promise.resolve({data:name==='find_bulk_review_ips'?[{reviewer_ip:'192.0.2.1'}]:data,error:null}));
 expect((await GET(request())).status).toBe(500);expect(logCronRun).not.toHaveBeenCalled();
});
test('result plus error is failure even if all returned IDs match',async()=>{
 rpc.mockImplementation((name:string)=>Promise.resolve(name==='find_bulk_review_ips'?{data:[{reviewer_ip:'192.0.2.1'}],error:null}:{data:reviews,error:{message:'flag transaction unavailable'}}));
 expect((await GET(request())).status).toBe(500);expect(logCronRun).not.toHaveBeenCalled();
});
test('flag RPC transport rejection is visible and never followed by direct updates',async()=>{
 rpc.mockImplementation((name:string)=>name==='find_bulk_review_ips'?Promise.resolve({data:[{reviewer_ip:'192.0.2.1'}],error:null}):Promise.reject(new Error('lost transaction reply')));
 expect((await GET(request())).status).toBe(500);expect(directUpdate).not.toHaveBeenCalled();expect(logCronRun).not.toHaveBeenCalled();
});
