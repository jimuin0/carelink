/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { buildStatusEnvelope } from '../booking-status-envelope';

const booking = {
  id:'11111111-1111-4111-8111-111111111111',facility_id:'22222222-2222-4222-8222-222222222222',user_id:null as string | null,
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
test('日付をまたぐ予約の状態通知には翌日の終了日を含める', async () => {
  const result=await buildStatusEnvelope(database({facility_profiles:facility}),
    {...booking,booking_date:'2030-01-07',start_time:'23:30',end_date:'2030-01-08',end_time:'00:30'},'confirmed');
  expect(result?.html).toContain('2030年1月7日（月） 23:30〜2030年1月8日（火） 00:30');
});
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
// ゲスト予約（user_id なし）は /mypage では見られない。確定メールはマイページへ案内せず、店舗の連絡先を出す。
test.each([
  [null, false],
  ['33333333-3333-4333-8333-333333333333', true],
])('confirmed mail for user_id=%j links mypage only for members', async (userId, member) => {
  const db=database({facility_profiles:{data:{name:'Synthetic facility',slug:'synthetic-shop',phone:'03-1234-5678',status:'published'},error:null}});
  const result=await buildStatusEnvelope(db,{...booking,user_id:userId},'confirmed');
  expect(result?.html.includes('/mypage')).toBe(member);
  expect(result?.html.includes('/facility/synthetic-shop')).toBe(!member);
});
