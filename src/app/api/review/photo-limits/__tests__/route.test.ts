/** @jest-environment node */
jest.mock('@/lib/rate-limit',()=>({checkRateLimit:async()=>false}));
const auth=jest.fn(),getBucket=jest.fn();
jest.mock('@/lib/supabase-server-auth',()=>({createServerSupabaseAuthClient:async()=>({auth:{getUser:auth}})}));
jest.mock('@/lib/supabase-server',()=>({createServiceRoleClient:()=>({storage:{getBucket}})}));
import { GET } from '../route';
beforeEach(()=>{jest.clearAllMocks();auth.mockResolvedValue({data:{user:{id:'actor'}},error:null});getBucket.mockResolvedValue({data:{id:'review-photos',public:true,file_size_limit:50,allowed_mime_types:['image/png']},error:null});});
test('actual authenticated bucket settings are bounded, no-store and preserve stricter MIME/size',async()=>{
 const res=await GET(new Request('http://localhost'));expect(res.status).toBe(200);expect(await res.json()).toEqual({consumerVersion:1,maxBytes:50,mimeTypes:['image/png']});expect(res.headers.get('Cache-Control')).toBe('no-store');
});
test.each([{data:{user:null},error:null},{data:{user:{id:'actor'}},error:{message:'partial'}}])('unverified authentication does not read Storage metadata',async response=>{
 auth.mockResolvedValue(response);expect((await GET(new Request('http://localhost'))).status).toBe(401);expect(getBucket).not.toHaveBeenCalled();
});
test('missing bucket or metadata errors do not publish guessed limits',async()=>{
 getBucket.mockResolvedValue({data:null,error:{message:'missing bucket'}});expect((await GET(new Request('http://localhost'))).status).toBe(503);
});
