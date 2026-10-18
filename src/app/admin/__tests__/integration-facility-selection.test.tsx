/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Gbp from '../gbp/page';
import WhiteLabel from '../white-label/page';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
const first='aa810000-0000-4000-8000-000000000001';
const second='aa810000-0000-4000-8000-000000000002';
let mockQuery='';
const mockPush=jest.fn();
jest.mock('next/navigation',()=>({useSearchParams:()=>new URLSearchParams(mockQuery),useRouter:()=>({push:mockPush})}));
jest.mock('@/lib/supabase-browser',()=>({createBrowserSupabaseClient:jest.fn()}));
const auth=jest.fn(),profile=jest.fn();let membershipError:unknown=null;
function domain(id=second){return {id,facility_id:id,domain:id===first?'first.example.invalid':'second.example.invalid',is_verified:false,txt_record:'carelink-verify=synthetic',primary_color:'#0ea5e9',brand_name:'Synthetic',logo_url:null};}
beforeEach(()=>{
 jest.clearAllMocks();mockQuery='';membershipError=null;
 auth.mockResolvedValue({data:{user:{id:'synthetic-user'}},error:null});
 profile.mockImplementation(async(id:string)=>({data:{gbp_place_id:id===first?'FirstPlace':'SecondPlace',gbp_cid:''},error:null}));
 (createBrowserSupabaseClient as jest.Mock).mockReturnValue({auth:{getUser:auth},from:(table:string)=>{
  const rows=[{facility_id:first,facility_profiles:{name:'合成店舗A'}},{facility_id:second,facility_profiles:{name:'合成店舗B'}}];let id='';
  const q={select:jest.fn().mockReturnThis(),eq:jest.fn((_key:string,value:string)=>{id=value;return q;}),in:jest.fn().mockReturnThis(),order:jest.fn().mockReturnThis(),limit:jest.fn().mockReturnThis(),
   then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:rows,error:membershipError}).then(resolve),
   single:()=>table==='facility_members'?Promise.resolve({data:rows[0],error:membershipError}):profile(id),maybeSingle:()=>profile(id)};return q;
 }});
 global.fetch=jest.fn(async(input,init)=>{
  const url=new URL(String(input),'https://carelink.example.invalid');const id=url.searchParams.get('facility_id');
  if(!init?.method&&id!==first&&id!==second)return {ok:false,json:async()=>({error:'施設を指定してください'})};
  if(url.pathname==='/api/admin/white-label/verify')return {ok:true,json:async()=>({verified:true})};
  if(url.pathname==='/api/admin/white-label')return {ok:true,json:async()=>({config:domain(init?.body?JSON.parse(String(init.body)).facility_id:id)})};
  return {ok:true,json:async()=>({ok:true,posts:[],placeData:null,audit:{score:80,items:[]}})};
 }) as jest.Mock;
});
const pages=[['GBP',Gbp],['domain',WhiteLabel]] as const;
test.each(pages)('%s requires a selection for two memberships before showing a form',async(_name,Page)=>{
 render(<Page/>);await screen.findByText('編集する店舗を選択してください');expect(screen.queryByRole('textbox')).toBeNull();expect(global.fetch).not.toHaveBeenCalled();
});
test('GBP explicitly scopes connect, audit and post-list requests to selected second store',async()=>{
 mockQuery='facility_id='+second;render(<Gbp/>);await screen.findByDisplayValue('SecondPlace');
 fireEvent.click(screen.getByRole('button',{name:'保存',exact:true}));await waitFor(()=>expect(global.fetch).toHaveBeenCalledWith('/api/admin/gbp/place',expect.objectContaining({body:JSON.stringify({gbp_place_id:'SecondPlace',gbp_cid:'',facility_id:second})})));
 fireEvent.click(screen.getByRole('button',{name:'診断スコア',exact:true}));await waitFor(()=>expect(global.fetch).toHaveBeenCalledWith('/api/admin/gbp/place?facility_id='+second));
 fireEvent.click(screen.getByRole('button',{name:'GBP投稿',exact:true}));await waitFor(()=>expect(global.fetch).toHaveBeenCalledWith('/api/admin/gbp/posts?facility_id='+second));
});
test('domain read, configure and verify use the same explicitly selected store',async()=>{
 mockQuery='facility_id='+second;render(<WhiteLabel/>);await screen.findByDisplayValue('second.example.invalid');
 expect(global.fetch).toHaveBeenCalledWith('/api/admin/white-label?facility_id='+second);
 fireEvent.click(screen.getByRole('button',{name:'認証を確認する'}));await waitFor(()=>expect(global.fetch).toHaveBeenCalledWith('/api/admin/white-label/verify',expect.objectContaining({body:JSON.stringify({facility_id:second})})));
 await screen.findByText('ドメインを認証しました！');
 await waitFor(()=>expect((screen.getByRole('button',{name:'設定を保存'}) as HTMLButtonElement).disabled).toBe(false));
 fireEvent.click(screen.getByRole('button',{name:'設定を保存'}));await waitFor(()=>expect((global.fetch as jest.Mock).mock.calls.some(([url,init])=>url==='/api/admin/white-label'&&JSON.parse(init.body).facility_id===second)).toBe(true));
});
test.each(pages)('%s auth observation error with a user never exposes mutation controls',async(_name,Page)=>{
 auth.mockResolvedValue({data:{user:{id:'synthetic-user'}},error:{status:503}});mockQuery='facility_id='+second;render(<Page/>);await screen.findByRole('alert');expect(screen.queryByRole('textbox')).toBeNull();expect(global.fetch).not.toHaveBeenCalled();
});
test.each(pages)('%s membership read failure cannot become a blank editable form',async(_name,Page)=>{
 membershipError={code:'08006'};mockQuery='facility_id='+second;render(<Page/>);await screen.findByRole('alert');expect(screen.queryByRole('textbox')).toBeNull();expect(global.fetch).not.toHaveBeenCalled();
});
test.each(pages)('%s foreign selection cannot fall back to first membership',async(_name,Page)=>{
 mockQuery='facility_id=aa810000-0000-4000-8000-000000000099';render(<Page/>);await screen.findByRole('alert');expect(screen.queryByRole('textbox')).toBeNull();expect(global.fetch).not.toHaveBeenCalled();
});

test.each(pages)('%s a late previous-tenant read cannot replace the newly selected form',async(name,Page)=>{
 let resolveOld!:(value:unknown)=>void;
 const old=new Promise(resolve=>{resolveOld=resolve;});
 if(name==='GBP')profile.mockImplementation((id:string)=>id===first?old:Promise.resolve({data:{gbp_place_id:'SecondPlace',gbp_cid:''},error:null}));
 else {const base=(global.fetch as jest.Mock).getMockImplementation()!;(global.fetch as jest.Mock).mockImplementation((url,init)=>String(url).includes('facility_id='+first)?old:base(url,init));}
 mockQuery='facility_id='+first;const view=render(<Page/>);
 await waitFor(()=>name==='GBP'?expect(profile).toHaveBeenCalledWith(first):expect(global.fetch).toHaveBeenCalledWith('/api/admin/white-label?facility_id='+first));
 mockQuery='facility_id='+second;view.rerender(<Page/>);
 const selectedValue=name==='GBP'?'SecondPlace':'second.example.invalid';await screen.findByDisplayValue(selectedValue);
 await act(async()=>{resolveOld(name==='GBP'?{data:{gbp_place_id:'FirstPlace',gbp_cid:''},error:null}:{ok:true,json:async()=>({config:domain(first)})});await old;});
 expect(screen.getByDisplayValue(selectedValue)).toBeTruthy();expect(screen.queryByDisplayValue(name==='GBP'?'FirstPlace':'first.example.invalid')).toBeNull();
});
test('domain unsaved input is retained when tenant-switch confirmation is cancelled',async()=>{
 mockQuery='facility_id='+second;render(<WhiteLabel/>);const input=await screen.findByDisplayValue('second.example.invalid');
 fireEvent.change(input,{target:{value:'edited.example.invalid'}});fireEvent.click(screen.getByRole('link',{name:'合成店舗A',exact:true}));
 fireEvent.click(screen.getByRole('button',{name:'キャンセル',exact:true}));expect(screen.getByDisplayValue('edited.example.invalid')).toBeTruthy();expect(mockPush).not.toHaveBeenCalled();
});

test('a malformed verification response cannot label the selected domain verified',async()=>{
 const base=(global.fetch as jest.Mock).getMockImplementation()!;
 (global.fetch as jest.Mock).mockImplementation((url,init)=>url==='/api/admin/white-label/verify'?Promise.resolve({ok:true,json:async()=>({verified:'false'})}):base(url,init));
 mockQuery='facility_id='+second;render(<WhiteLabel/>);await screen.findByDisplayValue('second.example.invalid');
 fireEvent.click(screen.getByRole('button',{name:'認証を確認する'}));
 await screen.findByText('DNS TXTレコードが確認できませんでした。設定を確認してください。');
 expect(screen.queryByText('ドメイン認証済み')).toBeNull();expect(screen.queryByText('ドメインを認証しました！')).toBeNull();
});
