import type { SupabaseClient } from '@supabase/supabase-js';
import { Blob } from 'node:buffer';
import { createHash } from 'node:crypto';
import { approveListingEvidence, readListingEvidence } from '../listing-verification-review';

const actorId='11111111-1111-4111-8111-111111111111';
const facilityId='22222222-2222-4222-8222-222222222222';
const documentId='33333333-3333-4333-8333-333333333333';
const path=`facilities/${facilityId}/${documentId}.pdf`;
const expectedIdentity={ name:'合成店舗',prefecture:'大阪府',city:'大阪市',address:'合成1' };
const input={ actorId,facilityId,documentIds:[documentId],expectedIdentity,documentVerified:true,authorityVerified:true };
const doc={ id:documentId,facility_id:facilityId,object_path:path,document_type:'lease',mime_type:'application/pdf',byte_size:5,
  sha256:createHash('sha256').update('%PDF-').digest('hex') };
function fixture() {
  const maybeSingle=jest.fn().mockResolvedValue({ data:doc,error:null });
  const chain={ select:jest.fn().mockReturnThis(),eq:jest.fn().mockReturnThis(),maybeSingle };
  const download=jest.fn().mockResolvedValue({ data:new Blob(['%PDF-']),error:null });
  const rpc=jest.fn().mockResolvedValue({ data:true,error:null });
  return { db:{ from:jest.fn().mockReturnValue(chain),storage:{ from:jest.fn().mockReturnValue({ download }) },rpc } as unknown as SupabaseClient,
    maybeSingle,download,rpc };
}
test('書類と権限の両方を確認し、資料が正しい施設の非公開書類である時だけ承認する', async () => {
  const f=fixture();
  const result = await approveListingEvidence(f.db,input);
  expect(f.download).toHaveBeenCalled();
  expect(result).toEqual({ state:'approved' });
  expect(f.rpc).toHaveBeenCalledWith('approve_listing_verification', { p_actor_id:actorId,p_facility_id:facilityId,
    p_document_ids:[documentId],p_expected_identity:expectedIdentity,p_document_verified:true,p_authority_verified:true });
});
test('権限確認がない、不正な書類や保存先が読めない場合は承認しない', async () => {
  const f=fixture();
  expect(await approveListingEvidence(f.db,{ ...input,authorityVerified:false })).toEqual({ state:'invalid' });
  f.maybeSingle.mockResolvedValueOnce({ data:{ ...doc,object_path:'elsewhere' },error:null });
  expect(await approveListingEvidence(f.db,input)).toEqual({ state:'unavailable' });
  f.download.mockResolvedValueOnce({ data:new Blob(['xxxxx']),error:null });
  expect(await approveListingEvidence(f.db,input)).toEqual({ state:'invalid_document' });
  f.maybeSingle.mockResolvedValueOnce({ data:{ ...doc,sha256:'a'.repeat(64) },error:null });
  expect(await approveListingEvidence(f.db,input)).toEqual({ state:'invalid_document' });
  f.download.mockResolvedValueOnce({ data:null,error:{ message:'offline' } });
  expect(await approveListingEvidence(f.db,input)).toEqual({ state:'unavailable' });
  expect(f.rpc).not.toHaveBeenCalled();
});
test('審査時に運営権限が失効していればDBの拒否を返す', async () => {
  const f=fixture(); f.rpc.mockResolvedValue({ data:null,error:{ code:'42501' } });
  expect(await approveListingEvidence(f.db,input)).toEqual({ state:'forbidden' });
});
test('補足書類も内容を確認してから承認し、いずれかが不正なら承認しない', async () => {
  const f=fixture();
  const second='44444444-4444-4444-8444-444444444444';
  f.maybeSingle.mockResolvedValueOnce({ data:doc,error:null }).mockResolvedValueOnce({
    data:{ ...doc,id:second,object_path:`facilities/${facilityId}/${second}.pdf` },error:null,
  });
  expect(await approveListingEvidence(f.db,{ ...input,documentIds:[documentId,second] })).toEqual({ state:'approved' });
  expect(f.download).toHaveBeenCalledTimes(2);
  expect(f.rpc).toHaveBeenCalledWith('approve_listing_verification',expect.objectContaining({ p_document_ids:[documentId,second] }));
  const bad=fixture();
  bad.maybeSingle.mockResolvedValueOnce({ data:doc,error:null }).mockResolvedValueOnce({ data:null,error:null });
  expect(await approveListingEvidence(bad.db,{ ...input,documentIds:[documentId,second] })).toEqual({ state:'not_found' });
  expect(bad.rpc).not.toHaveBeenCalled();
  expect(await approveListingEvidence(bad.db,{ ...input,documentIds:[documentId,documentId] })).toEqual({ state:'invalid' });
});
test('書類の照合・読取障害と不完全な承認結果は安全に拒否する',async()=>{
  const f=fixture();
  expect(await readListingEvidence(f.db,'bad',documentId)).toEqual({ state:'invalid' });
  expect(await readListingEvidence(f.db,facilityId,'bad')).toEqual({ state:'invalid' });
  f.maybeSingle.mockResolvedValueOnce({ data:null,error:{ code:'test' } });
  expect(await readListingEvidence(f.db,facilityId,documentId)).toEqual({ state:'unavailable' });
  f.maybeSingle.mockResolvedValueOnce({ data:{ unexpected:true },error:null });
  expect(await readListingEvidence(f.db,facilityId,documentId)).toEqual({ state:'unavailable' });
  f.download.mockResolvedValueOnce({ data:new Blob(['%PDF-longer']),error:null });
  expect(await readListingEvidence(f.db,facilityId,documentId)).toEqual({ state:'invalid_document' });
  f.rpc.mockResolvedValueOnce({ data:false,error:null });
  expect(await approveListingEvidence(f.db,input)).toEqual({ state:'unavailable' });
  f.rpc.mockResolvedValueOnce({ data:null,error:{ code:'test' } });
  expect(await approveListingEvidence(f.db,input)).toEqual({ state:'unavailable' });
});
