/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { prepareCustomerBookingTransitionEnvelope } from '../customer-booking-transition-email';

const id = '11111111-1111-4111-8111-111111111111';
const snapshot = { bookingId:'22222222-2222-4222-8222-222222222222', bookingRevision:'2030-01-06T21:00:00+00:00', customerName:'<script>customer</script>',
  customerEmail:'customer@example.invalid',facilityName:'A <clinic>',bookingDate:'2030-01-07',startTime:'12:00:00',
  endTime:'13:00:00',menuName:'Menu <test>',totalPrice:5000,capturedAt:'2030-01-06T21:00:00+00:00',
  cancelPolicy:{free_cancel_hours:24,late_cancel_rate:50} };
const job = {id,webhook_type:'email',target_id:snapshot.customerEmail,facility_id:'33333333-3333-4333-8333-333333333333',
  claimed_at:'2030-01-07T00:00:00Z',email_envelope:null,payload:{event_email_version:1,dispatch_version:2,
    idempotency_key:`carelink-event-email/${id}`,customer_booking_transition_version:1,kind:'cancelled',role:'customer',snapshot} };
const freeze = jest.fn();
const chain = {eq:jest.fn().mockReturnThis(),is:jest.fn().mockReturnThis(),select:jest.fn().mockReturnThis(),maybeSingle:freeze};
const update = jest.fn(()=>chain);
const from = jest.fn(()=>({update}));
const db = {from} as any;
beforeEach(()=>{jest.clearAllMocks();freeze.mockResolvedValue({data:{id},error:null});});

test.each(['customer','owner','rescheduled'])('captures %s content once, under worker ownership, without reading mutable rows',async mode=>{
  const input={...job,target_id:mode==='owner'?'owner@example.invalid':job.target_id,
    payload:{...job.payload,kind:mode==='rescheduled'?'rescheduled':'cancelled',role:mode==='owner'?'owner':'customer'}};
  const envelope=await prepareCustomerBookingTransitionEnvelope(db,input);
  expect(envelope.to).toBe(input.target_id);
  expect(envelope.html).toContain('&lt;script&gt;customer&lt;/script&gt;');
  if(mode!=='owner') expect(envelope.html).toContain('A &lt;clinic&gt;');
  expect(envelope.html).toContain('Menu &lt;test&gt;');
  expect(envelope.subject).toContain(mode==='rescheduled'?'日時を変更':'キャンセル');
  if(mode==='customer') expect(envelope.html).toContain('2,500');
  expect(from).toHaveBeenCalledTimes(1);expect(from).toHaveBeenCalledWith('webhook_retry_queue');
  expect(chain.eq).toHaveBeenCalledWith('claimed_at',job.claimed_at);
  expect(chain.is).toHaveBeenCalledWith('delivery_started_at',null);
  expect(chain.is).toHaveBeenCalledWith('email_envelope',null);
});
// Regression (D4): the shop's cancellation email carried no fee although the customer
// was told a fee applies and that the shop would explain how to pay.
test('shop cancellation email shows the same fee, rate and cancellation time as the customer email',async()=>{
  const owner=await prepareCustomerBookingTransitionEnvelope(db,{...job,target_id:'owner@example.invalid',payload:{...job.payload,role:'owner'}});
  const customer=await prepareCustomerBookingTransitionEnvelope(db,job);
  expect(customer.html).toContain('2,500');
  expect(owner.html).toContain('&yen;2,500（施術料金の50%）');
  expect(owner.html).toContain('お支払い方法をお客様へ直接ご連絡ください');
  // capturedAt 2030-01-06T21:00Z = 2030-01-07 06:00 JST (6 hours before the 12:00 start).
  expect(owner.html).toContain('2030年1月7日 06:00');
});
// Regression (D3/D13): the old 「キャンセル不可」 (free_cancel_hours=0) promised a fee on the booking
// screen but every cancellation email said nothing about it.
test.each([
  [{free_cancel_hours:0,late_cancel_rate:50}, '2,500'],
  [{free_cancel_hours:0,late_cancel_rate:50,cancel_rule:null}, '2,500'],
  [{free_cancel_hours:24,late_cancel_rate:30,cancel_rule:'always_fee'}, '1,500'],
])('a fee that always applies is emailed even long before the start %#',async(cancelPolicy,fee)=>{
  const early={...snapshot,capturedAt:'2029-12-01T00:00:00+00:00',cancelPolicy};
  for (const role of ['customer','owner']) {
    const envelope=await prepareCustomerBookingTransitionEnvelope(db,{...job,target_id:role==='owner'?'owner@example.invalid':job.target_id,
      payload:{...job.payload,role,snapshot:early}});
    expect(envelope.html).toContain(fee);
  }
});
// Regression (review): a customer without an email address gets no customer email at all
// (publish_customer_booking_transition_email skips the recipient), yet the shop was told
// the customer had been informed of the fee.
test('shop email says the customer was not emailed when the snapshot has no customer address',async()=>{
  const owner=await prepareCustomerBookingTransitionEnvelope(db,{...job,target_id:'owner@example.invalid',
    payload:{...job.payload,role:'owner',snapshot:{...snapshot,customerEmail:''}}});
  expect(owner.html).toContain('お客様のメールアドレスの登録が無いため、キャンセル料はお客様へメールでお知らせしていません。');
  expect(owner.html).toContain('<strong>&yen;2,500</strong> とお支払い方法を、お客様へ直接ご案内ください。');
  expect(owner.html).not.toContain('お知らせしています');
});
test('a free cancellation tells the shop the time but no fee',async()=>{
  const envelope=await prepareCustomerBookingTransitionEnvelope(db,{...job,target_id:'owner@example.invalid',
    payload:{...job.payload,role:'owner',snapshot:{...snapshot,capturedAt:'2029-12-01T00:00:00+00:00'}}});
  expect(envelope.html).not.toContain('キャンセル料');
  expect(envelope.html).toContain('2029年12月1日 09:00');
});
test('an unknown cancellation rule in a snapshot is rejected rather than guessed',async()=>{
  await expect(prepareCustomerBookingTransitionEnvelope(db,{...job,payload:{...job.payload,
    snapshot:{...snapshot,cancelPolicy:{free_cancel_hours:24,late_cancel_rate:50,cancel_rule:'never'}}}})).rejects.toThrow();
  expect(from).not.toHaveBeenCalled();
});
const previous = { bookingDate:'2030-01-06', startTime:'10:00:00', endTime:'11:00:00' };
test('変更前後が日付をまたぐとき、施設への通知に両方の終了日を表示する', async () => {
  const before = { bookingDate: '2030-01-06', startTime: '23:30:00', endDate: '2030-01-07', endTime: '00:30:00' };
  const after = { ...snapshot, bookingDate: '2030-01-07', startTime: '23:30:00', endDate: '2030-01-08', endTime: '00:30:00', previous: before };
  const envelope = await prepareCustomerBookingTransitionEnvelope(db, { ...job, target_id: 'owner@example.invalid', payload: { ...job.payload, kind: 'rescheduled', role: 'owner', snapshot: after } });
  expect(envelope.html).toContain('2030年1月6日（日） 23:30〜2030年1月7日（月） 00:30');
  expect(envelope.html).toContain('2030年1月7日（月） 23:30〜2030年1月8日（火） 00:30');
});
// Regression: a customer change emailed only the customer; the shop kept waiting at the old time.
test('shop change email shows the previous and the new date/time to the owner address',async()=>{
  const input={...job,target_id:'owner@example.invalid',payload:{...job.payload,kind:'rescheduled',role:'owner',snapshot:{...snapshot,previous}}};
  const envelope=await prepareCustomerBookingTransitionEnvelope(db,input);
  expect(envelope.to).toBe('owner@example.invalid');
  expect(envelope.subject).toBe('【CareLink】予約日時が変更されました - <script>customer</script>様');
  expect(envelope.html).toContain('変更前の日時');
  expect(envelope.html).toContain('2030年1月6日（日） 10:00〜11:00');
  expect(envelope.html).toContain('2030年1月7日（月） 12:00〜13:00');
  expect(envelope.html).toContain('&lt;script&gt;customer&lt;/script&gt;');
  expect(envelope.html).toContain('customer@example.invalid');
  expect(envelope.html).toContain('/admin/bookings');
  expect(envelope.html).not.toContain('キャンセル料');
  expect(chain.is).toHaveBeenCalledWith('email_envelope',null);
});
test('customer change email accepts the previous date/time captured with the change',async()=>{
  const envelope=await prepareCustomerBookingTransitionEnvelope(db,{...job,payload:{...job.payload,kind:'rescheduled',snapshot:{...snapshot,previous}}});
  expect(envelope.to).toBe(snapshot.customerEmail);expect(envelope.subject).toContain('日時を変更');
  // 変更はその予約の会員本人だけができる（change_booking_atomic が user_id を照合）＝マイページで確認できる。
  expect(envelope.html).toContain('/mypage');expect(envelope.html).not.toContain('ログインせずにご予約された方');
});
test('missing optional snapshot values use the original empty values, never current booking data',async()=>{
  const envelope=await prepareCustomerBookingTransitionEnvelope(db,{...job,payload:{...job.payload,
    snapshot:{...snapshot,menuName:null,totalPrice:null,cancelPolicy:null}}});
  expect(envelope.html).not.toContain('キャンセル料として');expect(from).toHaveBeenCalledTimes(1);
});
test('reclaim keeps the exact frozen envelope',async()=>{
  const first=await prepareCustomerBookingTransitionEnvelope(db,job);from.mockClear();
  expect(await prepareCustomerBookingTransitionEnvelope(db,{...job,email_envelope:first})).toEqual(first);
  expect(from).not.toHaveBeenCalled();
});
test('rejects a frozen envelope addressed to another user',async()=>{
  await expect(prepareCustomerBookingTransitionEnvelope(db,{...job,email_envelope:{from:'a@example.invalid',to:'other@example.invalid',subject:'x',html:'x'}})).rejects.toThrow('scope mismatch');
  expect(from).not.toHaveBeenCalled();
});
test.each([
  {data:null,error:null},{data:{id:'other'},error:null},{data:{id},error:{message:'lost response'}},
])('unconfirmed freeze cannot dispatch %#',async result=>{
  freeze.mockResolvedValue(result);await expect(prepareCustomerBookingTransitionEnvelope(db,job)).rejects.toThrow('freeze not confirmed');
});
test.each([
  {...job,target_id:'other@example.invalid'},
  {...job,payload:{...job.payload,idempotency_key:'other'}},
  {...job,payload:{...job.payload,kind:'rescheduled',role:'owner'}},
  {...job,target_id:'owner@example.invalid',payload:{...job.payload,kind:'rescheduled',role:'owner'}},
  {...job,payload:{...job.payload,snapshot:{...snapshot,previous:{bookingDate:'2030-01-06',startTime:'10:00:00',endTime:'11:00:00'}}}},
  {...job,target_id:'owner@example.invalid',payload:{...job.payload,kind:'rescheduled',role:'owner',snapshot:{...snapshot,previous:{bookingDate:'2030-01-06',startTime:'10:00'}}}},
  {...job,payload:{...job.payload,snapshot:{...snapshot,bookingId:'invalid'}}},
  {...job,payload:{...job.payload,customer_booking_transition_version:2}},
  {...job,payload:{...job.payload,extra:'unexpected'}},
])('rejects malformed identity before database or provider activity %#',async input=>{
  await expect(prepareCustomerBookingTransitionEnvelope(db,input)).rejects.toThrow();expect(from).not.toHaveBeenCalled();
});
