/** @jest-environment node */
import React from 'react';
jest.mock('@/lib/supabase-server-auth',()=>({createServerSupabaseAuthClient:jest.fn()}));
jest.mock('@/lib/supabase-server',()=>({createServiceRoleClient:jest.fn()}));
jest.mock('@/lib/coupons',()=>({getCouponsByFacility:jest.fn()}));
jest.mock('next/navigation',()=>({notFound:()=>{throw new Error('not_found');}}));
import Page from '../page';
import {createServerSupabaseAuthClient} from '@/lib/supabase-server-auth';
import {createServiceRoleClient} from '@/lib/supabase-server';
import {getCouponsByFacility} from '@/lib/coupons';
const A='fa730001-0000-4000-8000-000000000001',B='fa730001-0000-4000-8000-000000000002';
const mockRpc=jest.fn();const mockGetUser=jest.fn();const mockMembership=jest.fn();
function elements(value:unknown):React.ReactElement<Record<string,unknown>>[]{
 if(Array.isArray(value))return value.flatMap(elements);
 if(!React.isValidElement<Record<string,unknown>>(value))return [];
 return [value,...elements(value.props.children),...elements(value.props.actions)];
}
beforeEach(()=>{
 jest.clearAllMocks();mockGetUser.mockResolvedValue({data:{user:{id:'actor'}},error:null});
 mockMembership.mockResolvedValue({data:[{facility_id:A,facility_profiles:{name:'A'}},{facility_id:B,facility_profiles:{name:'B'}}],error:null});
 (createServerSupabaseAuthClient as jest.Mock).mockResolvedValue({auth:{getUser:mockGetUser},from:()=>{const q:any={select:()=>q,eq:()=>q,in:()=>q,order:()=>q,limit:mockMembership};return q;}});
 (getCouponsByFacility as jest.Mock).mockResolvedValue([{id:'coupon',name:'Selected',coupon_type:'all',discount_type:'fixed',discount_value:100}]);
 mockRpc.mockResolvedValue({data:[{coupon_id:'coupon',usage_count:1001}],error:null});
 (createServiceRoleClient as jest.Mock).mockReturnValue({rpc:mockRpc});
});
test('multiple stores require explicit selection before reading coupons or private usage',async()=>{await Page({searchParams:Promise.resolve({})});expect(getCouponsByFacility).not.toHaveBeenCalled();expect(mockRpc).not.toHaveBeenCalled();});
test('selected store persists through new/edit links and usage is not capped at 1000',async()=>{const out=await Page({searchParams:Promise.resolve({facility_id:B})});expect(getCouponsByFacility).toHaveBeenCalledWith(B);expect(mockRpc).toHaveBeenCalledWith('get_admin_coupon_usage',{p_actor_id:'actor',p_facility_id:B});const list=elements(out);expect(list.map(x=>x.props.href)).toEqual(expect.arrayContaining([`/admin/coupons/new?facility_id=${B}`,`/admin/coupons/coupon/edit?facility_id=${B}`]));expect(list.some(x=>x.props.children===1001)).toBe(true);});
test('unauthorized store is not replaced with first membership',async()=>{await expect(Page({searchParams:Promise.resolve({facility_id:'fa730001-0000-4000-8000-000000000099'})})).rejects.toThrow('unauthorized');expect(getCouponsByFacility).not.toHaveBeenCalled();});
test('membership failure is not no-store success',async()=>{mockMembership.mockResolvedValue({data:null,error:{code:'08006'}});await expect(Page({searchParams:Promise.resolve({facility_id:B})})).rejects.toThrow('unavailable');});
test('provider error accompanying identity cannot expose usage',async()=>{mockGetUser.mockResolvedValue({data:{user:{id:'actor'}},error:{status:503}});await Page({searchParams:Promise.resolve({facility_id:B})});expect(getCouponsByFacility).not.toHaveBeenCalled();expect(mockRpc).not.toHaveBeenCalled();});
test('unverified identity is denied',async()=>{mockGetUser.mockResolvedValue({data:{user:null},error:null});await expect(Page({searchParams:Promise.resolve({})})).rejects.toThrow('not_found');});
test('usage query failure never becomes zero',async()=>{mockRpc.mockResolvedValue({data:[],error:{code:'08006',message:'private'}});await expect(Page({searchParams:Promise.resolve({facility_id:B})})).rejects.toThrow('DATABASE_FAILURE:08006');});
test.each([null,[],[{coupon_id:'coupon',usage_count:-1}],[{coupon_id:'coupon',usage_count:0},{coupon_id:'coupon',usage_count:0}],[{coupon_id:'coupon',usage_count:Number.MAX_SAFE_INTEGER+1}]])('missing/invalid usage result is not zero: %j',async data=>{mockRpc.mockResolvedValue({data,error:null});await expect(Page({searchParams:Promise.resolve({facility_id:B})})).rejects.toThrow('COUPON_USAGE_UNAVAILABLE');});
test('confirmed no coupons has no private aggregation',async()=>{(getCouponsByFacility as jest.Mock).mockResolvedValue([]);await Page({searchParams:Promise.resolve({facility_id:B})});expect(mockRpc).not.toHaveBeenCalled();});
