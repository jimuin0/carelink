/** @jest-environment @stryker-mutator/jest-runner/jest-env/jsdom */
import { uploadReviewPhotos, type ReviewPhotoUploads } from '../review-photo-upload';
import { compressImage } from '../image-compress';
import { readReviewPhotoLimits, REVIEW_PHOTO_MAX_BYTES, type ReviewPhotoLimits } from '../review-photo-limits';
jest.mock('../image-compress', () => ({ compressImage: jest.fn() }));
const upload = jest.fn(), download = jest.fn(), getPublicUrl = jest.fn(), getBucket = jest.fn();
const db = { storage: { from: () => ({ upload, download, getPublicUrl }), getBucket } } as unknown as Parameters<typeof uploadReviewPhotos>[0];
const limits: ReviewPhotoLimits = { consumerVersion: 1, maxBytes: 50, mimeTypes: ['image/png'] };
beforeEach(() => {
 jest.clearAllMocks(); (compressImage as jest.Mock).mockImplementation(async f => f);
 upload.mockImplementation(async path => ({ data: { path }, error: null }));
 download.mockResolvedValue({ data: null, error: { message: 'not found' } });
 getPublicUrl.mockImplementation(path => ({ data: { publicUrl: `https://test.supabase.co/storage/v1/object/public/review-photos/${path}` } }));
 Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
});
test('stricter actual bucket MIME/size preserved and omitted/error/private metadata never assumed ready', async () => {
 getBucket.mockResolvedValue({ data: { id: 'review-photos', public: true, file_size_limit: 50, allowed_mime_types: ['image/png'] }, error: null });
 expect(await readReviewPhotoLimits(db as unknown as Parameters<typeof readReviewPhotoLimits>[0])).toEqual(limits);
 for (const patch of [{ public:false }, { file_size_limit:undefined }, { allowed_mime_types:undefined }, { allowed_mime_types:['image/*'] }]) {
  getBucket.mockResolvedValue({ data: { id:'review-photos',public:true,file_size_limit:null,allowed_mime_types:null,...patch },error:null });
  expect(await readReviewPhotoLimits(db as unknown as Parameters<typeof readReviewPhotoLimits>[0])).toBeNull();
 }
 getBucket.mockResolvedValue({ data: { id:'review-photos',public:true,file_size_limit:null,allowed_mime_types:null },error:{ message:'partial metadata' } });
 expect(await readReviewPhotoLimits(db as unknown as Parameters<typeof readReviewPhotoLimits>[0])).toBeNull();
 getBucket.mockResolvedValue({ data: { id:'review-photos',public:true,file_size_limit:null,allowed_mime_types:null },error:null });
 expect((await readReviewPhotoLimits(db as unknown as Parameters<typeof readReviewPhotoLimits>[0]))?.maxBytes).toBe(REVIEW_PHOTO_MAX_BYTES);
});
test('PNG-only policy falls back to intact original instead of uploading derived JPEG', async () => {
 const original = new File(['original'], 'wrong.svg', { type:'image/png' });
 (compressImage as jest.Mock).mockResolvedValue(new File(['jpeg'], 'derived.jpg', { type:'image/jpeg' }));
 await uploadReviewPhotos(db,'facility',[original],limits,new Map());
 expect(upload.mock.calls[0][1]).toBe(original); expect(upload.mock.calls[0][0]).toMatch(/\.png$/);
});
test('too-large compressed and original bytes fail before any storage write', async () => {
 const original = new File(['x'.repeat(51)], 'large.png',{type:'image/png'});
 await expect(uploadReviewPhotos(db,'facility',[original],limits,new Map())).rejects.toThrow('保存上限');
 expect(original.size).toBe(51); expect(upload).not.toHaveBeenCalled();
});
test('upload failure preserves fixed path; exact content readback recovers lost upload reply without re-upload', async () => {
 const original = new File(['original'], 'photo.png',{type:'image/png'}); const entries: ReviewPhotoUploads = new Map();
 upload.mockResolvedValueOnce({ data:null,error:{message:'lost reply'} });
 await expect(uploadReviewPhotos(db,'facility',[original],limits,entries)).rejects.toThrow('本文は送信していません');
 const path=upload.mock.calls[0][0]; download.mockResolvedValueOnce({data:new Blob(['original'],{type:'image/png'}),error:null});
 const urls=await uploadReviewPhotos(db,'facility',[original],limits,entries);
 expect(download).toHaveBeenCalledWith(path); expect(upload).toHaveBeenCalledTimes(1); expect(urls[0]).toContain(path);
});
test('409 or wrong-content readback does not count as a successful upload', async () => {
 const original = new File(['original'], 'photo.png',{type:'image/png'}); const entries: ReviewPhotoUploads = new Map();
 upload.mockResolvedValue({data:null,error:{statusCode:'409'}});
 await expect(uploadReviewPhotos(db,'facility',[original],limits,entries)).rejects.toThrow();
 download.mockResolvedValue({data:new Blob(['different'],{type:'image/png'}),error:null});
 await expect(uploadReviewPhotos(db,'facility',[original],limits,entries)).rejects.toThrow();
 expect(upload.mock.calls[1][0]).toBe(upload.mock.calls[0][0]);
});
test('successful upload is reused on a safe pre-commit retry and stricter changed policy blocks the cached file', async () => {
 const original=new File(['original'],'photo.png',{type:'image/png'});const entries:ReviewPhotoUploads=new Map();
 const first=await uploadReviewPhotos(db,'facility',[original],limits,entries);
 expect(await uploadReviewPhotos(db,'facility',[original],limits,entries)).toEqual(first);expect(upload).toHaveBeenCalledTimes(1);
 await expect(uploadReviewPhotos(db,'facility',[original],{...limits,maxBytes:3},entries)).rejects.toThrow('変更');
 expect(upload).toHaveBeenCalledTimes(1);
});
test('modern Blob arrayBuffer readback also verifies exact saved bytes after lost upload reply',async()=>{
 const original=new File(['original'],'photo.png',{type:'image/png'});const saved=new Blob(['original'],{type:'image/png'});
 const buffer=Uint8Array.from([111,114,105,103,105,110,97,108]).buffer;
 Object.defineProperty(original,'arrayBuffer',{value:async()=>buffer});Object.defineProperty(saved,'arrayBuffer',{value:async()=>buffer});
 const entries:ReviewPhotoUploads=new Map();upload.mockResolvedValueOnce({data:null,error:{message:'lost'}});
 await expect(uploadReviewPhotos(db,'facility',[original],limits,entries)).rejects.toThrow();
 download.mockResolvedValue({data:saved,error:null});expect(await uploadReviewPhotos(db,'facility',[original],limits,entries)).toHaveLength(1);
 expect(upload).toHaveBeenCalledTimes(1);
});
