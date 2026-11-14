/** @jest-environment node */
import { NextRequest,NextResponse } from 'next/server';
import { GET } from '../route';
import { requirePlatformAdmin } from '@/lib/platform-admin';
import { createServiceRoleClient } from '@/lib/supabase-server';
jest.mock('@/lib/with-route',()=>({withRoute:(handler:(request:Request)=>Promise<Response>)=>handler}));
jest.mock('@/lib/platform-admin',()=>({requirePlatformAdmin:jest.fn()}));
jest.mock('@/lib/supabase-server',()=>({createServiceRoleClient:jest.fn()}));

const fid='11111111-1111-4111-8111-111111111111',did='22222222-2222-4222-8222-222222222222';
const time='2026-10-30T01:00:00+00:00',path=`facilities/${fid}/${did}.pdf`;
const row={id:did,facility_id:fid,object_path:path,created_at:time,mime_type:'application/pdf',byte_size:10};
const identity={name:'検証店舗',prefecture:'大阪府',city:'豊中市',address:'検証住所'};
const request=(q='')=>new NextRequest(`https://example.test/api/admin/listing-verification/pending${q}`);
const item={bucketId:'listing-verification',name:path,size:10,contentType:'application/pdf'};
function setup(options:{ docs?:unknown; profiles?:unknown; approvals?:unknown; info?:unknown; error?:boolean; profileError?:boolean; approvalError?:boolean }={}) {
  const docs=options.docs ?? [row], profiles=options.profiles ?? [{id:fid,...identity}], approvals=options.approvals ?? [];
  const limit=jest.fn().mockResolvedValue({data:docs,error:options.error?{}:null});
  const chain={select:jest.fn().mockReturnThis(),order:jest.fn().mockReturnThis(),limit:jest.fn().mockReturnThis(),
    or:jest.fn().mockReturnThis(),then:(resolve:(x:unknown)=>void)=>limit().then(resolve)};
  const from=(table:string)=>table==='listing_verification_documents' ? chain : {select:()=>({in:async()=>({data:table==='facility_profiles'?profiles:approvals,error:table==='facility_profiles'?options.profileError:options.approvalError})})};
  const info=jest.fn().mockResolvedValue(options.info ?? {data:item,error:null});
  jest.mocked(createServiceRoleClient).mockReturnValue({from,storage:{from:()=>({info})}} as never);
  return {chain,info};
}
beforeEach(()=>{jest.clearAllMocks();jest.mocked(requirePlatformAdmin).mockResolvedValue({id:fid} as never);});
test('運営以外を拒否し、カーソルを検証する',async()=>{
  jest.mocked(requirePlatformAdmin).mockResolvedValueOnce(null).mockResolvedValueOnce(NextResponse.json({}, {status:503}));
  expect((await GET(request())).status).toBe(403);
  expect((await GET(request())).status).toBe(503);
  expect((await GET(request('?time=invalid&id=bad'))).status).toBe(400);
  expect(createServiceRoleClient).not.toHaveBeenCalled();
});
test('保存された未確認書類のみを運営に示す',async()=>{
  const {info}=setup(); const response=await GET(request());
  expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect((await response.json()).facilities).toEqual([{id:fid,name:'検証店舗',prefecture:'大阪府',city:'豊中市',createdAt:time}]);
  expect(info).toHaveBeenCalledWith(path);
});
test('アップロード前の準備記録と確認済み書類は表示しない',async()=>{
  setup({info:{data:null,error:{name:'StorageApiError',message:'Object not found',status:404,statusCode:'404'}}});
  expect((await (await GET(request())).json()).facilities).toEqual([]);
  setup({approvals:[{facility_id:fid,facility_identity:identity,document_ids:[did]}]});
  expect((await (await GET(request())).json()).facilities).toEqual([]);
});
test('店舗情報が変わった確認記録は再確認対象にする',async()=>{
  setup({approvals:[{facility_id:fid,facility_identity:{...identity,address:'以前の住所'},document_ids:[did]}]});
  expect((await (await GET(request())).json()).facilities).toHaveLength(1);
});
test('取得障害や不整合は空一覧とせずエラーにする',async()=>{
  setup({error:true});expect((await GET(request())).status).toBe(503);
  setup({profileError:true});expect((await GET(request())).status).toBe(503);
  setup({approvalError:true});expect((await GET(request())).status).toBe(503);
  setup({profiles:[]});expect((await GET(request())).status).toBe(503);
  setup({info:{data:null,error:{message:'unavailable'}}});expect((await GET(request())).status).toBe(503);
  setup({info:{data:{...item,size:11},error:null}});expect((await GET(request())).status).toBe(503);
});
test('店舗名のない記録も確認対象から除外しない',async()=>{
  setup({profiles:[{id:fid,...identity,name:null}]});
  expect((await (await GET(request())).json()).facilities[0].name).toBe('');
});
test('20件単位で読み、次ページのカーソルを使う',async()=>{
  const rows=Array.from({length:21},(_,i)=>({...row,id:`${String(i+1).padStart(8,'0')}-2222-4222-8222-222222222222`}));
  const {chain}=setup({docs:rows});
  const result=await (await GET(request())).json();
  expect(result.next).toEqual({time,id:rows[19].id});
  await GET(request(`?time=${encodeURIComponent(time)}&id=${did}`));
  expect(chain.or).toHaveBeenCalled();
  setup({docs:[]}); expect((await (await GET(request())).json()).next).toBeNull();
});
