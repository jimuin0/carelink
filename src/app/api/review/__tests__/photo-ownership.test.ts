/** @jest-environment node */
jest.mock('@/lib/rate-limit',()=>({checkRateLimit:async()=>false,mutationRateLimit:null}));
jest.mock('@/lib/csrf',()=>({checkCsrf:()=>null}));
jest.mock('@/lib/recaptcha',()=>({verifyRecaptcha:async()=>({success:true})}));
jest.mock('next/headers',()=>({cookies:async()=>({getAll:()=>[]})}));
const getUser=jest.fn(),rpc=jest.fn(),from=jest.fn();
jest.mock('@supabase/ssr',()=>({createServerClient:()=>({auth:{getUser}})}));
jest.mock('@/lib/supabase-server',()=>({createServiceRoleClient:()=>({from,rpc,storage:{getBucket:async()=>({data:{id:'review-photos',public:true,file_size_limit:5242880,allowed_mime_types:null},error:null})}})}));
import { POST } from '../route';
const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',facility='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function request(){return new Request('http://localhost/api/review',{method:'POST',headers:{'Content-Type':'application/json','X-CareLink-Review-Consumer':'1'},body:JSON.stringify({facility_id:facility,reviewer_name:'Synthetic',rating_skill:5,rating_service:5,rating_atmosphere:5,rating_cleanliness:5,rating_explanation:5,photo_urls:[`https://test.supabase.co/storage/v1/object/public/review-photos/reviews/${facility}/other.png`]})});}
beforeEach(()=>{jest.clearAllMocks();process.env.NEXT_PUBLIC_SUPABASE_URL='https://test.supabase.co';delete process.env.RECAPTCHA_SECRET_KEY;getUser.mockResolvedValue({data:{user:{id:actor}},error:null});});
test('modified body cannot attach another actor public image even with a valid compatibility marker',async()=>{
 rpc.mockResolvedValue({data:[],error:null});const res=await POST(request());expect(res.status).toBe(400);expect(res.headers.get('X-CareLink-Review-Commit')).toBe('not-started');expect(from).not.toHaveBeenCalled();
});
test('new API deployed before owner-verification DDL safely refuses before review mutation',async()=>{
 rpc.mockResolvedValue({data:null,error:{code:'PGRST202',message:'function missing'}});const res=await POST(request());expect(res.status).toBe(503);expect(res.headers.get('X-CareLink-Review-Commit')).toBe('not-started');expect(from).not.toHaveBeenCalled();
});
test('anonymous photo attachment has no owner authority',async()=>{
 getUser.mockResolvedValue({data:{user:null},error:null});const res=await POST(request());expect(res.status).toBe(400);expect(rpc).not.toHaveBeenCalled();expect(from).not.toHaveBeenCalled();
});
