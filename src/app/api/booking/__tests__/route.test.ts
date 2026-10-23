/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({ bookingRateLimit: null, checkRateLimit: jest.fn(async () => false) }));
jest.mock('@/lib/safe', () => ({ safeCaptureException: jest.fn() }));
jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));
jest.mock('@/lib/booking-create-notifications', () => ({ BookingNotificationPlanError:class extends Error {}, buildBookingCreateNotifications: jest.fn(async () => []) }));
jest.mock('@/lib/booking-create-dispatch', () => ({ dispatchBookingCreationNotifications: jest.fn(async () => ({ accepted:0,pending:1,uncertain:0,skipped:0 })) }));
const mockAuth = jest.fn(); const mockRpc = jest.fn(); const mockFrom = jest.fn();
const mockScope = jest.fn();
jest.mock('@supabase/ssr', () => ({ createServerClient: () => ({ auth: { getUser: mockAuth }, from: mockFrom }) }));
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => ({ rpc: mockRpc, from: mockFrom }) }));
jest.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], get: mockScope, set: jest.fn() }) }));
import { POST } from '../route';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { AuthRetryableFetchError } from '@supabase/supabase-js';
import { buildBookingCreateNotifications } from '@/lib/booking-create-notifications';
const id='bea51000-0000-4000-8000-000000000001'; const actor='bea50000-0000-4000-8000-000000000001';
const menu='bea52000-0000-4000-8000-000000000001'; const facility='bea53000-0000-4000-8000-000000000001';
const staff='bea54000-0000-4000-8000-000000000001'; const coupon='bea55000-0000-4000-8000-000000000001';
const date=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
const body={facility_id:facility,staff_id:null,menu_id:menu,coupon_id:null,booking_date:date,start_time:'10:00',end_time:'10:30',customer_name:'Synthetic',email:'proxy@example.invalid',phone:null,note:null,total_price:1,points_used:0};
const accepted={success:true,state:'accepted',operationId:id,bookingId:'bea56000-0000-4000-8000-000000000001',bookingStatus:'pending',bookingDate:date,startTime:'10:00',endTime:'10:30',totalPrice:500,notification:'queued'};
let rows: Record<string,{data:unknown;error:unknown}>;
function chain(value:unknown){ const c:Record<string,unknown>={}; for(const name of ['select','eq','in','or','not','lt','gt','single','maybeSingle']) c[name]=jest.fn(()=>c);c.then=Promise.resolve(value).then.bind(Promise.resolve(value));return c; }
function request(payload:unknown=body,action='create',key:string|null=id){return new Request('http://localhost/api/booking',{method:'POST',headers:{'Content-Type':'application/json','X-Booking-Action':action,...(key?{'Idempotency-Key':key}:{}),Origin:'http://localhost'},body:JSON.stringify(payload)});}
function installRpc(){mockRpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
 if(name==='prepare_booking_create_operation') return {data:[{state:'prepared',response_payload:null}],error:null};
 if(name==='inspect_booking_create_operation')return {data:[{state:args.p_close?'closed':'prepared',response_payload:null}],error:null};
 if(name==='create_booking_with_receipt_atomic')return {data:[{response_payload:accepted,replayed:false}],error:null};
 if(name==='booking_points_atomic_version')return{data:1,error:null};throw new Error('unexpected mutation');});}
beforeEach(()=>{jest.clearAllMocks();(checkCsrf as jest.Mock).mockReturnValue(null);(checkRateLimit as jest.Mock).mockResolvedValue(false);mockAuth.mockResolvedValue({data:{user:{id:actor}},error:null});mockScope.mockReturnValue({value:'c'.repeat(43)});installRpc();
 rows={facility_menus:{data:[{id:menu,price:500,duration_minutes:30}],error:null},facility_profiles:{data:{booking_auto_confirm:false},error:null},bookings:{data:[],error:null},staff_profiles:{data:{nomination_fee:50},error:null},coupons:{data:{is_active:true,discount_type:'percentage',discount_value:10,valid_from:null,valid_until:null},error:null},coupon_menus:{data:[],error:null},menu_staff:{data:[],error:null},user_points:{data:[{points:500}],error:null}};
 mockFrom.mockImplementation((table:string)=>chain(rows[table]));(buildBookingCreateNotifications as jest.Mock).mockResolvedValue([]);});
it('creates with durable receipt and server price, never the unkeyed primitive',async()=>{const res=await POST(request());expect(res.status).toBe(200);expect(await res.json()).toEqual({...accepted,delivery:{accepted:0,pending:1,uncertain:0,skipped:0}});expect(mockRpc).toHaveBeenCalledWith('create_booking_with_receipt_atomic',expect.objectContaining({p_id:id,p_actor_id:actor,p_guest_hash:null,p_total_price:500,p_email:'proxy@example.invalid',p_notifications:[]}));expect(mockRpc).not.toHaveBeenCalledWith('create_online_booking_atomic',expect.anything());});
it('blocks CSRF before auth/receipt',async()=>{(checkCsrf as jest.Mock).mockReturnValue(new Response(null,{status:403}));expect((await POST(request())).status).toBe(403);expect(mockAuth).not.toHaveBeenCalled();});
it('rate limits before auth',async()=>{(checkRateLimit as jest.Mock).mockResolvedValue(true);expect((await POST(request())).status).toBe(429);expect(mockAuth).not.toHaveBeenCalled();});
it('returned Auth 522 cannot turn an authenticated request into a guest',async()=>{mockAuth.mockResolvedValue({data:{user:null},error:new AuthRetryableFetchError('synthetic',522)});expect((await POST(request())).status).toBe(503);expect(mockRpc).not.toHaveBeenCalled();});
it.each([null,'bad-key'])('rejects missing/invalid receipt %s before DB',async key=>{expect((await POST(request(body,'create',key))).status).toBe(428);expect(mockRpc).not.toHaveBeenCalled();});
it('rejects unknown protocol action',async()=>{expect((await POST(request(body,'other'))).status).toBe(400);expect(mockAuth).not.toHaveBeenCalled();});
it('context handshake writes only HttpOnly opaque cookie without DB',async()=>{mockScope.mockReturnValue(undefined);mockAuth.mockResolvedValue({data:{user:null},error:null});const res=await POST(request(body,'context',null));expect(res.status).toBe(200);expect(res.headers.get('set-cookie')).toMatch(/HttpOnly/i);expect(mockRpc).not.toHaveBeenCalled();});
it('valid context is not replaced on retry',async()=>{const res=await POST(request(body,'context'));expect(res.headers.get('set-cookie')).toBeNull();});
it('guest requires received context cookie before prepare',async()=>{mockAuth.mockResolvedValue({data:{user:null},error:null});mockScope.mockReturnValue(undefined);expect((await POST(request(body,'prepare'))).status).toBe(428);expect(mockRpc).not.toHaveBeenCalled();});
it('guest receipt scope is server hash, does not trust supplied actor',async()=>{mockAuth.mockResolvedValue({data:{user:null},error:null});expect((await POST(request({...body,user_id:actor}))).status).toBe(200);expect(mockRpc).toHaveBeenCalledWith('prepare_booking_create_operation',expect.objectContaining({p_actor_id:null,p_guest_hash:expect.stringMatching(/^[a-f0-9]{64}$/)}));});
it.each(['status','close'])('lookup %s uses actor/key without form/pricing/notification effects',async action=>{const res=await POST(request(null,action));expect(res.status).toBe(200);expect(mockFrom).not.toHaveBeenCalled();expect(buildBookingCreateNotifications).not.toHaveBeenCalled();expect(mockRpc).toHaveBeenCalledWith('inspect_booking_create_operation',expect.objectContaining({p_close:action==='close'}));});
it('prepare confirms normalized hash but creates nothing',async()=>{expect((await POST(request(body,'prepare'))).status).toBe(200);expect(mockFrom).not.toHaveBeenCalled();expect(mockRpc).toHaveBeenCalledTimes(1);});
it('accepted replay works after the date passed and before conflicts/current prices/spent points',async()=>{mockRpc.mockResolvedValue({data:[{state:'committed',response_payload:accepted}],error:null});const res=await POST(request({...body,booking_date:'2020-01-01',points_used:500}));expect(res.status).toBe(200);expect(mockFrom).not.toHaveBeenCalled();expect(buildBookingCreateNotifications).not.toHaveBeenCalled();});
it.each(['missing','prepared','closed','retired'])('lookup exposes exact non-delivery state %s',async state=>{mockRpc.mockResolvedValue({data:[{state,response_payload:null}],error:null});expect(await(await POST(request(null,'status'))).json()).toEqual({state,operationId:id});});
it('closure racing with successful commit returns accepted instead of allowing another key',async()=>{mockRpc.mockResolvedValue({data:[{state:'committed',response_payload:accepted}],error:null});expect(await(await POST(request(null,'close'))).json()).toEqual(accepted);});
it.each([[],[{},{}],[{state:'bogus'}],[{state:'committed',response_payload:{...accepted,operationId:actor}}]].map(data=>[data]))('malformed receipt remains unknown %#',async data=>{mockRpc.mockResolvedValue({data,error:null});expect((await POST(request(null,'status'))).status).toBe(500);});
it.each([{code:'PGRST202',message:'missing rpc'},{code:'522',message:'synthetic'},null])('missing/unconfirmed prepare cannot fall back to direct booking %#',async error=>{mockRpc.mockResolvedValue({data:null,error});expect((await POST(request())).status).toBe(500);expect(mockFrom).not.toHaveBeenCalled();});
it('server-closed prepared key is explicitly closed',async()=>{mockRpc.mockResolvedValue({data:null,error:{code:'P0001',message:'BOOKING_CREATE_CLOSED'}});expect((await(await POST(request())).json()).state).toBe('closed');});
it.each([{email:'bad'},{customer_name:'  '},{menu_id:null},{booking_date:'2026-02-30'},{start_time:'24:00'}])('invalid structure closes key, no booking %#',async patch=>{const res=await POST(request({...body,...patch}));expect(res.status).toBe(400);expect((await res.json()).state).toBe('closed');expect(mockFrom).not.toHaveBeenCalled();});
it('malformed JSON closes old key',async()=>{const req=new Request('http://localhost/api/booking',{method:'POST',headers:{'Idempotency-Key':id},body:'{'});expect((await POST(req)).status).toBe(400);});
it.each([{booking_date:'2020-01-01'},{start_time:'11:00',end_time:'10:00'}])('fresh invalid date/time rejected with closed receipt %#',async patch=>{expect((await POST(request({...body,...patch}))).status).toBe(400);expect(mockRpc).toHaveBeenCalledWith('inspect_booking_create_operation',expect.objectContaining({p_close:true}));});
it('menu lookup cannot accept unavailable/foreign menu',async()=>{rows.facility_menus.data=[];expect((await POST(request())).status).toBe(400);});
it('designated staff overlap is judged only by the atomic creator, never by a partial RLS-limited pre-read',async()=>{rows.bookings.data=[{id:actor}];expect((await POST(request({...body,staff_id:staff}))).status).toBe(200);expect(mockFrom).not.toHaveBeenCalledWith('bookings');expect(mockRpc).toHaveBeenCalledWith('create_booking_with_receipt_atomic',expect.objectContaining({p_staff_id:staff}));});
it('undesignated bookings delegate capacity to atomic creator',async()=>{await POST(request());expect(mockFrom).not.toHaveBeenCalledWith('bookings');});
it.each(['POINTS_INSUFFICIENT','BOOKING_NOT_READY','BOOKING_MENU_UNAVAILABLE','BOOKING_CONFLICT','STAFF_NOT_IN_FACILITY','BOOKING_CLOSED_DAY','BOOKING_OUTSIDE_HOURS','STAFF_NOT_WORKING','COUPON_LIMIT','COUPON_ALREADY_USED','COUPON_TARGET_LOGIN_REQUIRED','COUPON_NEW_CUSTOMER_ONLY','COUPON_REPEAT_ONLY','BOOKING_SLOT_PASSED'])('known DB rejection %s closes exact key before editing',async message=>{const original=mockRpc.getMockImplementation()!;mockRpc.mockImplementation((name,args)=>name==='create_booking_with_receipt_atomic'?Promise.resolve({data:null,error:{code:'P0001',message}}):original(name,args));const res=await POST(request());expect(res.status).toBe(409);expect((await res.json()).state).toBe('closed');});
// Regression: the RPC raises 'CODE: description'. Matching the whole message turned every such rejection into a 500.
it.each([
 ['BOOKING_CONFLICT: この時間帯は既に予約が入っています','この時間帯は既に予約が入っています'],
 ['STAFF_NOT_WORKING: このスタッフはこの日は勤務していません','指名されたスタッフはこの日時には勤務していません'],
 ['BOOKING_CLOSED_DAY: この日は定休日です','この日は定休日のため予約できません'],
 ['BOOKING_OUTSIDE_HOURS: 営業時間外です','営業時間外のため予約できません'],
 ['BOOKING_NOT_READY: ネット予約は準備中です','この店舗のネット予約は準備中です。店舗へ直接お問い合わせください'],
 ['COUPON_LIMIT: このクーポンは利用上限に達しています','このクーポンは利用上限に達しています'],
 // Coupon target (2026-10-22): a returning customer used a 新規 coupon / a first-time customer a リピーター coupon.
 ['COUPON_NEW_CUSTOMER_ONLY: このクーポンは初めてご予約の方限定です','このクーポンは、この店舗を初めてご予約の方限定です。クーポンを外してご予約ください'],
 ['COUPON_REPEAT_ONLY: このクーポンはご来店いただいたことがある方限定です','このクーポンは、この店舗にご来店いただいたことがある方限定です。クーポンを外してご予約ください'],
 ['COUPON_TARGET_LOGIN_REQUIRED: このクーポンはログインしてご利用ください','このクーポンはログインしてご利用ください。ログインするか、クーポンを外してご予約ください'],
 // 2026-10-23: the booking core refuses a slot whose start (JST) has passed (20261023070000).
 ['BOOKING_SLOT_PASSED: 選択した時間は過ぎています','選択した時間はすでに過ぎています。日時を選び直してください。'],
 // 2026-10-23: おまかせで、勤務するスタッフの誰も選んだメニューを担当できない。以前は BOOKING_CONFLICT（満席）と案内していた（20261023180000）。
 ['BOOKING_NO_CAPABLE_STAFF: 選択したメニューを担当できるスタッフがいません','この時間に、選択したメニューを担当できるスタッフがいません。別の日時を選ぶか、メニューを選び直してください。'],
])('described DB rejection %s is a 409 with its message and a closed key',async(message,expected)=>{const original=mockRpc.getMockImplementation()!;mockRpc.mockImplementation((name,args)=>name==='create_booking_with_receipt_atomic'?Promise.resolve({data:null,error:{code:'P0001',message}}):original(name,args));const res=await POST(request({...body,staff_id:staff}));expect(res.status).toBe(409);expect(await res.json()).toEqual({state:'closed',operationId:id,error:expected});expect(mockRpc).toHaveBeenCalledWith('inspect_booking_create_operation',expect.objectContaining({p_close:true}));});
it.each(['toString','constructor: synthetic','UNKNOWN_REJECTION: synthetic'])('P0001 %s outside the known table stays an unresolved 500',async message=>{const original=mockRpc.getMockImplementation()!;mockRpc.mockImplementation((name,args)=>name==='create_booking_with_receipt_atomic'?Promise.resolve({data:null,error:{code:'P0001',message}}):original(name,args));expect((await POST(request())).status).toBe(500);expect(mockRpc).not.toHaveBeenCalledWith('inspect_booking_create_operation',expect.anything());});
it.each(['PGRST202','522','23505'])('unknown create error %s keeps operation unresolved, never closes/recreates',async code=>{const original=mockRpc.getMockImplementation()!;mockRpc.mockImplementation((name,args)=>name==='create_booking_with_receipt_atomic'?Promise.resolve({data:null,error:{code,message:'synthetic'}}):original(name,args));expect((await POST(request())).status).toBe(500);expect(mockRpc).not.toHaveBeenCalledWith('inspect_booking_create_operation',expect.anything());});
it.each([null,[],[{response_payload:{...accepted,operationId:actor},replayed:false}],[{response_payload:accepted}]])('wrong/ambiguous creator success remains unknown %#',async data=>{const original=mockRpc.getMockImplementation()!;mockRpc.mockImplementation((name,args)=>name==='create_booking_with_receipt_atomic'?Promise.resolve({data,error:null}):original(name,args));expect((await POST(request())).status).toBe(500);});
it('notification plan failure never commits booking',async()=>{(buildBookingCreateNotifications as jest.Mock).mockRejectedValue(new Error('synthetic lookup'));expect((await POST(request())).status).toBe(500);expect(mockRpc).not.toHaveBeenCalledWith('create_booking_with_receipt_atomic',expect.anything());});
it('point deduction is in creator and server clamps spend to price',async()=>{expect((await POST(request({...body,points_used:1000}))).status).toBe(200);expect(mockRpc).toHaveBeenCalledWith('create_booking_with_receipt_atomic',expect.objectContaining({p_points_used:500,p_total_price:0}));});
// 店舗向けの新規予約メールにポイント利用を出す。RPC へは「利用後の金額」と「利用ポイント」を分けて渡し、
// 2 つの和（ポイント利用前の金額）を予約 RPC が来店ポイントの上限として保存する（20261023000100）。
it('points spent reach the owner notification and the creator gets the amount before points split in two',async()=>{
 expect((await POST(request({...body,points_used:200}))).status).toBe(200);
 expect(buildBookingCreateNotifications).toHaveBeenCalledWith(expect.anything(),expect.anything(),actor,menu,300,'pending',200);
 const args=mockRpc.mock.calls.find(([name])=>name==='create_booking_with_receipt_atomic')![1];
 expect(args.p_total_price+args.p_points_used).toBe(500);
});
it('no points spent → the owner notification gets 0',async()=>{
 expect((await POST(request())).status).toBe(200);
 expect(buildBookingCreateNotifications).toHaveBeenCalledWith(expect.anything(),expect.anything(),actor,menu,500,'pending',0);
});
it('a capped pre-read cannot reject a spend authorized by the atomic creator',async()=>{rows.user_points.data=[];expect((await POST(request({...body,points_used:1}))).status).toBe(200);expect(mockFrom).not.toHaveBeenCalledWith('user_points');expect(mockRpc).toHaveBeenCalledWith('create_booking_with_receipt_atomic',expect.objectContaining({p_points_used:1}));});
it('guest cannot spend another account points',async()=>{mockAuth.mockResolvedValue({data:{user:null},error:null});expect((await POST(request({...body,points_used:1}))).status).toBe(401);});
it('unavailable point transaction remains unresolved',async()=>{const original=mockRpc.getMockImplementation()!;mockRpc.mockImplementation((name,args)=>name==='create_booking_with_receipt_atomic'?Promise.resolve({data:null,error:{code:'522',message:'fixture unavailable'}}):original(name,args));expect((await POST(request({...body,points_used:1}))).status).toBe(500);expect(mockRpc).not.toHaveBeenCalledWith('inspect_booking_create_operation',expect.anything());});
it('valid coupon and nomination fee are included in authoritative price',async()=>{await POST(request({...body,coupon_id:coupon,staff_id:staff}));expect(mockRpc).toHaveBeenCalledWith('create_booking_with_receipt_atomic',expect.objectContaining({p_total_price:500}));});
// Regression (2026-10-22 review): a 新規/リピーター coupon used to be judged by the e-mail typed into the form, so a guest
// could learn without the owner noticing whether any address had booked at the facility. Guests are now refused before
// the history is ever consulted, with the same answer whatever address they type.
it.each(['new_customer','repeat'])('guest cannot use a %s coupon: refused before the booking core, key closed',async coupon_type=>{mockAuth.mockResolvedValue({data:{user:null},error:null});rows.coupons.data={...(rows.coupons.data as object),coupon_type};const res=await POST(request({...body,coupon_id:coupon}));expect(res.status).toBe(401);expect(await res.json()).toEqual({state:'closed',operationId:id,error:'このクーポンはログインしてご利用ください。ログインするか、クーポンを外してご予約ください'});expect(mockRpc).not.toHaveBeenCalledWith('create_booking_with_receipt_atomic',expect.anything());});
it.each([['guest',null],['member',{id:actor}]])('%s may use a coupon for everyone',async(_label,user)=>{mockAuth.mockResolvedValue({data:{user},error:null});rows.coupons.data={...(rows.coupons.data as object),coupon_type:'all'};expect((await POST(request({...body,coupon_id:coupon}))).status).toBe(200);expect(mockRpc).toHaveBeenCalledWith('create_booking_with_receipt_atomic',expect.objectContaining({p_coupon_id:coupon,p_actor_id:user?actor:null}));});
it.each(['new_customer','repeat'])('signed-in customer with a %s coupon reaches the booking core, which judges the account history',async coupon_type=>{rows.coupons.data={...(rows.coupons.data as object),coupon_type};expect((await POST(request({...body,coupon_id:coupon}))).status).toBe(200);expect(mockRpc).toHaveBeenCalledWith('create_booking_with_receipt_atomic',expect.objectContaining({p_coupon_id:coupon,p_actor_id:actor}));});
it('expired coupon is rejected',async()=>{rows.coupons.data={is_active:true,valid_until:'2020-01-01'};expect((await POST(request({...body,coupon_id:coupon}))).status).toBe(400);});
it('coupon/menu lookup failure does not commit',async()=>{rows.coupon_menus.error={code:'522'};expect((await POST(request({...body,coupon_id:coupon}))).status).toBe(500);});
it('unmatched coupon menu rejected',async()=>{rows.coupon_menus.data=[{menu_id:actor}];expect((await POST(request({...body,coupon_id:coupon}))).status).toBe(400);});
it('menu staff mismatch rejected',async()=>{rows.menu_staff.data=[{menu_id:menu,staff_id:actor}];expect((await POST(request({...body,staff_id:staff}))).status).toBe(400);});
it('menu staff lookup error does not commit',async()=>{rows.menu_staff.error={code:'522'};expect((await POST(request({...body,staff_id:staff}))).status).toBe(500);});
it('status dependency error preserves unresolved key',async()=>{mockRpc.mockResolvedValue({data:null,error:{code:'522'}});expect((await POST(request(null,'status'))).status).toBe(500);});
it('local invalid input racing accepted receipt returns that acceptance',async()=>{mockRpc.mockResolvedValue({data:[{state:'committed',response_payload:accepted}],error:null});expect(await(await POST(request({...body,email:'bad'}))).json()).toEqual(accepted);});
it('corrupt committed prepare receipt cannot authorize success',async()=>{mockRpc.mockResolvedValue({data:[{state:'committed',response_payload:{...accepted,bookingId:'bad'}}],error:null});expect((await POST(request())).status).toBe(500);});
it.each([[],[menu]].map(menu_ids=>[menu_ids]))('multi-menu price primary selection %# stays server validated',async menu_ids=>{expect((await POST(request({...body,menu_ids}))).status).toBe(200);});
it('null menu lookup closes key and never calls creator',async()=>{rows.facility_menus.data=null;expect((await POST(request())).status).toBe(400);});
it('zero/null price and no nomination keep free booking valid',async()=>{rows.facility_menus.data=[{id:menu,price:null,duration_minutes:30}];rows.staff_profiles.data=null;rows.menu_staff.data=null;rows.facility_profiles.data=null;expect((await POST(request({...body,staff_id:staff,points_used:undefined}))).status).toBe(200);expect(mockRpc).toHaveBeenCalledWith('create_booking_with_receipt_atomic',expect.objectContaining({p_total_price:0,p_points_used:0}));});
it.each([null,{is_active:false},{is_active:true,valid_from:'2099-01-01'}])('missing/inactive/future coupon %# cannot discount',async data=>{rows.coupons.data=data;expect((await POST(request({...body,coupon_id:coupon}))).status).toBe(400);});
it('matching coupon menu and active date range are priced',async()=>{rows.coupons.data={is_active:true,discount_type:'special_price',special_price:300,valid_from:'2020-01-01',valid_until:'2099-01-01'};rows.coupon_menus.data=[{menu_id:menu}];rows.facility_profiles.data={booking_auto_confirm:true};await POST(request({...body,coupon_id:coupon,phone:undefined,note:undefined,points_used:undefined}));expect(mockRpc).toHaveBeenCalledWith('create_booking_with_receipt_atomic',expect.objectContaining({p_total_price:300,p_status:'confirmed'}));});
it('UUID casing refers to the same opaque operation',async()=>{expect((await POST(request(body,'create',id.toUpperCase()))).status).toBe(200);expect(mockRpc).toHaveBeenCalledWith('prepare_booking_create_operation',expect.objectContaining({p_id:id}));});
it.each([null,'   '])('home-visit-only facility rejects a booking without a visit address (%p) before creating it',async note=>{rows.facility_profiles.data={booking_auto_confirm:false,features:['訪問専門','保険適用']};const res=await POST(request({...body,note}));expect(res.status).toBe(400);expect((await res.json()).error).toBe('訪問先のご住所を入力してください');expect(mockRpc).toHaveBeenCalledWith('inspect_booking_create_operation',expect.objectContaining({p_close:true}));expect(mockRpc).not.toHaveBeenCalledWith('create_booking_with_receipt_atomic',expect.anything());});
it('home-visit-only facility accepts the visit address in the note',async()=>{rows.facility_profiles.data={booking_auto_confirm:false,features:['訪問専門']};expect((await POST(request({...body,note:'大阪府豊中市合成町1-2-3'}))).status).toBe(200);expect(mockRpc).toHaveBeenCalledWith('create_booking_with_receipt_atomic',expect.objectContaining({p_note:'大阪府豊中市合成町1-2-3'}));});
it('visit-capable (not home-visit-only) facility keeps the note optional',async()=>{rows.facility_profiles.data={booking_auto_confirm:false,features:['訪問対応可']};expect((await POST(request({...body,note:null}))).status).toBe(200);});
it.each(['facility_menus','coupons','staff_profiles','facility_profiles'])('price/status canonical dependency %s cannot silently undercharge or misstate confirmation',async table=>{rows[table].error={code:'522'};const patch=table==='coupons'?{coupon_id:coupon}:table==='staff_profiles'?{staff_id:staff}:{};expect((await POST(request({...body,...patch}))).status).toBe(500);expect(mockRpc).not.toHaveBeenCalledWith('create_booking_with_receipt_atomic',expect.anything());});
it('V2 readiness absence never creates booking or discards key',async()=>{const original=mockRpc.getMockImplementation()!;mockRpc.mockImplementation((name,args)=>name==='create_booking_with_receipt_atomic'?Promise.resolve({data:null,error:{code:'P0001',message:'WEBHOOK_DISPATCH_V2_UNAVAILABLE'}}):original(name,args));expect((await POST(request())).status).toBe(503);expect(mockRpc).not.toHaveBeenCalledWith('inspect_booking_create_operation',expect.anything());});
it('null/truncated notification collections are a visible503 before mutation',async()=>{const {BookingNotificationPlanError}=jest.requireMock('@/lib/booking-create-notifications');(buildBookingCreateNotifications as jest.Mock).mockRejectedValue(new BookingNotificationPlanError());expect((await POST(request())).status).toBe(503);expect(mockRpc).not.toHaveBeenCalledWith('create_booking_with_receipt_atomic',expect.anything());});

// Regression (2026-10-23): a slot picked for one menu stayed selected after another menu was added, so a 60-minute slot
// was saved with two menus (120 minutes) and the second hour was sold to someone else. Only start < end was checked.
// The slot length must now equal the duration of the chosen menus as read from the database (booking-slot-rules).
const menu2='bea52000-0000-4000-8000-000000000002';
const DURATION_MISMATCH='メニューの内容が更新されたため、選択した時間ではご予約できません。最新の内容で日時を選び直してください。';
it.each([
 ['a slot shorter than the menu',[{id:menu,price:500,duration_minutes:60}],{}],
 ['a single-menu slot kept after a second menu was added',[{id:menu,price:500,duration_minutes:30},{id:menu2,price:500,duration_minutes:30}],{menu_ids:[menu,menu2]}],
 ['a slot longer than the menu',[{id:menu,price:500,duration_minutes:15}],{}],
])('%s is refused before the booking core, key closed',async(_label,menus,patch)=>{
 rows.facility_menus.data=menus;
 const res=await POST(request({...body,...patch}));
 expect(res.status).toBe(400);
 expect(await res.json()).toEqual({state:'closed',operationId:id,error:DURATION_MISMATCH});
 expect(mockRpc).toHaveBeenCalledWith('inspect_booking_create_operation',expect.objectContaining({p_close:true}));
 expect(mockRpc).not.toHaveBeenCalledWith('create_booking_with_receipt_atomic',expect.anything());
});
it.each([
 ['two 30-minute menus fill a 60-minute slot',[{id:menu,price:500,duration_minutes:30},{id:menu2,price:500,duration_minutes:30}],{menu_ids:[menu,menu2],end_time:'11:00'}],
 ['a menu without a duration counts as 60 minutes',[{id:menu,price:500,duration_minutes:null}],{end_time:'11:00'}],
 ['a menu over 480 minutes uses the 480-minute slot the availability API offers',[{id:menu,price:500,duration_minutes:600}],{end_time:'18:00'}],
 ['a menu under 15 minutes uses the 15-minute slot the availability API offers',[{id:menu,price:500,duration_minutes:10}],{end_time:'10:15'}],
])('%s → accepted',async(_label,menus,patch)=>{
 rows.facility_menus.data=menus;
 expect((await POST(request({...body,...patch}))).status).toBe(200);
 expect(mockRpc).toHaveBeenCalledWith('create_booking_with_receipt_atomic',expect.objectContaining({p_end_time:(patch as {end_time?:string}).end_time??'10:30'}));
});
it('the menu lookup reads the durations it compares',async()=>{
 const menus=chain(rows.facility_menus);mockFrom.mockImplementation((table:string)=>table==='facility_menus'?menus:chain(rows[table]));
 await POST(request());
 expect(menus.select).toHaveBeenCalledWith('id, price, duration_minutes');
});

// Regression (2026-10-23): the booking page fetches availability once, so a visitor who kept it open could send a slot
// whose start had passed (and a hand-made request could book 09:00 at 20:00). The booking was created and could then be
// neither cancelled nor changed online. A start at or before the current JST time is refused before the booking core.
describe('a slot whose start time (JST) has passed',()=>{
 // 2099-05-01 14:00 JST. Only Date is faked; timers and microtasks run normally.
 beforeEach(()=>{jest.useFakeTimers({now:Date.parse('2099-05-01T05:00:00Z'),doNotFake:['nextTick','setImmediate','clearImmediate','setTimeout','clearTimeout','setInterval','clearInterval','queueMicrotask']});});
 afterEach(()=>{jest.useRealTimers();});
 it.each([['13:30','14:00'],['14:00','14:30']])('start %s (now 14:00) is refused with a closed key',async(start_time,end_time)=>{
  const res=await POST(request({...body,booking_date:'2099-05-01',start_time,end_time}));
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({state:'closed',operationId:id,error:'選択した時間はすでに過ぎています。日時を選び直してください。'});
  expect(mockFrom).not.toHaveBeenCalled();
  expect(mockRpc).not.toHaveBeenCalledWith('create_booking_with_receipt_atomic',expect.anything());
 });
 it('a later start today is accepted',async()=>{
  expect((await POST(request({...body,booking_date:'2099-05-01',start_time:'14:30',end_time:'15:00'}))).status).toBe(200);
  expect(mockRpc).toHaveBeenCalledWith('create_booking_with_receipt_atomic',expect.objectContaining({p_booking_date:'2099-05-01',p_start_time:'14:30'}));
 });
 it('an accepted booking is still replayed after its start has passed',async()=>{
  mockRpc.mockResolvedValue({data:[{state:'committed',response_payload:accepted}],error:null});
  expect(await(await POST(request({...body,booking_date:'2099-05-01',start_time:'09:00',end_time:'09:30'}))).json()).toEqual(accepted);
 });
});
