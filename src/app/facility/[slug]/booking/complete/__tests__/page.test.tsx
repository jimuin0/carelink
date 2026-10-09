/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
const mockStatus=jest.fn();
jest.mock('@/lib/supabase-server',()=>({createServiceRoleClient:()=>({from:()=>({select:()=>({eq:()=>({maybeSingle:mockStatus})})})})}));
jest.mock('@/lib/intake-config',()=>({INTAKE_CUSTOMER_ENABLED:false}));
jest.mock('@/components/push/PushPermissionBanner',()=>({__esModule:true,default:()=>null}));
import BookingCompletePage from '../page';
const props={params:Promise.resolve({slug:'synthetic'}),searchParams:Promise.resolve({id:'beaf0000-0000-4000-8000-000000000001',date:'2030-01-07',time:'10:00',end_time:'10:30',facility:'Synthetic'})};
beforeEach(()=>{jest.clearAllMocks();});
it.each([
 ['pending','予約を受け付けました','施設からの確認をお待ちください。',true],
 ['confirmed','予約を受け付けました','ご予約が確定しました。ご来店をお待ちしております。',true],
 ['arrived','来店受付が完了しています','現在、この予約は来店受付済みです。',false],
 ['completed','この予約は対応済みです','この予約の来店対応は完了しています。',false],
 ['cancelled','この予約は終了しています','この予約はキャンセル済みです。',false],
 ['no_show','この予約は終了しています','この予約は来店なしとして終了しています。',false],
 ['cancel_fee_paid','この予約は終了しています','この予約はキャンセル済みで、手続きが完了しています。',false],
])('current status %s does not falsely claim confirmation waiting or email delivery',async(status,title,message,active)=>{
 mockStatus.mockResolvedValue({data:{status}});render(await BookingCompletePage(props));
 expect(screen.getByRole('heading',{name:title as string})).toBeVisible();expect(screen.getByText(message as string,{exact:false})).toBeVisible();
 expect(screen.getByText(/メール通知は予約の受付とは別に処理/)).toBeVisible();
 expect(screen.queryByRole('link',{name:'カレンダーに追加（.ics）'})!==null).toBe(active);
});
it.each([null,{status:'unknown'}])('unknown booking state %# is visibly unconfirmed, no calendar promise',async data=>{
 mockStatus.mockResolvedValue({data});render(await BookingCompletePage(props));expect(screen.getByRole('heading',{name:'予約の受付状況を確認しています'})).toBeVisible();expect(screen.queryByRole('link',{name:'カレンダーに追加（.ics）'})).toBeNull();
});
it('dependency rejection cannot show the booking as confirmed',async()=>{mockStatus.mockRejectedValue(new Error('synthetic'));render(await BookingCompletePage(props));expect(screen.getByText(/予約番号で店舗へ確認/)).toBeVisible();});
