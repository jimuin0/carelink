import {render,screen,fireEvent,waitFor,act} from '@testing-library/react';
import '@testing-library/jest-dom';
const A='fa740001-0000-4000-8000-000000000001',B='fa740001-0000-4000-8000-000000000002';
let mockRequested:string|null=B;
const mockPush=jest.fn(),mockFilters=jest.fn(),mockFetch=jest.fn(),mockFrom=jest.fn();
const mockAuth=jest.fn();
const mockRouter={push:mockPush};
Object.defineProperty(crypto,'randomUUID',{configurable:true,value:jest.fn(()=> 'fa790000-0000-4000-8000-000000000001')});
jest.mock('next/navigation',()=>({useRouter:()=>mockRouter,useSearchParams:()=>({get:()=>mockRequested}),useParams:()=>({id:'coupon'})}));
jest.mock('@/lib/supabase-browser',()=>({createBrowserSupabaseClient:()=>({auth:{getUser:mockAuth},from:mockFrom})}));
import NewPage from '../new/page';
import EditPage from '../[id]/edit/page';
import {couponOperationKey} from '@/lib/coupon-operation';
function chain(result:unknown){const q:any={select:()=>q,eq:(k:string,v:string)=>{mockFilters(k,v);return q;},in:()=>q,order:()=>q,limit:async()=>result,maybeSingle:async()=>result,then:(resolve:any)=>resolve(result)};return q;}
beforeEach(()=>{
 jest.clearAllMocks();sessionStorage.clear();mockRequested=B;global.fetch=mockFetch;
 mockAuth.mockResolvedValue({data:{user:{id:'actor'}},error:null});
 mockFrom.mockImplementation((table:string)=>{
  if(table==='facility_members')return chain({data:[{facility_id:A,facility_profiles:{name:'Store A'}},{facility_id:B,facility_profiles:{name:'Store B'}}],error:null});
  if(table==='coupons')return chain({data:{id:'coupon',facility_id:B,name:'Existing',discount_type:'fixed',discount_value:100,coupon_type:'all'},error:null});
  if(table==='coupon_menus')return chain({data:[{menu_id:'menu'}],error:null});
  return chain({data:[{id:'menu',name:'Menu B',price:1000}],error:null});
 });
 mockFetch.mockResolvedValue({ok:true,json:async()=>({coupon:{id:'saved'}})});
});
test('new coupon does not pick first of several stores; selected store alone supplies menus',async()=>{mockRequested=null;const {rerender}=render(<NewPage/>);await screen.findByText('編集する店舗を選択してください');expect(mockFrom).not.toHaveBeenCalledWith('facility_menus');mockRequested=B;rerender(<NewPage/>);await screen.findByText('Menu B');expect(mockFilters).toHaveBeenCalledWith('facility_id',B);expect(mockFilters).not.toHaveBeenCalledWith('facility_id',A);});
test('new coupon saves selected store and returns to same store list',async()=>{render(<NewPage/>);await screen.findByText('Menu B');fireEvent.change(screen.getByLabelText(/クーポン名/),{target:{value:'Selected new'}});fireEvent.change(screen.getByLabelText(/割引額/),{target:{value:'100'}});fireEvent.click(screen.getByRole('button',{name:'クーポンを作成'}));await waitFor(()=>expect(mockFetch).toHaveBeenCalledWith(`/api/admin/coupons?facility_id=${B}`,expect.objectContaining({method:'POST'})));expect(mockPush).toHaveBeenCalledWith(`/admin/coupons?facility_id=${B}`);});
test('new coupon cannot treat failed menu load as unrestricted empty form',async()=>{const base=mockFrom.getMockImplementation()!;mockFrom.mockImplementation((table:string)=>table==='facility_menus'?chain({data:null,error:{code:'08006'}}):base(table));render(<NewPage/>);await screen.findByRole('alert');expect(screen.queryByRole('button',{name:'クーポンを作成'})).not.toBeInTheDocument();expect(mockFetch).not.toHaveBeenCalled();});
test('dirty store switch and back are confirmed, cancellation preserves entered name',async()=>{render(<NewPage/>);await screen.findByText('Menu B');fireEvent.change(screen.getByLabelText(/クーポン名/),{target:{value:'Draft'}});fireEvent.click(screen.getByRole('link',{name:'Store A'}));await screen.findByRole('dialog');expect(mockPush).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'キャンセル'}));expect(screen.getByLabelText(/クーポン名/)).toHaveValue('Draft');fireEvent.click(screen.getByRole('button',{name:'戻る'}));fireEvent.click(screen.getByRole('button',{name:'破棄して戻る'}));expect(mockPush).toHaveBeenCalledWith(`/admin/coupons?facility_id=${B}`);});
test('edit coupon binds its store and returns to the same selected list after delete',async()=>{render(<EditPage/>);await screen.findByText('Menu B');fireEvent.click(screen.getByRole('button',{name:'このクーポンを削除'}));fireEvent.click(screen.getByRole('button',{name:'削除する'}));await waitFor(()=>expect(mockFetch).toHaveBeenCalledWith(`/api/admin/coupons/coupon?facility_id=${B}`,expect.objectContaining({method:'DELETE',headers:expect.objectContaining({'Idempotency-Key':expect.any(String)})})));expect(mockPush).toHaveBeenCalledWith(`/admin/coupons?facility_id=${B}`);});
test('edit cannot render a public coupon from a different selected store',async()=>{mockRequested=A;render(<EditPage/>);await screen.findByRole('alert');expect(screen.queryByRole('button',{name:'保存',exact:true})).not.toBeInTheDocument();expect(mockFetch).not.toHaveBeenCalled();});
test('edit rejects provider error with identity before loading coupon data',async()=>{mockAuth.mockResolvedValue({data:{user:{id:'actor'}},error:{status:503}});render(<EditPage/>);await screen.findByRole('alert');expect(mockFrom).not.toHaveBeenCalled();});
test('edit mapping load failure cannot silently clear target menus',async()=>{const base=mockFrom.getMockImplementation()!;mockFrom.mockImplementation((table:string)=>table==='coupon_menus'?chain({data:null,error:{code:'08006'}}):base(table));render(<EditPage/>);await screen.findByRole('alert');expect(screen.queryByRole('button',{name:'保存',exact:true})).not.toBeInTheDocument();expect(mockFetch).not.toHaveBeenCalled();});

test('edit saves selected coupon with existing menu restriction',async()=>{render(<EditPage/>);await screen.findByText('Menu B');fireEvent.change(screen.getByLabelText(/クーポン名/),{target:{value:'Updated'}});fireEvent.click(screen.getByRole('button',{name:'保存',exact:true}));await waitFor(()=>expect(mockFetch).toHaveBeenCalledWith(`/api/admin/coupons/coupon?facility_id=${B}`,expect.objectContaining({method:'PATCH'})));expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual(expect.objectContaining({name:'Updated',target_menu_ids:['menu']}));});

test('late old-store response cannot replace new-store form or input',async()=>{
 const base=mockFrom.getMockImplementation()!;
 let finishOld:(x:unknown)=>void=()=>{};
 const oldResult=new Promise(resolve=>{finishOld=resolve;});
 mockFrom.mockImplementation((table:string)=>{
  if(table!=='facility_menus')return base(table);
  let selected:string|null=null;
  const q:any={select:()=>q,eq:(key:string,value:string)=>{selected=value;mockFilters(key,value);return q;},order:()=>selected===B?oldResult:Promise.resolve({data:[{id:'menu-a',name:'Menu A',price:500}],error:null})};return q;
 });
 const {rerender}=render(<NewPage/>);
 await waitFor(()=>expect(mockFilters).toHaveBeenCalledWith('facility_id',B));
 mockRequested=A;rerender(<NewPage/>);await screen.findByText('Menu A');
 fireEvent.change(screen.getByLabelText(/クーポン名/),{target:{value:'Store A draft'}});
 await act(async()=>{finishOld({data:[{id:'menu',name:'Menu B',price:1000}],error:null});});
 expect(screen.queryByText('Menu B')).not.toBeInTheDocument();expect(screen.getByLabelText(/クーポン名/)).toHaveValue('Store A draft');
});

test('lost create response preserves one operation ID for retry',async()=>{
 (crypto.randomUUID as jest.Mock).mockReturnValueOnce('fa790000-0000-4000-8000-000000000001').mockReturnValue('fa790000-0000-4000-8000-000000000002');
 mockFetch.mockRejectedValueOnce(new Error('response lost')).mockResolvedValue({ok:true,json:async()=>({coupon:{id:'saved'}})});
 render(<NewPage/>);await screen.findByText('Menu B');fireEvent.change(screen.getByLabelText(/クーポン名/),{target:{value:'Once'}});fireEvent.change(screen.getByLabelText(/割引額/),{target:{value:'100'}});
 fireEvent.click(screen.getByRole('button',{name:'クーポンを作成'}));await screen.findByText('通信エラーが発生しました');
 fireEvent.click(screen.getByRole('button',{name:'クーポンを作成'}));await waitFor(()=>expect(mockPush).toHaveBeenCalledWith(`/admin/coupons?facility_id=${B}`));
 expect(mockFetch.mock.calls[0][1].headers['Idempotency-Key']).toBe(mockFetch.mock.calls[1][1].headers['Idempotency-Key']);expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
});

test('reload confirms a saved operation and opens the same list without resubmitting',async()=>{
 sessionStorage.setItem(couponOperationKey('actor',B,'create'),'fa790000-0000-4000-8000-000000000001');mockFetch.mockResolvedValue({ok:true,json:async()=>({state:'saved'})});
 render(<NewPage/>);await waitFor(()=>expect(mockPush).toHaveBeenCalledWith(`/admin/coupons?facility_id=${B}`));expect(mockFetch).toHaveBeenCalledTimes(1);expect(mockFetch.mock.calls[0][1]).toEqual({cache:'no-store'});
});
