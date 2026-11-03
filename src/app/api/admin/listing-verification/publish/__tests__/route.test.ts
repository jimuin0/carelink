/** @jest-environment node */
import { NextRequest, NextResponse } from 'next/server';
import { POST } from '../route';
import { requirePlatformAdmin } from '@/lib/platform-admin';
import { publishVerifiedFacilityIfReady } from '@/lib/listing-auto-publish';

jest.mock('@/lib/with-route', () => ({ withRoute:(handler:(request:Request)=>Promise<Response>)=>handler }));
jest.mock('@/lib/platform-admin', () => ({ requirePlatformAdmin:jest.fn() }));
jest.mock('@/lib/listing-auto-publish', () => ({ publishVerifiedFacilityIfReady:jest.fn() }));
const db={};
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient:()=>db }));
jest.mock('@/lib/rate-limit', () => ({ mutationRateLimit:{} }));
const actor='11111111-1111-4111-8111-111111111111';
const facilityId='22222222-2222-4222-8222-222222222222';
const request=(body:unknown)=>new NextRequest('http://localhost/api/admin/listing-verification/publish',
  { method:'POST',headers:{ 'content-type':'application/json' },body:JSON.stringify(body) });
beforeEach(()=>{ jest.clearAllMocks(); (requirePlatformAdmin as jest.Mock).mockResolvedValue({ id:actor }); });

test('運営管理者以外は公開をやり直せない',async()=>{
  (requirePlatformAdmin as jest.Mock).mockResolvedValueOnce(null).mockResolvedValueOnce(NextResponse.json({},{ status:503 }));
  expect((await POST(request({ facilityId }))).status).toBe(403);
  expect((await POST(request({ facilityId }))).status).toBe(503);
  expect(publishVerifiedFacilityIfReady).not.toHaveBeenCalled();
});
test.each([null,{},{ facilityId:'bad' },{ facilityId,extra:true }])('不正な入力では何もしない %#',async body=>{
  expect((await POST(request(body))).status).toBe(400);
  expect(publishVerifiedFacilityIfReady).not.toHaveBeenCalled();
});
test.each([['published',200],['not_ready',200],['blocked',200],['unavailable',503]])('結果 %s をそのまま返す',async(publication,status)=>{
  (publishVerifiedFacilityIfReady as jest.Mock).mockResolvedValue(publication);
  const response=await POST(request({ facilityId }));
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({ state:'done',publication });
  expect(publishVerifiedFacilityIfReady).toHaveBeenCalledWith(db,facilityId,actor);
});
