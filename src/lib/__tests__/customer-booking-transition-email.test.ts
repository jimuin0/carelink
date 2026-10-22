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
const previous = { bookingDate:'2030-01-06', startTime:'10:00:00', endTime:'11:00:00' };
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
