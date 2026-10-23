/** @jest-environment node */
jest.mock('@/lib/rate-limit',()=>({mutationRateLimit:{},checkRateLimit:jest.fn().mockResolvedValue(false)}));
jest.mock('@/lib/csrf',()=>({checkCsrf:jest.fn(()=>null)}));
jest.mock('@/lib/audit-logger',()=>({writeAuditLog:jest.fn()}));
jest.mock('@/lib/referral',()=>({awardReferralPointsOnCompletion:jest.fn().mockResolvedValue(undefined)}));
jest.mock('@sentry/nextjs',()=>({captureException:jest.fn()}),{virtual:true});
const mockGetUser=jest.fn(),mockFrom=jest.fn(),mockRpc=jest.fn();
jest.mock('@/lib/supabase-server-auth',()=>({createServerSupabaseAuthClient:async()=>({auth:{getUser:mockGetUser}})}));
jest.mock('@/lib/supabase-server',()=>({createServiceRoleClient:()=>({from:mockFrom,rpc:mockRpc})}));
import {POST} from '../route';
import {checkCsrf} from '@/lib/csrf';
import {checkRateLimit} from '@/lib/rate-limit';
import {writeAuditLog} from '@/lib/audit-logger';
const id='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222';
// A booking that has started (2020): 来店完了 is recorded only after the start (JST).
const booking={id,facility_id:'f1',user_id:'customer',customer_name:'Synthetic',email:null,booking_date:'2020-01-06',start_time:'10:00:00',total_price:5000,menu_id:null,staff_id:null,status:'confirmed'};
const chain=(data:unknown)=>({select:jest.fn().mockReturnThis(),eq:jest.fn().mockReturnThis(),in:jest.fn().mockReturnThis(),single:async()=>({data}),maybeSingle:async()=>({data})});
const request=(body:unknown={bookingId:id})=>new Request('http://localhost/api/booking/complete',{method:'POST',body:JSON.stringify(body)});
beforeEach(()=>{
 jest.clearAllMocks(); (checkCsrf as jest.Mock).mockReturnValue(null); (checkRateLimit as jest.Mock).mockResolvedValue(false);
 mockGetUser.mockResolvedValue({data:{user:{id:actor}}});
 mockFrom.mockImplementation((table)=>chain(table==='bookings'?booking:{facility_id:'f1',role:'owner'}));
 mockRpc.mockResolvedValue({data:[{id,points_earned:50,replayed:false}],error:null});
});
test('未認証は401・transactionなし',async()=>{mockGetUser.mockResolvedValue({data:{user:null}});expect((await POST(request())).status).toBe(401);expect(mockRpc).not.toHaveBeenCalled();});
test('CSRFは403・transactionなし',async()=>{(checkCsrf as jest.Mock).mockReturnValue(new Response('',{status:403}));expect((await POST(request())).status).toBe(403);expect(mockRpc).not.toHaveBeenCalled();});
test('rate-limitは429',async()=>{(checkRateLimit as jest.Mock).mockResolvedValue(true);expect((await POST(request())).status).toBe(429);});
test.each([{}, {bookingId:'bad'}])('不正ID %jは400',async body=>expect((await POST(request(body))).status).toBe(400));
test('不正JSONは400',async()=>expect((await POST(new Request('http://localhost/api/booking/complete',{method:'POST',body:'bad-json'}))).status).toBe(400));
test('予約不在404',async()=>{mockFrom.mockReturnValue(chain(null));expect((await POST(request())).status).toBe(404);});
test('別店舗のmembershipでは403・transactionなし',async()=>{mockFrom.mockImplementation(table=>chain(table==='bookings'?booking:null));expect((await POST(request())).status).toBe(403);expect(mockRpc).not.toHaveBeenCalled();});
test.each(['pending','cancelled','arrived'])('状態%sは400',async status=>{mockFrom.mockImplementation(table=>chain(table==='bookings'?{...booking,status}:{facility_id:'f1'}));expect((await POST(request())).status).toBe(400);});
test('確定したDBポイント数を返し、別の台帳INSERTは実行しない',async()=>{
 mockRpc.mockResolvedValue({data:[{id,points_earned:42,replayed:false}],error:null});
 const res=await POST(request());expect(res.status).toBe(200);expect(await res.json()).toEqual({success:true,points_earned:42,replayed:false});
 expect(mockRpc).toHaveBeenCalledWith('complete_booking_with_points_atomic',{p_actor_id:actor,p_booking_id:id,p_expected_status:'confirmed'});
 expect(mockFrom).not.toHaveBeenCalledWith('user_points'); expect(mockFrom).not.toHaveBeenCalledWith('customer_visits');
});
test.each([['BOOKING_PERMISSION_DENIED',403],['BOOKING_REVISION_CONFLICT',409],['BOOKING_NOT_STARTED',400],['SYNTHETIC_POINT_FAILURE',500],['SYNTHETIC_VISIT_FAILURE',500]])('transaction失敗%sは成功監査にしない',async(message,status)=>{
 mockRpc.mockResolvedValue({data:null,error:{message}});expect((await POST(request())).status).toBe(status);expect(writeAuditLog).not.toHaveBeenCalled();
});
test.each([null,[],[{id:'wrong',points_earned:50,replayed:false}],[{id,points_earned:null}],[{id,points_earned:-1}],[{id,points_earned:1.5}]])('未確認結果%jは500',async data=>{mockRpc.mockResolvedValue({data,error:null});expect((await POST(request())).status).toBe(500);});
test('dataとerror同時でも500',async()=>{mockRpc.mockResolvedValue({data:[{id,points_earned:50,replayed:false}],error:{message:'fail'}});expect((await POST(request())).status).toBe(500);});
test('auth exception is unavailable',async()=>{mockGetUser.mockRejectedValue(new Error('synthetic'));expect((await POST(request())).status).toBe(503);});


test('保存済み完了のreplayで未付与紹介ボーナスを再試行する・監査や台帳を二重保存しない',async()=>{
 mockFrom.mockImplementation(table=>chain(table==='bookings'?{...booking,status:'completed'}:{facility_id:'f1',role:'owner'}));
 mockRpc.mockResolvedValue({data:[{id,points_earned:50,replayed:true}],error:null});
 const res=await POST(request()); expect(res.status).toBe(200);expect(await res.json()).toEqual({success:true,points_earned:50,replayed:true});
 expect(jest.requireMock('@/lib/referral').awardReferralPointsOnCompletion).toHaveBeenCalledWith(expect.anything(),'customer');
 expect(writeAuditLog).not.toHaveBeenCalled();expect(mockFrom).not.toHaveBeenCalledWith('user_points');
});
test('replay確認が欠けた結果は500',async()=>{mockRpc.mockResolvedValue({data:[{id,points_earned:50}],error:null});expect((await POST(request())).status).toBe(500);});

test('旧DBで原子完了RPCが未適用でも直接UPDATE/台帳INSERTへ戻らない',async()=>{
 mockRpc.mockResolvedValue({data:null,error:{code:'PGRST202',message:'complete_booking_with_points_atomic was not found'}});
 expect((await POST(request())).status).toBe(500);
 expect(mockRpc).toHaveBeenCalledWith('complete_booking_with_points_atomic',expect.anything());
 expect(mockFrom.mock.calls.filter(([table])=>table==='bookings')).toHaveLength(1);
 expect(mockFrom).not.toHaveBeenCalledWith('user_points');expect(mockFrom).not.toHaveBeenCalledWith('customer_visits');
 expect(writeAuditLog).not.toHaveBeenCalled();
 expect(jest.requireMock('@/lib/referral').awardReferralPointsOnCompletion).not.toHaveBeenCalled();
});


describe('uncertain authentication cannot grant service-role access', () => {
  test.each(['data-and-error', 'missing-user-and-error', 'throw', 'timeout'])('%s returns sanitized 503 before DB work', async fault => {
    if (fault === 'timeout') jest.useFakeTimers();
    if (fault === 'data-and-error') mockGetUser.mockResolvedValue({ data: { user: { id: 'synthetic-actor' } }, error: { message: 'private-auth-diagnostic' } });
    if (fault === 'missing-user-and-error') mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'private-auth-diagnostic' } });
    if (fault === 'throw') mockGetUser.mockRejectedValue(new Error('private-auth-diagnostic'));
    if (fault === 'timeout') mockGetUser.mockImplementation(() => new Promise(() => {}));
    try {
      const pending = POST(request());
      if (fault === 'timeout') await jest.advanceTimersByTimeAsync(5000);
      const response = await pending;
      expect(response.status).toBe(503);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toMatchObject({ code: 'AUTH_UNAVAILABLE' });
      expect(mockFrom).not.toHaveBeenCalled(); expect(mockRpc).not.toHaveBeenCalled(); expect(writeAuditLog).not.toHaveBeenCalled();
    } finally { jest.useRealTimers(); }
  });
});


test.each(['booking-data-error', 'booking-null-error', 'membership-data-error', 'membership-null-error'])('read failure %s cannot complete a booking', async fault => {
  mockFrom.mockImplementation(table => {
    const failed = table === (fault.startsWith('booking') ? 'bookings' : 'facility_members');
    const data = table === 'bookings' ? booking : { facility_id: 'f1', role: 'owner' };
    const result = { data: failed && fault.includes('null') ? null : data, error: failed ? { code: '08006', message: 'private-db-diagnostic' } : null };
    return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(), single: async () => result, maybeSingle: async () => result };
  });
  const response = await POST(request());
  expect(response.status).toBe(500);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.text()).not.toContain('private-db-diagnostic');
  expect(mockRpc).not.toHaveBeenCalled();
  expect(writeAuditLog).not.toHaveBeenCalled();
});

describe('来店完了は予約の開始時刻（JST）を過ぎてから（2026年10月23日）', () => {
  const NOW = Date.UTC(2026, 9, 23, 1, 0, 0); // 2026-10-23 10:00 JST
  beforeEach(() => { jest.spyOn(Date, 'now').mockReturnValue(NOW); });
  afterEach(() => { jest.restoreAllMocks(); });
  const withBooking = (patch: Record<string, unknown>) =>
    mockFrom.mockImplementation((table) => chain(table === 'bookings' ? { ...booking, ...patch } : { facility_id: 'f1', role: 'owner' }));

  test('開始前の確定予約は 400・RPC も監査も呼ばない', async () => {
    withBooking({ booking_date: '2026-10-23', start_time: '10:01:00' });
    const res = await POST(request());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: '予約の開始時刻より前は来店完了にできません。開始時刻を過ぎてから操作してください。', code: 'BOOKING_NOT_STARTED' });
    expect(mockRpc).not.toHaveBeenCalled(); expect(writeAuditLog).not.toHaveBeenCalled();
  });

  test('開始時刻ちょうどからは完了できる（DB の規則と同じ）', async () => {
    withBooking({ booking_date: '2026-10-23', start_time: '10:00:00' });
    expect((await POST(request())).status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('complete_booking_with_points_atomic', expect.anything());
  });

  test('保存済みの完了の再確認は開始前の日付でも RPC の replay へ進む', async () => {
    withBooking({ booking_date: '2026-10-30', start_time: '10:00:00', status: 'completed' });
    mockRpc.mockResolvedValue({ data: [{ id, points_earned: 50, replayed: true }], error: null });
    expect((await POST(request())).status).toBe(200);
  });
});

describe('ポイント・来店記録と照合できない取り消しは 409 と理由（2026年10月23日）', () => {
  test.each([
    'POINTS_AUTH_REQUIRED',
    'POINTS_INSUFFICIENT',
    'POINTS_LEGACY_RECONCILIATION_REQUIRED',
    'POINTS_LEDGER_IMMUTABLE',
    'INVALID_BOOKING_POINTS',
    'BOOKING_VISIT_RECONCILIATION_REQUIRED',
  ])('%s は 409・code 付き・成功監査なし', async (message) => {
    mockRpc.mockResolvedValue({ data: null, error: { message } });
    const res = await POST(request());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('BOOKING_POINTS_RECONCILIATION_REQUIRED');
    expect(body.error).toContain('運営までお問い合わせください');
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  test('似た名前の別エラーは 409 にしない（完全一致）', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'POINTS_AUTH_REQUIRED_X' } });
    expect((await POST(request())).status).toBe(500);
  });
});
