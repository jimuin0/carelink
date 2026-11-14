/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { NextResponse } from 'next/server';
import { requirePlatformAdmin, requirePlatformAdminApi } from '../platform-admin';
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

describe('requirePlatformAdminApi（点検 A205）', () => {
 test('運営はユーザーを返す',async()=>expect(await requirePlatformAdminApi()).toEqual(user));
 test('未ログインだけが 401',async()=>{
  mockGetUser.mockResolvedValue({data:{user:null},error:null});
  const res=await requirePlatformAdminApi({headers:{'Cache-Control':'no-store'}}) as NextResponse;
  expect(res.status).toBe(401);expect(await res.json()).toEqual({error:'ログインしてください'});expect(res.headers.get('cache-control')).toBe('no-store');
 });
 test.each([null,{is_platform_admin:false}])('ログイン済みで権限なし %j は 403「権限がありません」',async data=>{
  mockProfile.mockResolvedValue({data,error:null});
  const res=await requirePlatformAdminApi({body:{state:'forbidden'}}) as NextResponse;
  expect(res.status).toBe(403);expect(await res.json()).toEqual({error:'権限がありません',state:'forbidden'});
 });
 test('依存の失敗は 503 のまま',async()=>{
  mockGetUser.mockRejectedValue(new Error('x'));
  expect((await requirePlatformAdminApi() as NextResponse).status).toBe(503);
 });
});
