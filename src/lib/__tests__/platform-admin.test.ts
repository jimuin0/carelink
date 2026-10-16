/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '../platform-admin';
const mockGetUser = jest.fn();
const mockProfile = jest.fn();
const mockFrom = jest.fn();
jest.mock('../supabase-server-auth', () => ({ createServerSupabaseAuthClient: async () => ({ auth: { getUser: mockGetUser }, from: mockFrom }) }));
jest.mock('../alert', () => ({ alertCaughtError: jest.fn() }));
const user = { id: 'synthetic-platform-user' };
beforeEach(() => {
 jest.clearAllMocks();
 mockGetUser.mockResolvedValue({data:{user},error:null});
 mockProfile.mockResolvedValue({data:{is_platform_admin:true},error:null});
 mockFrom.mockReturnValue({select:jest.fn().mockReturnThis(),eq:jest.fn().mockReturnThis(),single:mockProfile,maybeSingle:mockProfile});
});
test('fresh verified platform privilege returns the authenticated user',async()=>expect(await requirePlatformAdmin()).toEqual(user));
test('a genuinely absent session preserves the denied result without a privilege query',async()=>{
 mockGetUser.mockResolvedValue({data:{user:null},error:null});expect(await requirePlatformAdmin()).toBeNull();expect(mockFrom).not.toHaveBeenCalled();
});
test.each([null,{is_platform_admin:false}])('a missing or non-admin profile %j cannot authorize platform operations',async data=>{
 mockProfile.mockResolvedValue({data,error:null});expect(await requirePlatformAdmin()).toBeNull();
});
test.each(['auth-data-error','auth-null-error','auth-throw','profile-data-error','profile-null-error','profile-throw'])('%s is unavailable, not authorization or ordinary denial',async fault=>{
 if(fault==='auth-throw')mockGetUser.mockRejectedValue(new Error('private-auth-diagnostic'));
 else if(fault.startsWith('auth'))mockGetUser.mockResolvedValue({data:{user:fault.includes('null')?null:user},error:{message:'private-auth-diagnostic'}});
 if(fault==='profile-throw')mockProfile.mockRejectedValue(new Error('private-profile-diagnostic'));
 else if(fault.startsWith('profile'))mockProfile.mockResolvedValue({data:fault.includes('null')?null:{is_platform_admin:true},error:{message:'private-profile-diagnostic'}});
 const result=await requirePlatformAdmin();expect(result).toBeInstanceOf(NextResponse);
 const response=result as NextResponse;expect(response.status).toBe(503);expect(response.headers.get('cache-control')).toBe('no-store');expect(await response.json()).toMatchObject({code:'AUTH_UNAVAILABLE'});
 if(fault.startsWith('auth'))expect(mockFrom).not.toHaveBeenCalled();
});
