/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { queueCustomerCouponEmail } from '../customer-coupon-email';
jest.mock('../email-from', () => ({ ...jest.requireActual('../email-from'), fromEnv: () => 'CareLink <noreply@carelink-jp.com>' }));

const operationId='11111111-1111-4111-8111-111111111111';
const couponId='22222222-2222-4222-8222-222222222222';
const input={facilityId:'33333333-3333-4333-8333-333333333333',facilityName:'A <clinic>',facilitySlug:'clinic',
  email:'person@example.com',customerName:'<script>bad</script>',daysSince:62,validUntil:'2026-11-08'};
const reserved={state:'reserved',operation_id:operationId,coupon_id:couponId,code:'BACK123',valid_until:'2026-11-08'};
const rpc=jest.fn();
const db={rpc} as any;
beforeEach(()=>{rpc.mockReset().mockResolvedValueOnce({data:[reserved],error:null})
  .mockResolvedValueOnce({data:[{id:operationId,status:'pending'}],error:null});});

test('publishes one immutable coupon operation without sending mail',async()=>{
  expect(await queueCustomerCouponEmail(db,input)).toBe('queued');
  expect(rpc.mock.calls.map(c=>c[0])).toEqual(['reserve_customer_coupon_email_atomic','prepare_customer_coupon_email_atomic']);
  const envelope=rpc.mock.calls[1][1].p_envelope;
  expect(envelope.to).toBe(input.email);
  expect(envelope.html).toContain('&lt;script&gt;bad&lt;/script&gt;');
  expect(envelope.html).toContain('A &lt;clinic&gt;');
  expect(envelope.html).toContain('BACK123');
  expect(rpc.mock.calls[1][1].p_operation_id).toBe(operationId);
});
test.each(['already_notified','legacy_uncertain'])('does not republish %s',async state=>{
  rpc.mockReset().mockResolvedValue({data:[{state}],error:null});
  expect(await queueCustomerCouponEmail(db,input)).toBe(state==='already_notified'?'already_notified':'uncertain');
  expect(rpc).toHaveBeenCalledTimes(1);
});
test.each(['pending','processing','success','failed','uncertain'])('handles recorded delivery %s',async status=>{
  rpc.mockReset().mockResolvedValueOnce({data:[reserved],error:null})
    .mockResolvedValueOnce({data:[{id:operationId,status}],error:null});
  expect(await queueCustomerCouponEmail(db,{...input,customerName:''})).toBe(
    status==='success'?'already_notified':status==='failed'||status==='uncertain'?'uncertain':'queued');
});
test.each([
  {data:[reserved],error:{message:'timeout'}},{data:null,error:null},{data:[],error:null},{data:[reserved,reserved],error:null},
])('refuses unconfirmed reservation %#',async result=>{
  rpc.mockReset().mockResolvedValue(result);
  await expect(queueCustomerCouponEmail(db,input)).rejects.toThrow('reservation not confirmed');
  expect(rpc).toHaveBeenCalledTimes(1);
});
test.each([
  {state:'other'},{operation_id:1},{operation_id:'bad'},{coupon_id:1},{coupon_id:'bad'},{code:1},{valid_until:1},
])('rejects invalid reservation %#',async patch=>{
  rpc.mockReset().mockResolvedValue({data:[{...reserved,...patch}],error:null});
  await expect(queueCustomerCouponEmail(db,input)).rejects.toThrow('Invalid coupon email reservation');
  expect(rpc).toHaveBeenCalledTimes(1);
});
test.each([
  {data:[{id:operationId,status:'pending'}],error:{message:'lost response'}},{data:null,error:null},
  {data:[],error:null},{data:[{id:operationId},{id:operationId}],error:null},{data:[{id:couponId}],error:null},
])('never treats uncertain publication as sent %#',async result=>{
  rpc.mockReset().mockResolvedValueOnce({data:[reserved],error:null}).mockResolvedValueOnce(result);
  await expect(queueCustomerCouponEmail(db,input)).rejects.toThrow('publication not confirmed');
});
test('rejects unknown delivery status',async()=>{
  rpc.mockReset().mockResolvedValueOnce({data:[reserved],error:null})
    .mockResolvedValueOnce({data:[{id:operationId,status:'other'}],error:null});
  await expect(queueCustomerCouponEmail(db,input)).rejects.toThrow('Invalid coupon email publication');
});
