/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import ReviewForm from '../ReviewForm';
import { REVIEW_PENDING_PREFIX } from '@/lib/review-transport-fence';
const upload=jest.fn(),download=jest.fn(),remove=jest.fn(),fetchMock=jest.fn();
jest.mock('next/navigation',()=>({useRouter:()=>({refresh:jest.fn()})}));
jest.mock('@/lib/image-compress',()=>({compressImage:async(f:File)=>f}));
jest.mock('@/lib/recaptcha-client',()=>({getRecaptchaToken:async()=>null}));
jest.mock('@/lib/client-cleanup-marker',()=>({getClientCleanupGeneration:()=>null,hasClientCleanupNeeded:()=>false,CLIENT_CLEANUP_COMPLETED_EVENT:'review-cleanup-completed'}));
jest.mock('../StarRating',()=>({__esModule:true,default:({onChange}:{onChange:(n:number)=>void})=><button type="button" onClick={()=>onChange(5)}>5点</button>}));
jest.mock('@/components/ConfirmDialog',()=>({__esModule:true,default:({open,onConfirm}:{open:boolean;onConfirm:()=>void})=>open?<button onClick={onConfirm}>投稿する</button>:null}));
jest.mock('@/components/Toast',()=>({__esModule:true,default:({message}:{message:string})=><p role="alert">{message}</p>}));
jest.mock('@/lib/supabase-browser',()=>({createBrowserSupabaseClient:()=>({auth:{getUser:async()=>({data:{user:{id:'user'}},error:null})},storage:{from:()=>({upload,download,remove,getPublicUrl:(path:string)=>({data:{publicUrl:`https://test.supabase.co/storage/v1/object/public/review-photos/${path}`}})})}})}));
const facility='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';const id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const caps={consumerVersion:1,maxBytes:5242880,mimeTypes:['image/jpeg','image/png','image/webp']};
let uuid=1;
beforeEach(()=>{
 jest.clearAllMocks();localStorage.clear();uuid=1;
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_name:string,_options:unknown,action:()=>Promise<unknown>)=>action()}});
 Object.defineProperty(crypto,'randomUUID',{configurable:true,value:()=>`cccccccc-cccc-4ccc-8ccc-${String(uuid++).padStart(12,'0')}`});
 URL.createObjectURL=jest.fn(()=>`blob:preview-${uuid}`);URL.revokeObjectURL=jest.fn();
 upload.mockImplementation(async path=>({data:{path},error:null}));download.mockResolvedValue({data:null,error:{message:'absent'}});
 global.fetch=fetchMock;fetchMock.mockImplementation(async url=>({ok:true,headers:new Headers(),json:async()=>url==='/api/review/photo-limits'?caps:{success:true,id}}));
});
async function form(files:File[]=[new File(['original'],'original.png',{type:'image/png'})]){
 const mounted=render(<ReviewForm facilityId={facility} onReviewSubmitted={jest.fn()}/>);
 fireEvent.change(screen.getByLabelText('ニックネーム',{exact:false}),{target:{value:'Original name'}});
 fireEvent.change(screen.getByLabelText('コメント'),{target:{value:'Original comment'}});
 screen.getAllByRole('button',{name:'5点'}).forEach(button=>fireEvent.click(button));
 fireEvent.change(screen.getByLabelText('口コミ写真を選択'),{target:{files}});
 if(files.length)await screen.findByAltText('口コミ投稿用プレビュー写真1');
 return mounted;
}
async function submit(){fireEvent.click(screen.getByRole('button',{name:'口コミを投稿する'}));fireEvent.click(await screen.findByRole('button',{name:'投稿する',exact:true}));}
test('bucket failure with accompanying valid limits blocks both upload and review commit while preserving originals',async()=>{
 fetchMock.mockResolvedValue({ok:false,headers:new Headers(),json:async()=>caps});await form();await submit();
 await screen.findByText(/写真の保存設定を確認できません/);
 expect(upload).not.toHaveBeenCalled();expect(fetchMock).toHaveBeenCalledTimes(1);
 expect(screen.getByLabelText('コメント')).toHaveValue('Original comment');expect(screen.getByAltText('口コミ投稿用プレビュー写真1')).toBeVisible();
});
test('upload failure cannot silently submit a text-only review or delete the original upload',async()=>{
 upload.mockResolvedValue({data:null,error:{message:'storage outage'}});await form();await submit();
 await screen.findByText(/本文は送信していません/);
 expect(fetchMock.mock.calls.some(c=>c[0]==='/api/review')).toBe(false);expect(remove).not.toHaveBeenCalled();
 expect(screen.getByLabelText('コメント')).toHaveValue('Original comment');expect(screen.getByAltText('口コミ投稿用プレビュー写真1')).toBeVisible();
});
const reviewBodies=()=>fetchMock.mock.calls.filter(c=>c[0]==='/api/review').map(c=>JSON.parse(c[1].body));
const notice=/前回の口コミの受付状況を確認できていません/;
// 2026-10-23: before, a lost reply disabled the form on this device forever.
// Now the receipt fence keeps only the operation id; the next submission resends
// it and the server answers with the earlier review if it was saved.
test('lost commit response keeps the operation; a resend after remount returns the earlier review without a second one',async()=>{
 fetchMock.mockImplementation(async url=>{if(url==='/api/review')throw new Error('lost accepted reply');return {ok:true,json:async()=>caps};});
 const mounted=await form();await submit();await screen.findByText(/投稿結果を確認できません/);
 expect(remove).not.toHaveBeenCalled();expect(screen.getByLabelText('コメント')).toHaveValue('Original comment');
 const operation=localStorage.getItem(REVIEW_PENDING_PREFIX+facility);expect(operation).toBe(reviewBodies()[0].operation_id);
 expect(screen.getByText(notice)).toBeInTheDocument();expect(screen.getByRole('button',{name:'口コミを投稿する'})).toBeEnabled();
 mounted.unmount();
 fetchMock.mockImplementation(async url=>({ok:true,headers:new Headers(),json:async()=>url==='/api/review/photo-limits'?caps:{success:true,id,replayed:true}}));
 await form([]);expect(screen.getByText(notice)).toBeInTheDocument();await submit();
 await screen.findByText('前回の口コミは受け付けられていました');expect(screen.getByText(/今回入力した内容は投稿していません/)).toBeInTheDocument();
 expect(reviewBodies().map(b=>b.operation_id)).toEqual([operation,operation]);expect(localStorage.getItem(REVIEW_PENDING_PREFIX+facility)).toBeNull();
});
test('a resend that the server refuses before saving keeps the operation for the next resend',async()=>{
 localStorage.setItem(REVIEW_PENDING_PREFIX+facility,'dddddddd-dddd-4ddd-8ddd-dddddddddddd');
 fetchMock.mockImplementation(async url=>url==='/api/review/photo-limits'?{ok:true,json:async()=>caps}:{ok:false,headers:new Headers({'X-CareLink-Review-Commit':'not-started'}),json:async()=>({error:'Bot検知: 時間をおいて再度お試しください'})});
 await form([]);await submit();await screen.findByText('Bot検知: 時間をおいて再度お試しください');
 expect(reviewBodies()[0].operation_id).toBe('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
 expect(localStorage.getItem(REVIEW_PENDING_PREFIX+facility)).toBe('dddddddd-dddd-4ddd-8ddd-dddddddddddd');expect(screen.getByText(notice)).toBeInTheDocument();
 fetchMock.mockImplementation(async url=>({ok:true,headers:new Headers(),json:async()=>url==='/api/review/photo-limits'?caps:{success:true,id}}));
 await submit();await screen.findByText('口コミを投稿しました');
 expect(reviewBodies()[1].operation_id).toBe('dddddddd-dddd-4ddd-8ddd-dddddddddddd');expect(localStorage.getItem(REVIEW_PENDING_PREFIX+facility)).toBeNull();
});
test('the 24h duplicate answer settles a resumed operation and releases the form',async()=>{
 localStorage.setItem(REVIEW_PENDING_PREFIX+facility,'dddddddd-dddd-4ddd-8ddd-dddddddddddd');
 fetchMock.mockImplementation(async url=>url==='/api/review/photo-limits'?{ok:true,json:async()=>caps}:{ok:false,status:429,headers:new Headers({'X-CareLink-Review-Commit':'not-started'}),json:async()=>({code:'REVIEW_RECENT_DUPLICATE',error:'同じ施設への口コミは24時間に1回までです'})});
 await form([]);await submit();await screen.findByText('同じ施設への口コミは24時間に1回までです');
 expect(localStorage.getItem(REVIEW_PENDING_PREFIX+facility)).toBeNull();expect(screen.queryByText(notice)).not.toBeInTheDocument();
});
test('a fresh operation refused before saving releases its fence without a notice',async()=>{
 fetchMock.mockImplementation(async url=>url==='/api/review/photo-limits'?{ok:true,json:async()=>caps}:{ok:false,headers:new Headers({'X-CareLink-Review-Commit':'not-started'}),json:async()=>null});
 await form([]);await submit();await screen.findByText('本文は送信されていません。入力を確認してください。');
 expect(localStorage.getItem(REVIEW_PENDING_PREFIX+facility)).toBeNull();expect(screen.queryByText(notice)).not.toBeInTheDocument();
});
test('an unreadable receipt record never sends and explains in Japanese',async()=>{
 localStorage.setItem(REVIEW_PENDING_PREFIX+facility,'not-an-operation');
 await form([]);await submit();await screen.findByText(/この端末で投稿結果の記録を確認できません/);
 expect(fetchMock.mock.calls.some(c=>c[0]==='/api/review')).toBe(false);
});
test('a known server pre-insert rejection alone permits retry using the already saved photo',async()=>{
 let commits=0;fetchMock.mockImplementation(async url=>url==='/api/review/photo-limits'?{ok:true,json:async()=>caps}:++commits===1?{ok:false,headers:new Headers({'X-CareLink-Review-Commit':'not-started'}),json:async()=>({error:'入力を確認してください'})}:{ok:true,headers:new Headers(),json:async()=>({success:true,id})});
 await form();await submit();await screen.findByText('入力を確認してください');
 expect(localStorage.getItem(REVIEW_PENDING_PREFIX+facility)).toBeNull();expect(screen.getByRole('button',{name:'口コミを投稿する'})).toBeEnabled();
 await submit();await screen.findByText('口コミを投稿しました');expect(upload).toHaveBeenCalledTimes(1);expect(remove).not.toHaveBeenCalled();
 const bodies=fetchMock.mock.calls.filter(c=>c[0]==='/api/review').map(c=>JSON.parse(c[1].body));expect(bodies[1].photo_urls).toEqual(bodies[0].photo_urls);
});
test.each([{success:true},{success:true,id:'bad'},null])('malformed success %p is uncertain, never a success; the operation is kept for a resend',async body=>{
 fetchMock.mockImplementation(async url=>({ok:true,headers:new Headers(),json:async()=>url==='/api/review/photo-limits'?caps:body}));await form();await submit();
 await screen.findByText(/投稿結果を確認できません/);expect(remove).not.toHaveBeenCalled();
 expect(localStorage.getItem(REVIEW_PENDING_PREFIX+facility)).toBe(reviewBodies()[0].operation_id);expect(screen.getByText(notice)).toBeInTheDocument();
});
test('unavailable browser locking prevents commit before HTTP and preserves input',async()=>{
 Object.defineProperty(navigator,'locks',{configurable:true,value:undefined});await form([]);await submit();
 await screen.findByText(/投稿結果の保護を確認できません/);expect(fetchMock).not.toHaveBeenCalled();expect(screen.getByLabelText('コメント')).toHaveValue('Original comment');
});

test('explicit account cleanup wipes in-memory input/files but preserves unknown receipt fence',async()=>{
 fetchMock.mockImplementation(async url=>{if(url==='/api/review')throw new Error('lost accepted reply');return {ok:true,json:async()=>caps};});
 await form();await submit();await screen.findByText(/投稿結果を確認できません/);
 const operation=localStorage.getItem(REVIEW_PENDING_PREFIX+facility);
 fireEvent(window,new Event('review-cleanup-completed'));
 expect(screen.getByLabelText('コメント')).toHaveValue('');expect(screen.queryByAltText('口コミ投稿用プレビュー写真1')).not.toBeInTheDocument();
 expect(localStorage.getItem(REVIEW_PENDING_PREFIX+facility)).toBe(operation);expect(screen.getByText(notice)).toBeInTheDocument();
});
