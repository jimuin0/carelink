/** @jest-environment node */
import { renderToStaticMarkup } from 'react-dom/server';
import AdminSchedulePage from '../page';
const mockOr=jest.fn();
const date1='2030-01-07', date2='2030-01-08';
const data:Record<string,unknown>={
 facility_profiles:{board_slot_minutes:60,business_hours:{sun:null,mon:{open:'18:00',close:'05:00'},tue:null,wed:null,thu:null,fri:null,sat:null}},
 staff_profiles:[{id:'staff',name:'担当',position:null,nomination_fee:0}],
 facility_menus:[],
 bookings:[{id:'night',customer_name:'合成',booking_date:date1,end_date:date2,start_time:'23:30',end_time:'00:30',status:'confirmed',staff_id:'staff',menu_id:null,menu_ids:null}],
};
jest.mock('@/lib/admin-facility-selection',()=>({loadAdminFacilitySelection:async()=>({choices:[],selectedId:'facility'})}));
jest.mock('@/lib/supabase-server-auth',()=>({createServerSupabaseAuthClient:async()=>({
 auth:{getUser:async()=>({data:{user:{id:'owner'}}})},from:(table:string)=>{
  const chain:any={};for(const method of ['select','eq','neq','order'])chain[method]=()=>chain;
  chain.or=(value:string)=>{mockOr(value);return chain;};
  chain.maybeSingle=async()=>({data:data[table],error:null});
  chain.then=(resolve:(v:unknown)=>void)=>resolve({data:data[table],error:null});
  return chain;
 }
})}));
jest.mock('@/components/admin/FacilitySelector',()=>()=>null);
jest.mock('@/components/admin/BoardScheduleGrid',()=>({__esModule:true,default:({rows}:any)=><pre>{JSON.stringify(rows)}</pre>}));
test.each([[date1,'23:30','24:00','continuesToNext'],[date2,'00:00','00:30','continuesFromPrevious']])(
 '予約表の %s に日付内の区間を表示する',async(date,start,end,marker)=>{
  const html=renderToStaticMarkup(await AdminSchedulePage({searchParams:Promise.resolve({date,facility_id:'facility'})}));
  expect(html).toContain(`&quot;start_time&quot;:&quot;${start}&quot;`);
  expect(html).toContain(`&quot;end_time&quot;:&quot;${end}&quot;`);
  expect(html).toContain(`&quot;${marker}&quot;:true`);
  expect(mockOr).toHaveBeenCalledWith(expect.stringContaining(`end_date.eq.${date}`));
 });
