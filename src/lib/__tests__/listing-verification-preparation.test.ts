import type { SupabaseClient } from '@supabase/supabase-js';
import { prepareListingEvidence } from '../listing-verification-preparation';
import * as evidence from '../listing-verification-evidence';
jest.mock('../listing-verification-evidence',()=>{
  const actual=jest.requireActual('../listing-verification-evidence');
  return { ...actual,listingEvidencePath:jest.fn(actual.listingEvidencePath) };
});

const input = { actorId:'11111111-1111-4111-8111-111111111111', facilityId:'22222222-2222-4222-8222-222222222222',
  documentId:'33333333-3333-4333-8333-333333333333', type:'lease', mimeType:'application/pdf', byteSize:100,sha256:'a'.repeat(64) };
const path = `facilities/${input.facilityId}/${input.documentId}.pdf`;
const missing = { name:'StorageApiError',message:'Object not found',status:404,statusCode:'404' };
function fixture() {
  const rpc = jest.fn().mockResolvedValue({ data:[{ outcome:'prepared',object_path:path }],error:null });
  const info = jest.fn().mockResolvedValue({ data:null,error:missing });
  const sign = jest.fn().mockResolvedValue({ data:{ path,token:'synthetic-token' },error:null });
  const db = { rpc,storage:{ from:jest.fn().mockReturnValue({ info,createSignedUploadUrl:sign }) } } as unknown as SupabaseClient;
  return { db,rpc,info,sign };
}

test('確認済み施設の固定された資料パスだけに上書き不可のアップロード権を作る', async () => {
  const { db,rpc,sign } = fixture();
  expect(await prepareListingEvidence(db,input)).toEqual({ state:'upload',path,token:'synthetic-token' });
  expect(rpc).toHaveBeenCalledWith('prepare_listing_verification_document',expect.objectContaining({ p_actor_id:input.actorId,p_facility_id:input.facilityId,p_document_id:input.documentId }));
  expect(sign).toHaveBeenCalledWith(path,{ upsert:false });
});

test('認可拒否・不正なパス・保存先の障害では権限を発行しない', async () => {
  const f = fixture();
  f.rpc.mockResolvedValueOnce({ data:[{ outcome:'unverified',object_path:null }],error:null });
  expect(await prepareListingEvidence(f.db,input)).toEqual({ state:'unverified' });
  f.rpc.mockResolvedValueOnce({ data:[{ outcome:'prepared',object_path:'wrong' }],error:null });
  expect(await prepareListingEvidence(f.db,input)).toEqual({ state:'unavailable' });
  f.info.mockResolvedValueOnce({ data:null,error:{ message:'network failure' } });
  expect(await prepareListingEvidence(f.db,input)).toEqual({ state:'unavailable' });
  expect(f.sign).not.toHaveBeenCalled();
});

test('既に同じ資料があれば再発行せず、情報が違う場合は競合とする', async () => {
  const f = fixture();
  f.info.mockResolvedValueOnce({ data:{ bucketId:'listing-verification',name:path,size:100,contentType:'application/pdf' },error:null });
  expect(await prepareListingEvidence(f.db,input)).toEqual({ state:'uploaded' });
  f.info.mockResolvedValueOnce({ data:{ bucketId:'listing-verification',name:path,size:99,contentType:'application/pdf' },error:null });
  expect(await prepareListingEvidence(f.db,input)).toEqual({ state:'conflict' });
  expect(f.sign).not.toHaveBeenCalled();
});

test('不正入力・DB失敗・署名失敗を受理と扱わない',async()=>{
  const f=fixture();
  expect(await prepareListingEvidence(f.db,{ ...input,actorId:'invalid' })).toEqual({ state:'invalid' });
  f.rpc.mockResolvedValueOnce({ data:null,error:{ code:'test' } });
  expect(await prepareListingEvidence(f.db,input)).toEqual({ state:'unavailable' });
  f.rpc.mockResolvedValueOnce({ data:[],error:null });
  expect(await prepareListingEvidence(f.db,input)).toEqual({ state:'unavailable' });
  jest.mocked(evidence.listingEvidencePath).mockReturnValueOnce(null);
  expect(await prepareListingEvidence(f.db,input)).toEqual({ state:'unavailable' });
  f.info.mockResolvedValueOnce({ data:{ unexpected:true },error:missing });
  expect(await prepareListingEvidence(f.db,input)).toEqual({ state:'unavailable' });
  f.sign.mockResolvedValueOnce({ data:null,error:{ message:'test' } });
  expect(await prepareListingEvidence(f.db,input)).toEqual({ state:'unavailable' });
  f.sign.mockResolvedValueOnce({ data:{ path,token:'' },error:null });
  expect(await prepareListingEvidence(f.db,input)).toEqual({ state:'unavailable' });
});
