/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { verifyReviewPhotos } from '../review-photo-verification';
const bucket=jest.fn(), info=jest.fn(),rpc=jest.fn();
const db={rpc,storage:{getBucket:bucket,from:()=>({info})}} as unknown as Parameters<typeof verifyReviewPhotos>[0];
const facility='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', actor='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',objectId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const path=`reviews/${facility}/photo.png`,url=`https://test.supabase.co/storage/v1/object/public/review-photos/${path}`;
beforeEach(()=>{
 jest.clearAllMocks();process.env.NEXT_PUBLIC_SUPABASE_URL='https://test.supabase.co';
 bucket.mockResolvedValue({data:{id:'review-photos',public:true,file_size_limit:50,allowed_mime_types:['image/png']},error:null});
 rpc.mockResolvedValue({data:[{object_id:objectId,object_path:path,byte_size:4,mime_type:'image/png'}],error:null});
 info.mockResolvedValue({data:{id:objectId,bucketId:'review-photos',name:path,size:4,contentType:'image/png'},error:null});
});
test('anonymous text-only review stays supported without Storage or owner lookup',async()=>{
 expect(await verifyReviewPhotos(db,null,facility,null)).toBe('ready');expect(rpc).not.toHaveBeenCalled();expect(info).not.toHaveBeenCalled();
});
test('actual owner row and SDK object must both match the current actor/facility',async()=>{
 expect(await verifyReviewPhotos(db,actor,facility,[url])).toBe('ready');
 expect(rpc).toHaveBeenCalledWith('owned_review_photo_metadata',{p_actor_id:actor,p_facility_id:facility,p_object_path:path});expect(info).toHaveBeenCalledWith(path);
});
test('copied other-person public photo URL is refused even though the URL prefix is valid',async()=>{
 rpc.mockResolvedValue({data:[],error:null});expect(await verifyReviewPhotos(db,actor,facility,[url])).toBe('unverified');expect(info).not.toHaveBeenCalled();
});
test.each([url+'?download=1',url+'#fragment',url.replace(facility,actor),url.replace('/photo.png','/%2e%2e/photo.png'),url.replace('/photo.png','/sub/photo.png')])('scope/path alias %s cannot reach body insertion',async forged=>{
 expect(await verifyReviewPhotos(db,actor,facility,[forged])).toBe('invalid');expect(rpc).not.toHaveBeenCalled();
});
test.each([{id:actor},{name:'different'},{size:5},{contentType:'image/jpeg'},{bucketId:'avatars'}])('object %p mismatches prevent attachment',async patch=>{
 info.mockResolvedValue({data:{id:objectId,bucketId:'review-photos',name:path,size:4,contentType:'image/png',...patch},error:null});
 expect(await verifyReviewPhotos(db,actor,facility,[url])).toBe('bucketId' in patch ? 'unavailable' : 'unverified');
});
test('provider error plus matching data and owner lookup error plus matching data stay unavailable',async()=>{
 rpc.mockResolvedValueOnce({data:[{object_id:objectId,object_path:path,byte_size:4,mime_type:'image/png'}],error:{message:'partial'}});
 expect(await verifyReviewPhotos(db,actor,facility,[url])).toBe('unavailable');
 info.mockResolvedValue({data:{id:objectId,bucketId:'review-photos',name:path,size:4,contentType:'image/png'},error:{message:'partial'}});
 expect(await verifyReviewPhotos(db,actor,facility,[url])).toBe('unavailable');
});
test('actual stricter size/MIME reject before SDK info or review mutation',async()=>{
 rpc.mockResolvedValue({data:[{object_id:objectId,object_path:path,byte_size:51,mime_type:'image/png'}],error:null});
 expect(await verifyReviewPhotos(db,actor,facility,[url])).toBe('invalid');expect(info).not.toHaveBeenCalled();
});
test('duplicate URLs, missing configuration and malformed owner lookup never become review attachment success',async()=>{
 expect(await verifyReviewPhotos(db,actor,facility,[url,url])).toBe('invalid');expect(rpc).not.toHaveBeenCalled();
 delete process.env.NEXT_PUBLIC_SUPABASE_URL;expect(await verifyReviewPhotos(db,actor,facility,[url])).toBe('unavailable');
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://test.supabase.co';bucket.mockResolvedValueOnce({data:null,error:null});expect(await verifyReviewPhotos(db,actor,facility,[url])).toBe('unavailable');
 rpc.mockResolvedValue({data:{object_id:objectId},error:null});expect(await verifyReviewPhotos(db,actor,facility,[url])).toBe('unavailable');
});
