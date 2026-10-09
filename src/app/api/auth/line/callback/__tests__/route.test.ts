/** @jest-environment node */
jest.mock('@/lib/rate-limit',()=>({checkRateLimit:jest.fn()}));
jest.mock('@/lib/supabase-server');
jest.mock('@supabase/ssr');
jest.mock('next/headers');
jest.mock('@/lib/supabase-server-auth',()=>({createServerSupabaseAuthClient:jest.fn()}));
jest.mock('@/lib/safe',()=>({safeCaptureException:jest.fn()}));
jest.mock('@/lib/alert',()=>({alertCaughtError:jest.fn()}));
import {createHmac} from 'crypto';
import {checkRateLimit} from '@/lib/rate-limit';
import {createServiceRoleClient} from '@/lib/supabase-server';
import {createServerClient} from '@supabase/ssr';
import {cookies} from 'next/headers';
import {GET} from '../route';
const actor='c9010000-0000-4000-8000-000000000001';
const other='c9010000-0000-4000-8000-000000000002';
let admin:any;let store:any;let session:any;
function signed(overrides:object={},header:object={alg:'HS256'}) {
 const h=Buffer.from(JSON.stringify(header)).toString('base64url');
 const p=Buffer.from(JSON.stringify({iss:'https://access.line.me',sub:'U_actor',aud:'channel',exp:Date.now()/1000+3600,...overrides})).toString('base64url');
 return `${h}.${p}.${createHmac('sha256','secret').update(`${h}.${p}`).digest('base64url')}`;
}
function provider(token:object={access_token:'provider-token'},profile:unknown={userId:'U_actor',displayName:'Synthetic'}) {
 global.fetch=jest.fn((url:string)=>Promise.resolve(new Response(JSON.stringify(url.includes('/token')?token:profile))));
}
function setup(owned=false) {
 store={get:jest.fn((name:string)=>name==='line_oauth_state'?{value:'state'}:name==='line_oauth_redirect'?{value:'/mypage'}:undefined),delete:jest.fn(),getAll:jest.fn(()=>[]),set:jest.fn()};
 (cookies as jest.Mock).mockResolvedValue(store);
 admin={from:jest.fn((table:string)=>{const q:any={};q.select=jest.fn(()=>q);q.eq=jest.fn(()=>q);q.maybeSingle=jest.fn().mockResolvedValue({data:owned?(table==='profiles'?{id:actor}:{user_id:actor,proof_version:1,verified_at:'2026-10-09T00:00:00Z'}):null,error:null});return q;}),
 rpc:jest.fn((name:string)=>Promise.resolve({data:name==='find_trusted_line_auth_user'?(admin.auth.admin.createUser.mock.calls.length?actor:null):name==='line_identity_requires_reconfirmation'?false:'linked',error:null})),
 auth:{admin:{createUser:jest.fn().mockResolvedValue({data:{user:{id:actor}},error:null}),getUserById:jest.fn().mockResolvedValue({data:{user:{id:actor,email:'synthetic@example.invalid',user_metadata:{}}},error:null}),generateLink:jest.fn().mockResolvedValue({data:{user:{id:actor},properties:{hashed_token:'hash'}},error:null}),updateUserById:jest.fn()}}};
 (createServiceRoleClient as jest.Mock).mockReturnValue(admin);
 session={auth:{verifyOtp:jest.fn().mockResolvedValue({data:{user:{id:actor}},error:null})}};
 (createServerClient as jest.Mock).mockReturnValue(session);
 provider();
}
function request(query='?code=code&state=state',ip:string|null='192.0.2.1'):any {return new Request(`https://example.invalid/api/auth/line/callback${query}`,{headers:ip?{'x-forwarded-for':ip}:{}});}
async function run(){return GET(request());}
beforeEach(()=>{jest.clearAllMocks();(checkRateLimit as jest.Mock).mockResolvedValue(false);process.env.NEXT_PUBLIC_LINE_CHANNEL_ID='channel';process.env.LINE_CHANNEL_SECRET='secret';process.env.NEXT_PUBLIC_SUPABASE_URL='https://test.supabase.co';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='test';setup();});
test('rate limit stops all provider/identity operations',async()=>{(checkRateLimit as jest.Mock).mockResolvedValue(true);expect((await run()).headers.get('location')).toContain('too_many_requests');expect(fetch).not.toHaveBeenCalled();});
test.each(['?error=access_denied','?code=code','?state=state','?code=code&state=wrong','?code=code&state=very-long-wrong'])('OAuth refusal %s',async q=>{expect((await GET(request(q))).headers.get('location')).toContain(q.includes('error=')?'line_denied':'line_invalid_state');expect(fetch).not.toHaveBeenCalled();});
test('missing state cookie never grants Auth',async()=>{store.get.mockReturnValue(undefined);expect((await run()).headers.get('location')).toContain('line_invalid_state');});
test('OAuth cookies consumed before any upstream operation',async()=>{await run();expect(store.delete).toHaveBeenCalledWith('line_oauth_state');expect(store.delete).toHaveBeenCalledWith('line_oauth_redirect');});
test.each([null,'192.0.2.2','untrusted, 192.0.2.3'])('trusted IP rate guard %p',async ip=>{await GET(request(undefined,ip));expect(checkRateLimit).toHaveBeenCalledWith(null,ip===null?'unknown':ip.split(', ').pop(),10,60000,'line-callback');});
test('verified new LINE-only identity records server app metadata and binds before Auth',async()=>{expect((await run()).headers.get('location')).toBe('https://example.invalid/mypage');const input=admin.auth.admin.createUser.mock.calls[0][0];expect(input.app_metadata).toEqual({carelink_line_identity_version:1,carelink_line_user_id:'U_actor'});expect(input.user_metadata).not.toHaveProperty('line_user_id');expect(admin.rpc).toHaveBeenCalledWith('bind_verified_liff_account_atomic',{p_actor_id:actor,p_line_user_id:'U_actor'});expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled();});
test('no provider email uses stable secret-derived synthetic address',async()=>{await run();expect(admin.auth.admin.createUser.mock.calls[0][0].email).toBe(`line_${createHmac('sha256','secret').update('U_actor').digest('hex')}@line.carelink.local`);});
test('channel code exchange and profile use bounded server requests',async()=>{await run();expect((fetch as jest.Mock).mock.calls[0][1]).toMatchObject({method:'POST',signal:expect.any(AbortSignal)});expect((fetch as jest.Mock).mock.calls[1][1]).toMatchObject({headers:{Authorization:'Bearer provider-token'},signal:expect.any(AbortSignal)});});
test.each(['//evil.invalid','/mypage/bookings',''])('saved redirect remains local %p',async redirect=>{const get=store.get.getMockImplementation();store.get.mockImplementation((name:string)=>name==='line_oauth_redirect'?{value:redirect}:get(name));expect((await run()).headers.get('location')).toBe(`https://example.invalid${redirect.startsWith('//')||!redirect?'/mypage':redirect}`);});
test.each(['token-http','token-json','token-empty','token-type','profile-http','profile-json','profile-malformed'])('provider failure %s grants no Auth',async kind=>{global.fetch=jest.fn((url:string)=>{if(url.includes('/token')){if(kind==='token-http')return Promise.resolve(new Response('',{status:500}));if(kind==='token-json')return Promise.resolve(new Response('{'));if(kind==='token-empty')return Promise.resolve(new Response('{}'));if(kind==='token-type')return Promise.resolve(new Response('{"access_token":1}'));return Promise.resolve(new Response('{"access_token":"token"}'));}return Promise.resolve(kind==='profile-http'?new Response('',{status:503}):kind==='profile-json'?new Response('{'):new Response('{}'));});expect((await run()).headers.get('location')).toContain(kind.startsWith('token')?'line_token_failed':'line_profile_failed');expect(admin.auth.admin.createUser).not.toHaveBeenCalled();expect(session.auth.verifyOtp).not.toHaveBeenCalled();});
test('provider throw remains unknown, never emits a magic link',async()=>{global.fetch=jest.fn().mockRejectedValue(new Error('synthetic transport'));expect((await run()).headers.get('location')).toContain('line_unexpected');expect(admin.auth.admin.generateLink).not.toHaveBeenCalled();});
test('valid OIDC email requires signature, channel, subject, issuer and expiry',async()=>{provider({access_token:'token',id_token:signed({email:'verified@example.invalid'})});await run();expect(admin.auth.admin.createUser.mock.calls[0][0].email).toBe('verified@example.invalid');});
test.each([{aud:'other'},{sub:'U_other'},{iss:'https://other.invalid'},{exp:1},{exp:'future'},{email:1},{email:'invalid-email'}])('signed but invalid OIDC claims %p refused',async claims=>{provider({access_token:'token',id_token:signed(claims)});expect((await run()).headers.get('location')).toContain('line_token_invalid');expect(admin.auth.admin.createUser).not.toHaveBeenCalled();});
test.each(['a.b','a.b.c',''])('malformed provided ID token %p refused or absent',async idToken=>{provider({access_token:'token',id_token:idToken});const loc=(await run()).headers.get('location');expect(loc).toContain(idToken?'line_token_invalid':'/mypage');});
test('wrong JWT algorithm refused despite valid HMAC bytes',async()=>{provider({access_token:'token',id_token:signed({},{alg:'none'})});expect((await run()).headers.get('location')).toContain('line_token_invalid');});
test('wrong HMAC signature refused',async()=>{provider({access_token:'token',id_token:signed().replace(/.$/,'!')});expect((await run()).headers.get('location')).toContain('line_token_invalid');});
test('existing verified owner uses its current Auth email without another create',async()=>{setup(true);expect((await run()).headers.get('location')).toContain('/mypage');expect(admin.auth.admin.createUser).not.toHaveBeenCalled();expect(admin.auth.admin.generateLink).toHaveBeenCalledWith({type:'magiclink',email:'synthetic@example.invalid'});});
test('legacy profile or unverified owned row requires Supabase login plus live link proof',async()=>{admin.rpc.mockImplementation((name:string)=>Promise.resolve({data:name==='find_trusted_line_auth_user'?null:true,error:null}));expect((await run()).headers.get('location')).toContain('line_link_required');expect(admin.auth.admin.createUser).not.toHaveBeenCalled();expect(admin.auth.admin.generateLink).not.toHaveBeenCalled();});
test('trusted app marker recovers exact Auth account before any creation',async()=>{admin.rpc.mockImplementation((name:string)=>Promise.resolve({data:name==='find_trusted_line_auth_user'?actor:'linked',error:null}));expect((await run()).headers.get('location')).toContain('/mypage');expect(admin.auth.admin.createUser).not.toHaveBeenCalled();});
test.each([null,actor])('identity lookup data+error %p cannot issue Auth',async data=>{admin.rpc.mockResolvedValue({data,error:{code:'XX000'}});expect((await run()).headers.get('location')).toContain('line_auth_unavailable');expect(admin.auth.admin.generateLink).not.toHaveBeenCalled();});
test.each([false,undefined,{}])('malformed trusted lookup %p fails closed',async data=>{admin.rpc.mockResolvedValue({data,error:null});expect((await run()).headers.get('location')).toContain('line_auth_unavailable');});
test.each([null,undefined,'not-a-boolean'])('malformed legacy verdict %p fails closed',async data=>{admin.rpc.mockImplementation((name:string)=>Promise.resolve({data:name==='find_trusted_line_auth_user'?null:data,error:null}));expect((await run()).headers.get('location')).toContain('line_auth_unavailable');expect(admin.auth.admin.createUser).not.toHaveBeenCalled();});
test('unrelated existing email never causes magic link issuance',async()=>{admin.rpc.mockImplementation((name:string)=>Promise.resolve({data:name==='find_trusted_line_auth_user'?null:false,error:null}));admin.auth.admin.createUser.mockResolvedValue({data:{user:{id:other}},error:{code:'email_exists'}});expect((await run()).headers.get('location')).toContain('line_link_required');expect(admin.auth.admin.generateLink).not.toHaveBeenCalled();});
test('lost create response recovers only exact trusted app marker',async()=>{admin.auth.admin.createUser.mockResolvedValue({data:null,error:{code:'request_failed'}});let lookups=0;admin.rpc.mockImplementation((name:string)=>Promise.resolve({data:name==='find_trusted_line_auth_user'?(++lookups===1?null:actor):name==='line_identity_requires_reconfirmation'?false:'linked',error:null}));expect((await run()).headers.get('location')).toContain('/mypage');expect(admin.auth.admin.createUser).toHaveBeenCalledTimes(1);});
test.each(['conflict',null,'invalid'])('binding result %p never establishes Auth',async data=>{setup(true);admin.rpc.mockResolvedValue({data,error:null});expect((await run()).headers.get('location')).toContain('line_link_required');expect(admin.auth.admin.generateLink).not.toHaveBeenCalled();expect(session.auth.verifyOtp).not.toHaveBeenCalled();});
test('binding data+error cannot establish Auth',async()=>{setup(true);admin.rpc.mockResolvedValue({data:'linked',error:{code:'XX000'}});expect((await run()).headers.get('location')).toContain('line_link_required');expect(session.auth.verifyOtp).not.toHaveBeenCalled();});
test.each([{data:{user:null},error:null},{data:{user:{id:other,email:'other@example.invalid'}},error:null},{data:{user:{id:actor,email:null}},error:null},{data:{user:{id:actor,email:'ok@example.invalid'}},error:{code:'XX000'}}])('Auth lookup unexpected/error %p cannot issue a link',async result=>{admin.auth.admin.getUserById.mockResolvedValue(result);expect((await run()).headers.get('location')).toContain('line_auth_unavailable');expect(admin.auth.admin.generateLink).not.toHaveBeenCalled();});
test.each([{data:null,error:{code:'XX000'}},{data:{user:{id:actor},properties:{}},error:null},{data:{user:{id:other},properties:{hashed_token:'hash'}},error:null},{data:{user:null,properties:{hashed_token:'hash'}},error:null}])('magic link proof %p requires exact actor',async result=>{admin.auth.admin.generateLink.mockResolvedValue(result);expect((await run()).headers.get('location')).toContain('line_auth_failed');expect(session.auth.verifyOtp).not.toHaveBeenCalled();});
test('verify OTP failure cannot claim a login',async()=>{session.auth.verifyOtp.mockResolvedValue({error:{code:'XX000'}});expect((await run()).headers.get('location')).toContain('line_session_failed');});
test('SSR cookie writer preserves session and catches Server Component restriction',async()=>{store.set.mockImplementation(()=>{throw new Error('Server Component');});(createServerClient as jest.Mock).mockImplementation((_url,_key,opts)=>{expect(opts.cookies.getAll()).toEqual([]);opts.cookies.setAll([{name:'sb-session',value:'test',options:{}}]);return session;});expect((await run()).headers.get('location')).toContain('line_session_failed');expect(store.set).toHaveBeenCalled();});

function linkMode(user:any={id:actor},error:any=null) {
 const previous=store.get.getMockImplementation();store.get.mockImplementation((name:string)=>name==='line_oauth_link_actor'?{value:actor}:previous(name));
 require('@/lib/supabase-server-auth').createServerSupabaseAuthClient.mockResolvedValue({auth:{getUser:jest.fn().mockResolvedValue({data:{user},error})}});
}
test('explicit link reconfirms the same Supabase account and live provider identity without issuing Auth',async()=>{
 linkMode();expect((await run()).headers.get('location')).toContain('/mypage');
 expect(admin.rpc).toHaveBeenCalledWith('bind_verified_liff_account_atomic',{p_actor_id:actor,p_line_user_id:'U_actor'});
 expect(admin.auth.admin.createUser).not.toHaveBeenCalled();expect(admin.auth.admin.generateLink).not.toHaveBeenCalled();expect(session.auth.verifyOtp).not.toHaveBeenCalled();
 expect(store.delete).toHaveBeenCalledWith('line_oauth_link_actor');
});
test.each([null,{id:other}])('link callback current actor %p cannot bind the saved actor',async user=>{
 linkMode(user);expect((await run()).headers.get('location')).toContain('line_link_required');expect(fetch).not.toHaveBeenCalled();expect(admin.rpc).not.toHaveBeenCalled();
});
test('link callback Auth data+error cannot grant a binding',async()=>{linkMode({id:actor},{status:503});expect((await run()).headers.get('location')).toContain('line_auth_unavailable');expect(admin.rpc).not.toHaveBeenCalled();});
test.each([{data:'linked',error:{code:'XX000'}},{data:null,error:null},{data:'unexpected',error:null}])('link callback ambiguous mutation %p remains unknown',async result=>{linkMode();admin.rpc.mockResolvedValue(result);expect((await run()).headers.get('location')).toContain('line_auth_unavailable');expect(admin.auth.admin.generateLink).not.toHaveBeenCalled();});
test('link callback conflicting owner does not switch either account',async()=>{linkMode();admin.rpc.mockResolvedValue({data:'conflict',error:null});expect((await run()).headers.get('location')).toContain('line_link_required');expect(admin.auth.admin.generateLink).not.toHaveBeenCalled();});
test('SDK create throw can recover only the trusted identity marker',async()=>{
 admin.auth.admin.createUser.mockRejectedValue(new Error('lost response'));let lookups=0;
 admin.rpc.mockImplementation((name:string)=>Promise.resolve({data:name==='find_trusted_line_auth_user'?(++lookups===1?null:actor):name==='line_identity_requires_reconfirmation'?false:'linked',error:null}));
 expect((await run()).headers.get('location')).toContain('/mypage');expect(admin.auth.admin.createUser).toHaveBeenCalledTimes(1);
});
test('unconfirmed creation cannot become a successful login or a fresh-user assertion',async()=>{admin.rpc.mockImplementation((name:string)=>Promise.resolve({data:name==='find_trusted_line_auth_user'?null:false,error:null}));
 admin.auth.admin.createUser.mockResolvedValue({data:null,error:{code:'request_failed'}});expect((await run()).headers.get('location')).toContain('line_auth_unavailable');expect(admin.auth.admin.generateLink).not.toHaveBeenCalled();
});

test.each([null,{id:other},{id:actor}])('SDK cookie writes are not published on error or wrong-user result %p',async user=>{
 (createServerClient as jest.Mock).mockImplementation((_url,_key,opts)=>({auth:{verifyOtp:jest.fn().mockImplementation(async()=>{opts.cookies.setAll([{name:'sb-session',value:'test',options:{}}]);return {data:{user},error:user?.id===actor?{code:'XX000'}:null};})}}));
 expect((await run()).headers.get('location')).toContain('line_session_failed');expect(store.set).not.toHaveBeenCalled();
});
test('SDK cookies publish only after the exact actor result and ignore later changes',async()=>{
 let write:any;(createServerClient as jest.Mock).mockImplementation((_url,_key,opts)=>{write=opts.cookies.setAll;return {auth:{verifyOtp:jest.fn().mockImplementation(async()=>{write([{name:'sb-session',value:'confirmed',options:{}}]);return {data:{user:{id:actor}},error:null};})}};});
 expect((await run()).headers.get('location')).toContain('/mypage');expect(store.set).toHaveBeenCalledWith('sb-session','confirmed',{});
 write([{name:'sb-session',value:'late',options:{}}]);expect(store.set).toHaveBeenCalledTimes(1);
});

test('signed OIDC with no email uses the trusted synthetic creation path',async()=>{provider({access_token:'token',id_token:signed()});expect((await run()).headers.get('location')).toContain('/mypage');expect(admin.auth.admin.createUser.mock.calls[0][0].email).toContain('@line.carelink.local');});

test('ambiguous trusted Auth recovery stops before creation, binding or session issuance',async()=>{
 admin.rpc.mockResolvedValue({data:null,error:{code:'P0001',message:'LINE_AUTH_IDENTITY_AMBIGUOUS'}});
 expect((await run()).headers.get('location')).toContain('line_auth_unavailable');expect(admin.auth.admin.createUser).not.toHaveBeenCalled();expect(admin.auth.admin.generateLink).not.toHaveBeenCalled();expect(session.auth.verifyOtp).not.toHaveBeenCalled();
});
test.each([{data:null,error:{code:'P0001',message:'LINE_AUTH_IDENTITY_AMBIGUOUS'}},{data:actor,error:{code:'XX000'}},{data:other,error:null},{data:null,error:null}])('creation response cannot override ambiguous/missing/wrong trusted DB result %p',async result=>{
 let lookups=0;admin.rpc.mockImplementation((name:string)=>Promise.resolve(name==='find_trusted_line_auth_user'?(++lookups===1?{data:null,error:null}:result):{data:false,error:null}));
 expect((await run()).headers.get('location')).toContain('line_auth_unavailable');expect(admin.auth.admin.createUser).toHaveBeenCalledTimes(1);expect(admin.rpc.mock.calls.some(call=>call[0]==='bind_verified_liff_account_atomic')).toBe(false);expect(admin.auth.admin.generateLink).not.toHaveBeenCalled();expect(session.auth.verifyOtp).not.toHaveBeenCalled();
});
test('lost creation with duplicate markers is unavailable even if original SDK error is email-exists',async()=>{
 admin.auth.admin.createUser.mockResolvedValue({data:null,error:{code:'email_exists'}});let lookups=0;
 admin.rpc.mockImplementation((name:string)=>Promise.resolve(name==='find_trusted_line_auth_user'?(++lookups===1?{data:null,error:null}:{data:null,error:{code:'P0001',message:'LINE_AUTH_IDENTITY_AMBIGUOUS'}}):{data:false,error:null}));
 expect((await run()).headers.get('location')).toContain('line_auth_unavailable');expect(admin.auth.admin.generateLink).not.toHaveBeenCalled();
});
