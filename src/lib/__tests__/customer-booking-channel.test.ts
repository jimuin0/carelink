import { createHash } from 'node:crypto';
const mockSend = jest.fn(async()=>({outcome:'delivered',status:200}));
const mockPush = jest.fn((..._args:unknown[])=>mockSend),mockLine = jest.fn((..._args:unknown[])=>mockSend),mockWorks = jest.fn(async(..._args:unknown[])=>mockSend);
const mockRemove = jest.fn(async(..._args:unknown[])=>true);
jest.mock('../push',()=>({prepareCapturedPushDelivery:(...a:unknown[])=>mockPush(...a),removeExpiredPushSubscription:(...a:unknown[])=>mockRemove(...a),
  isExpiredPushStatus:(s:number|null)=>s===404||s===410}));
jest.mock('../line',()=>({prepareSingleLineDelivery:(...a:unknown[])=>mockLine(...a)}));
jest.mock('../integrations/line-works',()=>({prepareSingleLineWorksDelivery:(...a:unknown[])=>mockWorks(...a)}));
import { prepareCustomerBookingChannel } from '../customer-booking-channel';
const OP='b1100000-0000-4000-8000-000000000001',EVENT='b1100000-0000-4000-8000-000000000002';
const ACTOR='b1100000-0000-4000-8000-000000000003',STAFF='b1100000-0000-4000-8000-000000000004',SUB='b1100000-0000-4000-8000-000000000005';
const subscription={endpoint:'https://push.example.invalid/captured',p256dh:'synthetic-key',auth:'synthetic-auth'};
function job(channel='push',kind='rescheduled',role='customer') {
  return {id:OP,webhook_type:`customer_booking_${channel}`,target_id:channel==='push'?SUB:'captured-channel',payload:{
    customer_booking_channel_version:1,operationId:OP,eventId:EVENT,kind,role,
    recipientUserId:channel==='lineworks'?null:ACTOR,recipientStaffIds:channel==='lineworks'?[STAFF]:[],
    subscriptionProof:channel==='push'?createHash('sha256').update([subscription.endpoint,subscription.p256dh,subscription.auth].join('\x1f')).digest('hex'):null,
    pushSubscription:channel==='push'?{...subscription}:null,lineProof:channel==='line'?'2026-10-13T12:00:00Z':null,
    snapshot:{bookingId:OP,bookingRevision:'2026-10-13T12:00:00Z',actorUserId:ACTOR,customerName:'Captured customer',
      facilityName:'Captured facility',menuName:'Captured menu',bookingDate:'2030-01-07',startTime:'10:00:00',endTime:'11:00:00'},
  }};
}
beforeEach(()=>jest.clearAllMocks());
test.each([['rescheduled','customer'],['rescheduled','owner'],['cancelled','owner']])('captured push %s/%s is prepared without sending',async(kind,role)=>{
  const sender=await prepareCustomerBookingChannel(job('push',kind,role));
  expect(mockSend).not.toHaveBeenCalled();expect(mockPush).toHaveBeenCalledWith(subscription,expect.objectContaining({body:expect.stringContaining('2030-01-07')}));
  expect(await sender()).toEqual({outcome:'delivered',status:200});expect(mockSend).toHaveBeenCalledTimes(1);
});
test('verified LINE cancellation keeps captured names/time',async()=>{
  await prepareCustomerBookingChannel(job('line','cancelled','customer'));
  expect(mockLine).toHaveBeenCalledWith('captured-channel',expect.stringContaining('Captured facility'));
  expect(mockSend).not.toHaveBeenCalled();
});
test.each(['cancelled','rescheduled'])('staff %s message is prepared before any send',async kind=>{
  await prepareCustomerBookingChannel(job('lineworks',kind,'staff'));
  expect(mockWorks).toHaveBeenCalledWith('captured-channel',expect.stringContaining('Captured customer'));
  expect(mockSend).not.toHaveBeenCalled();
});
test('empty menu is valid captured source, never reread',async()=>{
  const j=job('lineworks','rescheduled','staff');j.payload.snapshot.menuName='';await prepareCustomerBookingChannel(j);
  expect(mockWorks.mock.calls[0][1]).not.toContain('メニュー:');
});
test.each([
  (j:ReturnType<typeof job>)=>{j.payload.operationId=EVENT;},
  (j:ReturnType<typeof job>)=>{j.payload.recipientUserId=STAFF;},
  (j:ReturnType<typeof job>)=>{j.target_id='invalid';},
  (j:ReturnType<typeof job>)=>{j.payload.recipientUserId=null;},
  (j:ReturnType<typeof job>)=>{j.payload.pushSubscription=null;},
  (j:ReturnType<typeof job>)=>{j.payload.subscriptionProof=null;},
  (j:ReturnType<typeof job>)=>{j.payload.subscriptionProof='0'.repeat(64);},
  (j:ReturnType<typeof job>)=>{j.payload.role='staff';},
  (j:ReturnType<typeof job>)=>{j.payload.kind='cancelled';},
  (j:ReturnType<typeof job>)=>{j.payload.recipientStaffIds=[STAFF];},
  (j:ReturnType<typeof job>)=>{j.payload.lineProof='2026-10-13T12:00:00Z';},
])('invalid push scope never reaches transport (%#)',async mutate=>{
  const j=job();mutate(j);await expect(prepareCustomerBookingChannel(j)).rejects.toThrow();expect(mockPush).not.toHaveBeenCalled();expect(mockSend).not.toHaveBeenCalled();
});
test.each([job('line','rescheduled','customer'),job('line','cancelled','owner'),job('lineworks','rescheduled','owner')])('mismatched channel role is rejected',async j=>{
  await expect(prepareCustomerBookingChannel(j)).rejects.toThrow();expect(mockSend).not.toHaveBeenCalled();
});
test.each([410,404])('expired device %s removes exactly the captured subscription so the next attempt is superseded (E19)',async status=>{
  mockSend.mockResolvedValueOnce({outcome:'rejected',status});
  const sender=await prepareCustomerBookingChannel(job('push','cancelled','owner'));
  expect(await sender()).toEqual({outcome:'rejected',status});
  expect(mockRemove).toHaveBeenCalledWith(ACTOR,subscription);
});
test.each([[{outcome:'rejected',status:429}],[{outcome:'uncertain',status:503}],[{outcome:'delivered',status:201}]])('other push results %# keep the device',async result=>{
  mockSend.mockResolvedValueOnce(result);
  const sender=await prepareCustomerBookingChannel(job('push','rescheduled','customer'));
  expect(await sender()).toEqual(result);expect(mockRemove).not.toHaveBeenCalled();
});
