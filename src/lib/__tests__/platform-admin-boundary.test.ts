/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { NextRequest } from 'next/server';
import { POST as featureCreate } from '@/app/api/admin/features/route';
import { PATCH as featureEdit, DELETE as featureDelete } from '@/app/api/admin/features/[id]/route';
import { POST as articleCreate } from '@/app/api/admin/platform-blog/route';
import { PATCH as articleEdit, DELETE as articleDelete } from '@/app/api/admin/platform-blog/[id]/route';
import { GET as newsletterList, POST as newsletterCreate } from '@/app/api/admin/newsletter/route';
import { PATCH as newsletterAction } from '@/app/api/admin/newsletter/[id]/route';
import { GET as backupRead, POST as backupExport } from '@/app/api/admin/backup/route';
import { GET as moderationRead, PATCH as moderationWrite } from '@/app/api/admin/moderation/[id]/route';
import { GET as flagList, POST as flagCreate } from '@/app/api/admin/feature-flags/route';
import { PATCH as flagEdit } from '@/app/api/admin/feature-flags/[id]/route';
const mockGetUser = jest.fn();
const mockProfile = jest.fn();
const mockFrom = jest.fn();
const mockServiceClient = jest.fn();
jest.mock('../supabase-server-auth', () => ({ createServerSupabaseAuthClient: async () => ({auth:{getUser:mockGetUser},from:mockFrom}) }));
jest.mock('../supabase-server', () => ({createServiceRoleClient:()=>mockServiceClient()}));
jest.mock('../csrf', () => ({checkCsrf:()=>null}));
jest.mock('../rate-limit', () => ({checkRateLimit:async()=>false}));
jest.mock('../alert', () => ({alertCaughtError:jest.fn()}));
jest.mock('../audit-logger', () => ({writeAuditLog:jest.fn(),getRequestContext:()=>({})}));
jest.mock('../after-response', () => ({runAfterResponse:jest.fn()}));
jest.mock('../platform-blog-threads', () => ({publishArticleToThreads:jest.fn()}));
const id='11111111-1111-4111-8111-111111111111';
const user={id:'synthetic-platform-admin'};
const routes=[
 ['feature create','POST',featureCreate],['feature edit','PATCH',featureEdit],['feature delete','DELETE',featureDelete],
 ['article create','POST',articleCreate],['article edit','PATCH',articleEdit],['article delete','DELETE',articleDelete],
 ['newsletter list','GET',newsletterList],['newsletter create','POST',newsletterCreate],['newsletter action','PATCH',newsletterAction],
 ['backup status','GET',backupRead],['backup export','POST',backupExport],
 ['moderation read','GET',moderationRead],['moderation write','PATCH',moderationWrite],
 ['flag list','GET',flagList],['flag create','POST',flagCreate],['flag edit','PATCH',flagEdit],
] as const;
beforeEach(()=>{
 jest.clearAllMocks();
 mockGetUser.mockResolvedValue({data:{user},error:null});
 mockProfile.mockResolvedValue({data:{is_platform_admin:true},error:null});
 mockFrom.mockReturnValue({select:jest.fn().mockReturnThis(),eq:jest.fn().mockReturnThis(),single:mockProfile,maybeSingle:mockProfile});
 mockServiceClient.mockImplementation(()=>{throw new Error('business access must not start');});
});
describe.each(routes)('%s',(_name,method,handler)=>{
 test.each(['auth-data-error','auth-null-error','auth-throw','profile-data-error','profile-null-error','profile-throw'])('%s cannot access platform data or change content',async fault=>{
  if(fault==='auth-throw')mockGetUser.mockRejectedValue(new Error('private-auth-diagnostic'));
  else if(fault.startsWith('auth'))mockGetUser.mockResolvedValue({data:{user:fault.includes('null')?null:user},error:{message:'private-auth-diagnostic'}});
  if(fault==='profile-throw')mockProfile.mockRejectedValue(new Error('private-profile-diagnostic'));
  else if(fault.startsWith('profile'))mockProfile.mockResolvedValue({data:fault.includes('null')?null:{is_platform_admin:true},error:{message:'private-profile-diagnostic'}});
  const req=new NextRequest('https://carelink.invalid/api/admin/test',{method,...(method==='GET'?{}:{headers:{'Content-Type':'application/json'},body:'{}'})});
  const response=await handler(req,{params:Promise.resolve({id})});
  expect(response.status).toBe(503);expect(response.headers.get('cache-control')).toBe('no-store');expect(await response.json()).toMatchObject({code:'AUTH_UNAVAILABLE'});
  expect(mockServiceClient).not.toHaveBeenCalled();
 });
});
