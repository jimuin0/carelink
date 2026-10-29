/** @jest-environment node */
import { NextRequest, NextResponse } from 'next/server';
import { GET } from '../route';
import { requirePlatformAdmin } from '@/lib/platform-admin';
import { createServiceRoleClient } from '@/lib/supabase-server';

jest.mock('@/lib/with-route',()=>({ withRoute:(handler:(request:Request)=>Promise<Response>)=>handler }));
jest.mock('@/lib/platform-admin',()=>({ requirePlatformAdmin:jest.fn() }));
jest.mock('@/lib/supabase-server',()=>({ createServiceRoleClient:jest.fn() }));
const facility='22222222-2222-4222-8222-222222222222';
const request=()=>new NextRequest(`http://localhost/api/admin/listing-verification?facility_id=${facility}`);
const identity={ name:'合成店舗',prefecture:'大阪府',city:'大阪市',address:'合成1' };
function chain(data:unknown,error:unknown=null) {
  return { select:jest.fn().mockReturnThis(),eq:jest.fn().mockReturnThis(),order:jest.fn().mockReturnThis(),
    maybeSingle:jest.fn().mockResolvedValue({ data,error }),limit:jest.fn().mockResolvedValue({ data,error }) };
}
beforeEach(()=>{ jest.clearAllMocks(); jest.mocked(requirePlatformAdmin).mockResolvedValue({ id:'11111111-1111-4111-8111-111111111111' } as never); });
test('運営権限がない場合、非公開書類の記録を読み取らない',async()=>{
  jest.mocked(requirePlatformAdmin).mockResolvedValueOnce(null).mockResolvedValueOnce(NextResponse.json({}, { status:503 }));
  expect((await GET(request())).status).toBe(403); expect((await GET(request())).status).toBe(503);
  expect(createServiceRoleClient).not.toHaveBeenCalled();
});
test('現在の店舗情報と一致する確認だけを確認済みとして返す',async()=>{
  const from=jest.fn((table:string)=>table === 'facility_profiles' ? chain(identity) : table === 'listing_verification_documents'
    ? chain([{ id:'33333333-3333-4333-8333-333333333333',document_type:'lease',created_at:'2026-01-01' }])
    : chain({ facility_identity:{ ...identity,address:'旧住所' } }));
  jest.mocked(createServiceRoleClient).mockReturnValue({ from } as never);
  const result=await GET(request());
  expect(result.status).toBe(200); expect(result.headers.get('cache-control')).toBe('no-store');
  expect((await result.json()).currentApproval).toBe(false);
});
test('取得失敗を書類なしと誤表示しない',async()=>{
  jest.mocked(createServiceRoleClient).mockReturnValue({ from:()=>chain(null,{ code:'synthetic' }) } as never);
  expect((await GET(request())).status).toBe(503);
});
test('不正ID・施設なし・未確認の状態を区別する',async()=>{
  expect((await GET(new NextRequest('http://localhost/api/admin/listing-verification?facility_id=bad'))).status).toBe(400);
  const from=jest.fn((table:string)=>table === 'facility_profiles' ? chain(null) : table === 'listing_verification_documents' ? chain([]) : chain(null));
  jest.mocked(createServiceRoleClient).mockReturnValue({ from } as never);
  expect((await GET(request())).status).toBe(404);
  from.mockImplementation((table:string)=>table === 'facility_profiles' ? chain(identity) : table === 'listing_verification_documents' ? chain([]) : chain(null));
  expect((await (await GET(request())).json()).currentApproval).toBe(false);
});
