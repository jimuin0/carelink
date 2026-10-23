/** @jest-environment node */
jest.mock('@/lib/supabase-server-auth');jest.mock('@/lib/supabase-server');
jest.mock('@/lib/rate-limit',()=>({checkRateLimit:jest.fn(()=>false)}));jest.mock('@/lib/csrf',()=>({checkCsrf:jest.fn(()=>null)}));
jest.mock('@/lib/safe',()=>({safeCaptureException:jest.fn()}));jest.mock('@/lib/alert',()=>({alertCaughtError:jest.fn()}));
jest.mock('@/lib/gbp',()=>({fetchPlaceDetails:jest.fn(),calculateGbpScore:jest.fn(()=>({score:80,items:[]}))}));
jest.mock('@/lib/gbp-place-release',()=>({releaseMismatchedGbpPlace:jest.fn()}));
import {NextRequest} from 'next/server';import {GET,POST} from '../route';
import {createServerSupabaseAuthClient} from '@/lib/supabase-server-auth';import {createServiceRoleClient} from '@/lib/supabase-server';
import {releaseMismatchedGbpPlace} from '@/lib/gbp-place-release';import {checkRateLimit} from '@/lib/rate-limit';import {checkCsrf} from '@/lib/csrf';import {fetchPlaceDetails,calculateGbpScore} from '@/lib/gbp';
const id='22222222-2222-4222-8222-222222222222',other='44444444-4444-4444-8444-444444444444',user='33333333-3333-4333-8333-333333333333';
const rpc=jest.fn(),getUser=jest.fn(),read=jest.fn(),members=jest.fn();
function get(query=''){return GET(new NextRequest('http://localhost/api/admin/gbp/place'+query));}
function post(body:unknown={gbp_place_id:'NewPlace'}){return POST(new NextRequest('http://localhost/api/admin/gbp/place',{method:'POST',body:JSON.stringify(body)}));}
beforeEach(()=>{jest.clearAllMocks();(checkRateLimit as jest.Mock).mockReturnValue(false);(checkCsrf as jest.Mock).mockReturnValue(null);getUser.mockResolvedValue({data:{user:{id:user}},error:null});members.mockResolvedValue({data:[{facility_id:id}],error:null});read.mockResolvedValue({data:{gbp_place_id:'OldPlace',name:'Synthetic',phone:'03-1234-5678',business_hours:null},error:null});rpc.mockResolvedValue({data:{id,facility_id:id},error:null});(fetchPlaceDetails as jest.Mock).mockResolvedValue({rating:4,user_ratings_total:8,formatted_phone_number:'03-1234-5678'});
(createServerSupabaseAuthClient as jest.Mock).mockResolvedValue({auth:{getUser},from:(table:string)=>table==='facility_members'?{select:()=>({eq:()=>({in:members})})}:{select:()=>({eq:()=>({maybeSingle:read})})}});(createServiceRoleClient as jest.Mock).mockReturnValue({rpc});(releaseMismatchedGbpPlace as jest.Mock).mockResolvedValue('released');});
describe.each(['GET','POST'])('%s guards',method=>{const run=()=>method==='GET'?get():post();
 test('CSRF before all access',async()=>{(checkCsrf as jest.Mock).mockReturnValueOnce(new Response('{}',{status:403}));expect((await run()).status).toBe(403);expect(getUser).not.toHaveBeenCalled();});
 test('rate limit',async()=>{(checkRateLimit as jest.Mock).mockReturnValueOnce(true);expect((await run()).status).toBe(429);expect(getUser).not.toHaveBeenCalled();});
 test('missing user',async()=>{getUser.mockResolvedValue({data:{user:null},error:null});expect((await run()).status).toBe(401);expect(rpc).not.toHaveBeenCalled();});
 test('auth unavailable',async()=>{getUser.mockResolvedValue({data:{user:null},error:{status:503}});expect((await run()).status).toBe(503);});
 test('no membership',async()=>{members.mockResolvedValue({data:[],error:null});expect((await run()).status).toBe(403);});
 test('ambiguous facilities',async()=>{members.mockResolvedValue({data:[{facility_id:id},{facility_id:other}],error:null});expect((await run()).status).toBe(400);});
 test('foreign facility',async()=>{expect((await (method==='GET'?get('?facility_id='+other):post({facility_id:other}))).status).toBe(403);});
 test('explicit facility',async()=>{members.mockResolvedValue({data:[{facility_id:id},{facility_id:other}],error:null});expect((await (method==='GET'?get('?facility_id='+id):post({facility_id:id}))).status).toBe(200);});
 test('membership database failure stops',async()=>{members.mockResolvedValue({data:[{facility_id:id}],error:{code:'08006'}});expect((await run()).status).toBe(500);expect(rpc).not.toHaveBeenCalled();});
});
test('missing facility is 404',async()=>{read.mockResolvedValue({data:null,error:null});expect((await get()).status).toBe(404);});
test('read outage cannot claim missing facility',async()=>{read.mockResolvedValue({data:null,error:{code:'08006',message:'private'}});expect((await get()).status).toBe(500);expect(rpc).not.toHaveBeenCalled();});
test('missing stored place avoids provider and write',async()=>{read.mockResolvedValue({data:{name:'Synthetic',gbp_place_id:null},error:null});(fetchPlaceDetails as jest.Mock).mockResolvedValue(null);const r=await get();expect(r.status).toBe(200);expect(fetchPlaceDetails).not.toHaveBeenCalled();expect(rpc).not.toHaveBeenCalled();});
test('provider unavailable never overwrites ratings',async()=>{(fetchPlaceDetails as jest.Mock).mockResolvedValue(null);expect((await get()).status).toBe(200);expect(rpc).not.toHaveBeenCalled();});
test('client cannot substitute a foreign place; snapshot bound to stored place',async()=>{const r=await get('?placeId=Forged');expect(r.status).toBe(200);expect(fetchPlaceDetails).toHaveBeenCalledWith('OldPlace');expect(rpc).toHaveBeenCalledWith('save_admin_facility_integration_atomic',expect.objectContaining({p_expected:{place_id:'OldPlace'},p_values:expect.objectContaining({rating:4,review_count:8})}));});
test.each([null,'hours',[],{monday:'9-17'}])('business hours shape %p',async hours=>{read.mockResolvedValue({data:{gbp_place_id:'OldPlace',phone:'03-1234-5678',business_hours:hours},error:null});await get();expect(calculateGbpScore).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({business_hours:hours && typeof hours==='object' && !Array.isArray(hours)?hours:null}));});
test('missing provider rating/count normalizes to null/zero',async()=>{(fetchPlaceDetails as jest.Mock).mockResolvedValue({formatted_phone_number:'03-1234-5678'});await get();expect(rpc.mock.calls[0][1].p_values).toEqual(expect.objectContaining({rating:null,review_count:0}));});
test('provider throws becomes bounded 500',async()=>{(fetchPlaceDetails as jest.Mock).mockRejectedValue(new Error('synthetic'));expect((await get()).status).toBe(500);});
test.each([['42501',403],['40001',409],['P0002',404],['08006',500]])('atomic save failure %s is visible',async(code,status)=>{rpc.mockResolvedValue({data:null,error:{code}});expect((await get()).status).toBe(status);});
test('post saves scoped normalized identifiers',async()=>{expect((await post({gbp_place_id:'NewPlace',gbp_cid:'123'})).status).toBe(200);expect(rpc.mock.calls[0][1]).toEqual({p_actor_id:user,p_facility_id:id,p_kind:'gbp:connect',p_expected:{identity:{name:'Synthetic',phone:'03-1234-5678',postal_code:null,prefecture:null,city:null,address:null}},p_values:{place_id:'NewPlace',cid:'123'}});});
test('post no fields preserves existing clear operation',async()=>{await post({});expect(rpc.mock.calls[0][1].p_values).toEqual({place_id:null,cid:null});expect(rpc.mock.calls[0][1].p_expected).toEqual({});});
// 回帰（PR #790 レビュー）: 照会の間に店名・電話・住所が変わったら、古い照合結果で保存しない。
// 照合に使った登録内容を p_expected.identity で渡し、DB が行ロックのうえ食い違いを 40001 で断る → 409。
test('identity changed during the Google lookup is refused (stale verification)',async()=>{rpc.mockResolvedValue({data:null,error:{code:'40001'}});const r=await post({gbp_place_id:'NewPlace'});expect(r.status).toBe(409);expect(rpc.mock.calls[0][1].p_expected.identity).toEqual({name:'Synthetic',phone:'03-1234-5678',postal_code:null,prefecture:null,city:null,address:null});});
test('malformed JSON cannot clear the saved connection',async()=>{expect((await POST(new NextRequest('http://localhost/api/admin/gbp/place',{method:'POST',body:'invalid {'}))).status).toBe(400);expect(rpc).not.toHaveBeenCalled();});
test.each([null,[],false,1])('reject non-object body %p',async body=>{expect((await post(body)).status).toBe(400);expect(rpc).not.toHaveBeenCalled();});
test.each([{gbp_place_id:0},{gbp_place_id:false},{gbp_cid:{}},{gbp_place_id:'bad/'},{gbp_place_id:'a'.repeat(301)},{gbp_cid:'bad/'},{gbp_cid:'a'.repeat(65)}])('invalid connection body %p',async body=>{expect((await post(body)).status).toBe(400);expect(rpc).not.toHaveBeenCalled();});
test('300-character Place ID and 64-character CID remain valid',async()=>{expect((await post({gbp_place_id:'a'.repeat(300),gbp_cid:'a'.repeat(64)})).status).toBe(200);});
test('post RPC error cannot claim success',async()=>{rpc.mockResolvedValue({data:null,error:{code:'P0002'}});expect((await post()).status).toBe(404);});

// 回帰（2026年10月23日）: 他店の Place ID を保存すると、その店舗の Google 評価が自店の掲載に出ていた。
// 保存時に Google の店舗情報を取り、施設の登録内容（電話番号、または店舗名＋住所）と合うものだけを受け付ける。
const OTHER_SHOP={name:'評価の高い別の医院',rating:4.9,user_ratings_total:2000,formatted_phone_number:'06-9999-0000',formatted_address:'日本、〒530-0001 大阪府大阪市北区梅田1丁目1−1'};
describe('saving a Place ID checks that the Google listing is this facility',()=>{
 test('another business is refused before anything is stored',async()=>{
  (fetchPlaceDetails as jest.Mock).mockResolvedValue(OTHER_SHOP);
  const r=await post({gbp_place_id:'ChIJOtherBusiness'});expect(r.status).toBe(422);
  const body=await r.json();expect(body.code).toBe('GBP_PLACE_MISMATCH');expect(body.error).toContain('CareLink までお問い合わせください');
  expect(fetchPlaceDetails).toHaveBeenCalledWith('ChIJOtherBusiness');expect(rpc).not.toHaveBeenCalled();
 });
 test('a listing Google cannot return (wrong ID or provider outage) is refused, not stored unchecked',async()=>{
  (fetchPlaceDetails as jest.Mock).mockResolvedValue(null);
  const r=await post({gbp_place_id:'ChIJUnknown'});expect(r.status).toBe(422);expect((await r.json()).code).toBe('GBP_PLACE_UNVERIFIED');expect(rpc).not.toHaveBeenCalled();
 });
 test('the own listing is accepted by name and address when the phone differs',async()=>{
  read.mockResolvedValue({data:{name:'さくら整骨院',phone:null,prefecture:'東京都',city:'渋谷区',address:'渋谷1-2-3'},error:null});
  (fetchPlaceDetails as jest.Mock).mockResolvedValue({name:'さくら整骨院 渋谷院',formatted_phone_number:'03-0000-0000',formatted_address:'日本、〒150-0002 東京都渋谷区渋谷１丁目２−３'});
  expect((await post({gbp_place_id:'ChIJOwn'})).status).toBe(200);expect(rpc.mock.calls[0][1].p_values).toEqual({place_id:'ChIJOwn',cid:null});
 });
 test('the facility read failing stops the save',async()=>{
  read.mockResolvedValue({data:null,error:{code:'08006',message:'private'}});
  expect((await post()).status).toBe(500);expect(fetchPlaceDetails).not.toHaveBeenCalled();expect(rpc).not.toHaveBeenCalled();
 });
 test('a missing facility is 404 before calling Google',async()=>{
  read.mockResolvedValue({data:null,error:null});
  expect((await post()).status).toBe(404);expect(fetchPlaceDetails).not.toHaveBeenCalled();
 });
 test('clearing the Place ID needs no lookup',async()=>{
  expect((await post({gbp_place_id:'',gbp_cid:''})).status).toBe(200);expect(fetchPlaceDetails).not.toHaveBeenCalled();expect(read).not.toHaveBeenCalled();
 });
 test('the same Place ID on another facility is refused with its own message',async()=>{
  rpc.mockResolvedValue({data:null,error:{code:'23505'}});
  const r=await post();expect(r.status).toBe(409);expect((await r.json()).code).toBe('GBP_PLACE_TAKEN');
 });
});
// 回帰（2026年10月23日・レビュー指摘）: 照合が外れても評価を消すだけで Place ID を残していたため、店舗ページの地図・
// 口コミのリンクは他店を指し続け、一意索引がその ID を占有して本物の店舗が登録できなかった。Place ID ごと外す。
describe('refreshing a stored Place ID that is not this facility detaches it instead of copying the rating',()=>{
 test('the Place ID is released (with rating and audit), nothing from the other business is written, and the screen is told why',async()=>{
  (fetchPlaceDetails as jest.Mock).mockResolvedValue(OTHER_SHOP);
  const r=await get();expect(r.status).toBe(200);
  const body=await r.json();expect(body).toEqual(expect.objectContaining({placeData:null,ownershipMismatch:true,released:true}));
  expect(body.notice).toContain('登録を解除');expect(JSON.stringify(body)).not.toContain('2000');
  expect(calculateGbpScore).toHaveBeenCalledWith(null,expect.anything());
  expect(releaseMismatchedGbpPlace).toHaveBeenCalledWith(expect.objectContaining({rpc}),id,'OldPlace');
  // 他店の評価を gbp:refresh で書き込まない
  expect(rpc).not.toHaveBeenCalled();
 });
 test('a Place ID the owner replaced meanwhile is left alone and reported as not released',async()=>{
  (fetchPlaceDetails as jest.Mock).mockResolvedValue(OTHER_SHOP);(releaseMismatchedGbpPlace as jest.Mock).mockResolvedValue('changed');
  const body=await (await get()).json();expect(body).toEqual(expect.objectContaining({ownershipMismatch:true,released:false}));expect(rpc).not.toHaveBeenCalled();
 });
 test('a release that cannot be written is a visible 500, not a silent success',async()=>{
  (fetchPlaceDetails as jest.Mock).mockResolvedValue(OTHER_SHOP);(releaseMismatchedGbpPlace as jest.Mock).mockResolvedValue('failed');
  expect((await get()).status).toBe(500);expect(rpc).not.toHaveBeenCalled();
 });
 test('a matching listing is written as before, nothing is released and no notice is shown',async()=>{
  const body=await (await get()).json();expect(body.ownershipMismatch).toBeUndefined();expect(body.released).toBeUndefined();
  expect(releaseMismatchedGbpPlace).not.toHaveBeenCalled();expect(rpc.mock.calls[0][1].p_values).toEqual(expect.objectContaining({rating:4,review_count:8}));
 });
});
