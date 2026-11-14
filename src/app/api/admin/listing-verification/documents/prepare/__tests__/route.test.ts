/** @jest-environment node */
import { NextRequest, NextResponse } from 'next/server';
import { POST } from '../route';
import { getAdminApiContext } from '@/lib/admin-api-context';
import { prepareListingEvidence } from '@/lib/listing-verification-preparation';

jest.mock('@/lib/with-route', () => ({ withRoute: (handler: (request: Request) => Promise<Response>) => handler }));
jest.mock('@/lib/admin-api-context', () => ({ getAdminApiContext: jest.fn() }));
jest.mock('@/lib/listing-verification-preparation', () => ({ prepareListingEvidence: jest.fn() }));
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => ({}) }));
jest.mock('@/lib/rate-limit', () => ({ mutationRateLimit: {} }));

const actor = '11111111-1111-4111-8111-111111111111';
const facility = '22222222-2222-4222-8222-222222222222';
const documentId = '33333333-3333-4333-8333-333333333333';
const body = { documentId,type:'lease',mimeType:'application/pdf',byteSize:100,sha256:'a'.repeat(64) };
function request(value: unknown) {
  return new NextRequest(`http://localhost/api/admin/listing-verification/documents/prepare?facility_id=${facility}`,
    { method:'POST',headers:{ 'content-type':'application/json' },body:JSON.stringify(value) });
}
beforeEach(() => { jest.clearAllMocks(); (getAdminApiContext as jest.Mock).mockResolvedValue({ userId:actor,facilityId:facility }); });

test('管理権限がない利用者には資料のアップロード権限を発行しない', async () => {
  (getAdminApiContext as jest.Mock).mockResolvedValue(NextResponse.json({ error:'Unauthorized' },{ status:401 }));
  expect((await POST(request(body))).status).toBe(401);
  expect(prepareListingEvidence).not.toHaveBeenCalled();
});

test('申請者が他人の施設や利用者IDを指定できない', async () => {
  expect((await POST(request({ ...body,actorId:documentId }))).status).toBe(400);
  expect(prepareListingEvidence).not.toHaveBeenCalled();
  (prepareListingEvidence as jest.Mock).mockResolvedValue({ state:'upload',path:'synthetic',token:'synthetic' });
  const response = await POST(request(body));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(prepareListingEvidence).toHaveBeenCalledWith(expect.anything(),{ ...body,actorId:actor,facilityId:facility });
});

test('権限失効や保存先の不調は成功扱いにしない', async () => {
  (prepareListingEvidence as jest.Mock).mockResolvedValueOnce({ state:'unverified' }).mockResolvedValueOnce({ state:'unavailable' });
  expect((await POST(request(body))).status).toBe(403);
  expect((await POST(request(body))).status).toBe(503);
});
