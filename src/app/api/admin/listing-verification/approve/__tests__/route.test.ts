/** @jest-environment node */
import { NextRequest, NextResponse } from 'next/server';
import { POST } from '../route';
import { requirePlatformAdmin } from '@/lib/platform-admin';
import { approveListingEvidence } from '@/lib/listing-verification-review';

jest.mock('@/lib/with-route', () => ({ withRoute:(handler:(request:Request)=>Promise<Response>)=>handler }));
jest.mock('@/lib/platform-admin', () => ({ requirePlatformAdmin:jest.fn() }));
jest.mock('@/lib/listing-verification-review', () => ({ ...jest.requireActual('@/lib/listing-verification-review'),approveListingEvidence:jest.fn() }));
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient:()=>({}) }));
jest.mock('@/lib/rate-limit', () => ({ mutationRateLimit:{} }));
const actor='11111111-1111-4111-8111-111111111111';
const input={ facilityId:'22222222-2222-4222-8222-222222222222',documentIds:['33333333-3333-4333-8333-333333333333'],
  expectedIdentity:{ name:'合成店舗',prefecture:'大阪府',city:'大阪市',address:'合成1' },documentVerified:true,authorityVerified:true };
const request=(body:unknown)=>new NextRequest('http://localhost/api/admin/listing-verification/approve',
  { method:'POST',headers:{ 'content-type':'application/json' },body:JSON.stringify(body) });
beforeEach(()=>{ jest.clearAllMocks(); (requirePlatformAdmin as jest.Mock).mockResolvedValue({ id:actor }); });

test('運営管理者以外は承認できない',async()=>{
  (requirePlatformAdmin as jest.Mock).mockResolvedValueOnce(null).mockResolvedValueOnce(NextResponse.json({}, { status:503 }));
  expect((await POST(request(input))).status).toBe(403);
  expect((await POST(request(input))).status).toBe(503);
  expect(approveListingEvidence).not.toHaveBeenCalled();
});
test('書類と権限を別々に確認した場合だけ本人のIDで承認する',async()=>{
  expect((await POST(request({ ...input,authorityVerified:false }))).status).toBe(400);
  expect((await POST(request({ ...input,actorId:actor }))).status).toBe(400);
  expect(approveListingEvidence).not.toHaveBeenCalled();
  (approveListingEvidence as jest.Mock).mockResolvedValue({ state:'approved' });
  const response=await POST(request(input));
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(approveListingEvidence).toHaveBeenCalledWith(expect.anything(),{ ...input,actorId:actor });
});
test('審査時の権限失効や資料不備を成功にしない',async()=>{
  (approveListingEvidence as jest.Mock).mockResolvedValueOnce({ state:'forbidden' }).mockResolvedValueOnce({ state:'invalid_document' });
  expect((await POST(request(input))).status).toBe(403);
  expect((await POST(request(input))).status).toBe(422);
});
