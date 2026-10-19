/** @jest-environment node */
import { renderToStaticMarkup } from 'react-dom/server';
import EmailGuide from '../email-setup/layout';
import LineGuide from '../line-richmenu/layout';
import Features from '../features/layout';
import Flags from '../feature-flags/layout';
import Experiments from '../ab-tests/layout';
import Moderation from '../moderation/layout';
const mockGetUser=jest.fn(),mockProfile=jest.fn(),mockFrom=jest.fn();
jest.mock('@/lib/supabase-server-auth',()=>({createServerSupabaseAuthClient:async()=>({auth:{getUser:mockGetUser},from:mockFrom})}));
jest.mock('next/navigation',()=>({notFound:()=>{throw new Error('NEXT_NOT_FOUND');}}));
jest.mock('@/lib/alert',()=>({alertCaughtError:jest.fn()}));
const user={id:'synthetic-platform-user'};
beforeEach(()=>{
 jest.clearAllMocks();mockGetUser.mockResolvedValue({data:{user},error:null});mockProfile.mockResolvedValue({data:{is_platform_admin:true},error:null});
 mockFrom.mockReturnValue({select:jest.fn().mockReturnThis(),eq:jest.fn().mockReturnThis(),single:mockProfile,maybeSingle:mockProfile});
});
describe.each([['email guide',EmailGuide],['LINE guide',LineGuide],['features',Features],['flags',Flags],['experiments',Experiments],['moderation',Moderation]] as const)('%s layout',(_name,Layout)=>{
 test('confirmed platform access preserves private children',async()=>{
  const html=renderToStaticMarkup(await Layout({children:<div>private-controls</div>}));expect(html).toContain('private-controls');expect(html).not.toContain('role="alert"');
 });
 test.each(['anonymous','non-admin','no-profile'])('genuine denial %s retains not found',async mode=>{
  if(mode==='anonymous')mockGetUser.mockResolvedValue({data:{user:null},error:null});
  else mockProfile.mockResolvedValue({data:mode==='no-profile'?null:{is_platform_admin:false},error:null});
  await expect(Layout({children:<div>private-controls</div>})).rejects.toThrow('NEXT_NOT_FOUND');
 });
 test.each(['auth-data-error','auth-null-error','auth-throw','profile-data-error','profile-null-error','profile-throw'])('%s shows retry without private children or false not found',async fault=>{
  if(fault==='auth-throw')mockGetUser.mockRejectedValue(new Error('private-auth-diagnostic'));
  else if(fault.startsWith('auth'))mockGetUser.mockResolvedValue({data:{user:fault.includes('null')?null:user},error:{message:'private-auth-diagnostic'}});
  if(fault==='profile-throw')mockProfile.mockRejectedValue(new Error('private-profile-diagnostic'));
  else if(fault.startsWith('profile'))mockProfile.mockResolvedValue({data:fault.includes('null')?null:{is_platform_admin:true},error:{message:'private-profile-diagnostic'}});
  const html=renderToStaticMarkup(await Layout({children:<div>private-controls</div>}));
  expect(html).toContain('role="alert"');expect(html).toContain('利用権限を再確認');expect(html).not.toContain('private-controls');
  if(fault.startsWith('auth'))expect(mockFrom).not.toHaveBeenCalled();
 });
});
