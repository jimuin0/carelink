/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { uploadListingEvidence } from '../listing-verification-upload';
import * as evidence from '../listing-verification-evidence';
jest.mock('../listing-verification-evidence', () => {
  const actual=jest.requireActual('../listing-verification-evidence');
  return { ...actual,listingEvidencePath:jest.fn(actual.listingEvidencePath) };
});

const facilityId='22222222-2222-4222-8222-222222222222';
const documentId='33333333-3333-4333-8333-333333333333';
const path=`facilities/${facilityId}/${documentId}.pdf`;
const bytes=Uint8Array.from([0x25,0x50,0x44,0x46,0x2d]);
const file={ type:'application/pdf',size:bytes.length,arrayBuffer:async()=>bytes.buffer } as File;
const input={ facilityId,documentId,type:'lease',file };
const response=(data:unknown,ok=true)=>({ ok,json:async()=>data }) as Response;
function fixture() {
  return { request:jest.fn().mockResolvedValueOnce(response({ state:'upload',path,token:'synthetic' }))
    .mockResolvedValueOnce(response({ state:'uploaded' })),upload:jest.fn().mockResolvedValue({ error:null }),
    sha256:jest.fn().mockResolvedValue('a'.repeat(64)) };
}
test('書類を固定したIDで送信し、保存先での受理を再確認する',async()=>{
  const deps=fixture();
  expect(await uploadListingEvidence(deps,input)).toEqual({ state:'uploaded' });
  expect(deps.upload).toHaveBeenCalledWith(path,'synthetic',file);
  expect(deps.request).toHaveBeenCalledTimes(2);
  expect(deps.request.mock.calls[0][1].body).toEqual(deps.request.mock.calls[1][1].body);
});
test('不正なID・内容・計算結果や受付失敗を安全に扱う',async()=>{
  const f=fixture();
  expect(await uploadListingEvidence(f,{ ...input,facilityId:'bad' })).toEqual({ state:'invalid' });
  expect(await uploadListingEvidence(f,{ ...input,documentId:'bad' })).toEqual({ state:'invalid' });
  expect(await uploadListingEvidence(f,{ ...input,file:{ ...file,size:8 } as File })).toEqual({ state:'invalid' });
  expect(await uploadListingEvidence(f,{ ...input,file:{ ...file,arrayBuffer:async()=>new Uint8Array([1,2,3,4,5]).buffer } as File })).toEqual({ state:'invalid' });
  f.sha256.mockResolvedValueOnce('bad');
  expect(await uploadListingEvidence(f,input)).toEqual({ state:'unavailable' });
  jest.mocked(evidence.listingEvidencePath).mockReturnValueOnce(null);
  expect(await uploadListingEvidence(f,input)).toEqual({ state:'invalid' });
  f.request.mockReset().mockResolvedValueOnce(response({},false));
  expect(await uploadListingEvidence(f,input)).toEqual({ state:'unknown' });
  f.request.mockReset().mockResolvedValueOnce(response({ unexpected:true }));
  expect(await uploadListingEvidence(f,input)).toEqual({ state:'unknown' });
  f.request.mockReset().mockResolvedValueOnce(response({ state:'uploaded' }));
  expect(await uploadListingEvidence(f,input)).toEqual({ state:'uploaded' });
  f.request.mockReset().mockResolvedValueOnce(response({ state:'upload',path,token:'synthetic' })).mockResolvedValueOnce(response({ state:'upload',path,token:'synthetic' }));
  expect(await uploadListingEvidence(f,input)).toEqual({ state:'unknown' });
});
test('応答が失われた場合も同じIDで確認し、未確認を成功扱いにしない',async()=>{
  const deps=fixture(); deps.upload.mockRejectedValueOnce(new Error('synthetic'));
  expect(await uploadListingEvidence(deps,input)).toEqual({ state:'uploaded' });
  const unknown=fixture(); unknown.request.mockReset().mockResolvedValueOnce(response({ state:'upload',path,token:'synthetic' }))
    .mockRejectedValueOnce(new Error('synthetic'));
  expect(await uploadListingEvidence(unknown,input)).toEqual({ state:'unknown' });
});
test('不正な形式や予期しない保存先ではアップロードしない',async()=>{
  const deps=fixture(); deps.request.mockReset().mockResolvedValueOnce(response({ state:'upload',path:'other',token:'synthetic' }));
  expect(await uploadListingEvidence(deps,input)).toEqual({ state:'unknown' }); expect(deps.upload).not.toHaveBeenCalled();
  const invalid=fixture();
  expect(await uploadListingEvidence(invalid,{ ...input,file:{ ...file,type:'text/html' } as File })).toEqual({ state:'invalid' });
  expect(invalid.request).not.toHaveBeenCalled();
});
