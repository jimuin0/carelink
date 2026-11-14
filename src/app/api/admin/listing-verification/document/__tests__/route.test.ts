/** @jest-environment node */
import { NextRequest, NextResponse } from 'next/server';
import { GET } from '../route';
import { requirePlatformAdmin } from '@/lib/platform-admin';
import { readListingEvidence } from '@/lib/listing-verification-review';
import { writeAuditLog } from '@/lib/audit-logger';

jest.mock('@/lib/with-route', () => ({ withRoute:(handler:(request:Request)=>Promise<Response>)=>handler }));
jest.mock('@/lib/platform-admin', () => ({ requirePlatformAdmin:jest.fn() }));
jest.mock('@/lib/listing-verification-review', () => ({ readListingEvidence:jest.fn() }));
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient:()=>({}) }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog:jest.fn(),getRequestContext:()=>({ ip:'synthetic',ua:'synthetic' }) }));
const facility='22222222-2222-4222-8222-222222222222';
const document='33333333-3333-4333-8333-333333333333';
const request=()=>new NextRequest(`http://localhost/api/admin/listing-verification/document?facility_id=${facility}&document_id=${document}`);
beforeEach(()=>{ jest.clearAllMocks(); (requirePlatformAdmin as jest.Mock).mockResolvedValue({ id:'11111111-1111-4111-8111-111111111111' }); });

test('運営管理者以外は非公開書類を取得できない',async()=>{
  (requirePlatformAdmin as jest.Mock).mockResolvedValue(null);
  expect((await GET(request())).status).toBe(403);
  expect(readListingEvidence).not.toHaveBeenCalled();
});
test('書類は保存されない添付としてのみ返し、閲覧記録を残す',async()=>{
  (readListingEvidence as jest.Mock).mockResolvedValue({ state:'ready',bytes:Uint8Array.from([1,2,3]),mimeType:'application/pdf' });
  const response=await GET(request());
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('content-type')).toBe('application/octet-stream');
  expect(response.headers.get('content-disposition')).toContain('attachment');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action:'export',facilityId:facility,recordId:document }));
});
test('不正または取得不能な書類は内容を返さない',async()=>{
  (readListingEvidence as jest.Mock).mockResolvedValueOnce({ state:'invalid_document' }).mockResolvedValueOnce({ state:'unavailable' });
  expect((await GET(request())).status).toBe(422);
  expect((await GET(request())).status).toBe(503);
  expect(writeAuditLog).not.toHaveBeenCalled();
});
test('認証障害・不正ID・存在しない書類と画像形式を安全に処理する',async()=>{
  (requirePlatformAdmin as jest.Mock).mockResolvedValueOnce(NextResponse.json({}, { status:503 }));
  expect((await GET(request())).status).toBe(503);
  expect((await GET(new NextRequest('http://localhost/api/admin/listing-verification/document?facility_id=bad'))).status).toBe(400);
  (readListingEvidence as jest.Mock).mockResolvedValueOnce({ state:'not_found' });
  expect((await GET(request())).status).toBe(404);
  for (const [mime,ext] of [['image/png','png'],['image/jpeg','jpg']]) {
    (readListingEvidence as jest.Mock).mockResolvedValueOnce({ state:'ready',bytes:Uint8Array.from([1]),mimeType:mime });
    expect((await GET(request())).headers.get('content-disposition')).toContain(`.${ext}`);
  }
});
