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
test.each([[{data:{user:null},error:null},401],[{data:{user:{id:'actor'}},error:{message:'partial'}},503]])('unverified authentication %j does not read Storage metadata',async (response,status)=>{
 auth.mockResolvedValue(response);expect((await GET(new Request('http://localhost'))).status).toBe(status);expect(getBucket).not.toHaveBeenCalled();
});
test('missing bucket or metadata errors do not publish guessed limits',async()=>{
 getBucket.mockResolvedValue({data:null,error:{message:'missing bucket'}});expect((await GET(new Request('http://localhost'))).status).toBe(503);
});


test.each(['data-error','null-error','throw'])('GET uncertain auth %s blocks private data access and event writes',async fault=>{
 if(fault==='throw') auth.mockRejectedValue(new Error('private-auth-diagnostic'));
 else auth.mockResolvedValue({data:{user:fault==='data-error'?{id:'synthetic-user'}:null},error:{message:'private-auth-diagnostic'}});
 const response=await GET(new Request('https://carelink.invalid'));
 expect(response.status).toBe(503);expect(response.headers.get('cache-control')).toBe('no-store');expect(await response.json()).toMatchObject({code:'AUTH_UNAVAILABLE'});
 expect(getBucket).not.toHaveBeenCalled();
});
