/** @jest-environment node */
import { NextRequest,NextResponse } from 'next/server';
import { GET } from '../route';
import { requirePlatformAdmin } from '@/lib/platform-admin';
import { createServiceRoleClient } from '@/lib/supabase-server';
jest.mock('@/lib/with-route',()=>({ withRoute:(handler:(request:Request)=>Promise<Response>)=>handler }));
jest.mock('@/lib/platform-admin',()=>({ requirePlatformAdmin:jest.fn() }));
jest.mock('@/lib/supabase-server',()=>({ createServiceRoleClient:jest.fn() }));
const req=(q:string)=>new NextRequest(`http://localhost/api/admin/listing-verification/facilities?q=${encodeURIComponent(q)}`);
beforeEach(()=>{ jest.clearAllMocks(); jest.mocked(requirePlatformAdmin).mockResolvedValue({ id:'11111111-1111-4111-8111-111111111111' } as never); });
test('運営以外の検索と短すぎる検索を拒否する',async()=>{
  jest.mocked(requirePlatformAdmin).mockResolvedValueOnce(null).mockResolvedValueOnce(NextResponse.json({}, { status:503 }));
  expect((await GET(req('店舗'))).status).toBe(403);
  expect((await GET(req('店舗'))).status).toBe(503);
  expect((await GET(req('店'))).status).toBe(400);
  expect(createServiceRoleClient).not.toHaveBeenCalled();
});
test('既存の公開店舗を検索し、ワイルドカードは文字として扱う',async()=>{
  const chain={ select:jest.fn().mockReturnThis(),ilike:jest.fn().mockReturnThis(),order:jest.fn().mockReturnThis(),
    limit:jest.fn().mockResolvedValue({ data:[{ id:'22222222-2222-4222-8222-222222222222',name:'合成店舗',prefecture:'大阪府',city:'大阪市',status:'published' }],error:null }) };
  jest.mocked(createServiceRoleClient).mockReturnValue({ from:()=>chain } as never);
  const response=await GET(req('店舗%'));
  expect(response.status).toBe(200); expect(chain.ilike).toHaveBeenCalledWith('name','%店舗\\%%');
  expect((await response.json()).facilities[0].status).toBe('published');
});
test('検索エラーは0件ではなく一時エラーとして返す',async()=>{
  const chain={ select:jest.fn().mockReturnThis(),ilike:jest.fn().mockReturnThis(),order:jest.fn().mockReturnThis(),
    limit:jest.fn().mockResolvedValue({ data:null,error:{ code:'test' } }) };
  jest.mocked(createServiceRoleClient).mockReturnValue({ from:()=>chain } as never);
  expect((await GET(req('店舗'))).status).toBe(503);
});
