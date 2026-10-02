/** @jest-environment node */
import { buildStatusEnvelope } from '../booking-status-envelope';

const booking = {
  id:'11111111-1111-4111-8111-111111111111',facility_id:'22222222-2222-4222-8222-222222222222',
  customer_name:'Synthetic',email:'synthetic@example.invalid',booking_date:'2030-01-07',
  start_time:'10:00',end_time:'11:00',total_price:null,menu_id:null,menu_ids:null,staff_id:null,
};
function database(results: Record<string, { data:unknown; error:unknown }>) {
  const from = jest.fn((table:string) => {
    const result = results[table] ?? { data:null,error:null };
    const chain = {
      select:jest.fn(() => chain),eq:jest.fn(() => chain),in:jest.fn(() => Promise.resolve(result)),
      single:jest.fn(() => Promise.resolve(result)),maybeSingle:jest.fn(() => Promise.resolve(result)),
    };
    return chain;
  });
  return { from } as unknown as Parameters<typeof buildStatusEnvelope>[0];
}
const facility = { data:{ name:'Synthetic facility' },error:null };
test.each([null,''])('missing email %j reserves no provider envelope', async email => {
  const db=database({}); expect(await buildStatusEnvelope(db,{...booking,email},'confirmed')).toBeNull();
  expect(db.from).not.toHaveBeenCalled();
});
test('internal arrival reserves no email', async () => {
  const db=database({}); expect(await buildStatusEnvelope(db,booking,'arrived')).toBeNull();
  expect(db.from).not.toHaveBeenCalled();
});
test.each([{data:null,error:null},{data:{name:''},error:null},{data:null,error:{message:'unavailable'}}])(
  'unavailable facility %j rejects before the status transaction', async result => {
    await expect(buildStatusEnvelope(database({facility_profiles:result}),booking,'confirmed')).rejects.toThrow('facility unavailable');
  });
test('legacy single menu is preserved in cancellation envelope', async () => {
  const db=database({facility_profiles:facility,facility_menus:{data:[{id:'legacy',name:'Legacy synthetic'}],error:null}});
  const result=await buildStatusEnvelope(db,{...booking,menu_id:'legacy'},'cancelled');
  expect(result?.html).toContain('Legacy synthetic');
});
test('all menus keep selected order and missing menu is explicit', async () => {
  const db=database({facility_profiles:facility,facility_menus:{data:[{id:'a',name:'Synthetic A'}],error:null}});
  const result=await buildStatusEnvelope(db,{...booking,menu_ids:['removed','a']},'confirmed');
  expect(result?.html).toContain('削除済みメニュー、Synthetic A');
});
test.each([{data:null,error:null},{data:[],error:{message:'unavailable'}}])(
  'menu dependency %j does not silently become an empty catalog', async result => {
    await expect(buildStatusEnvelope(database({facility_profiles:facility,facility_menus:result}),
      {...booking,menu_ids:['a']},'confirmed')).rejects.toThrow('menus unavailable');
  });
test('staff failure prevents status notification reservation', async () => {
  await expect(buildStatusEnvelope(database({facility_profiles:facility,staff_profiles:{data:null,error:{message:'unavailable'}}}),
    {...booking,staff_id:'synthetic-staff'},'confirmed')).rejects.toThrow('staff unavailable');
});
test.each([null,{name:'Synthetic staff'}])('optional staff %j and empty selected menus build status update', async staff => {
  const result=await buildStatusEnvelope(database({facility_profiles:facility,staff_profiles:{data:staff,error:null}}),
    {...booking,menu_ids:[],staff_id:'synthetic-staff',total_price:1000},'completed','Synthetic reason');
  expect(result?.to).toBe(booking.email);
});
