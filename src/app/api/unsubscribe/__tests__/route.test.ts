/** @jest-environment node */
import {createHmac} from 'crypto';
jest.mock('@/lib/csrf',()=>({checkCsrf:jest.fn(()=>null)}));jest.mock('@/lib/rate-limit',()=>({checkRateLimit:jest.fn(()=>false)}));
const mockRpc=jest.fn();jest.mock('@/lib/supabase-server',()=>({createServiceRoleClient:()=>({rpc:mockRpc})}));
import {POST} from '../route';import {encryptUnsubEmail} from '@/lib/newsletter-unsub';import {checkRateLimit} from '@/lib/rate-limit';import {checkCsrf} from '@/lib/csrf';
const secret='synthetic-newsletter-test-secret';const email='fixture@example.invalid';const token='a'.repeat(64);const hmac=()=>createHmac('sha256',secret).update(email).digest('hex');
const request=(body:unknown)=>new Request('http://localhost/api/unsubscribe',{method:'POST',body:JSON.stringify(body)});
beforeEach(()=>{jest.clearAllMocks();process.env.NEWSLETTER_UNSUBSCRIBE_SECRET=secret;(checkRateLimit as jest.Mock).mockReturnValue(false);(checkCsrf as jest.Mock).mockReturnValue(null);mockRpc.mockResolvedValue({data:{success:true,already:false},error:null});});
test('valid encrypted URL uses one atomic transaction',async()=>{expect((await POST(request({n:encryptUnsubEmail(email)}))).status).toBe(200);expect(mockRpc).toHaveBeenCalledWith('unsubscribe_newsletter_atomic',{p_email:email,p_token:null});});
test('legacy HMAC verified before suppression',async()=>{expect((await POST(request({email,hmac:hmac()}))).status).toBe(200);expect(mockRpc).toHaveBeenCalledWith('unsubscribe_newsletter_atomic',{p_email:email,p_token:null});});
test('legacy DB token lookup/consumption is atomic',async()=>{expect((await POST(request({token}))).status).toBe(200);expect(mockRpc).toHaveBeenCalledWith('unsubscribe_newsletter_atomic',{p_email:null,p_token:token});});
test.each([{n:'malformed'}, {email,hmac:'b'.repeat(64)}])('invalid authorization remains enumeration-safe %p',async body=>{expect(await (await POST(request(body))).json()).toEqual({success:true,already:true});expect(mockRpc).not.toHaveBeenCalled();});
test.each([{n:'malformed'},{email,hmac:'a'.repeat(64)}])('missing verification key is visible dependency failure %p',async body=>{delete process.env.NEWSLETTER_UNSUBSCRIBE_SECRET;expect((await POST(request(body))).status).toBe(503);expect(mockRpc).not.toHaveBeenCalled();});
test.each([undefined,null,[],{success:true},{success:false,already:false}])('malformed receipt fails %p',async data=>{mockRpc.mockResolvedValue({data,error:null});expect((await POST(request({token}))).status).toBe(500);});
test('SDK data plus error is not success',async()=>{mockRpc.mockResolvedValue({data:{success:true,already:false},error:{code:'40001'}});expect((await POST(request({token}))).status).toBe(500);});
test('SQL missing / network never falls back to partial updates',async()=>{mockRpc.mockRejectedValue(new Error('network'));expect((await POST(request({token}))).status).toBe(500);expect(mockRpc).toHaveBeenCalledTimes(1);});
test('repeated valid URL preserves idempotent already receipt',async()=>{mockRpc.mockResolvedValue({data:{success:true,already:true},error:null});expect(await (await POST(request({token}))).json()).toEqual({success:true,already:true});});
test('bad token format rejects',async()=>{expect((await POST(request({token:'bad'}))).status).toBe(400);expect(mockRpc).not.toHaveBeenCalled();});
test('CSRF and rate limits remain',async()=>{(checkCsrf as jest.Mock).mockReturnValue(new Response('',{status:403}));expect((await POST(request({token}))).status).toBe(403);(checkCsrf as jest.Mock).mockReturnValue(null);(checkRateLimit as jest.Mock).mockReturnValue(true);expect((await POST(request({token}))).status).toBe(429);});

test('unexpected cryptographic comparison failure is visible and never consumes suppression',async()=>{
 const crypto = require('crypto'); const signed = hmac();
 const compare = jest.spyOn(crypto,'timingSafeEqual').mockImplementation(()=>{throw new Error('crypto unavailable');});
 try { expect((await POST(request({email,hmac:signed}))).status).toBe(500);expect(mockRpc).not.toHaveBeenCalled(); }
 finally { compare.mockRestore(); }
});
