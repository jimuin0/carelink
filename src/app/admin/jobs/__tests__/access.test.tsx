/** @jest-environment node */
import {renderToStaticMarkup} from 'react-dom/server';
import Page from '../page';
const mockAuth=jest.fn(),mockMembers=jest.fn(),mockJobs=jest.fn(),mockFrom=jest.fn(),mockService=jest.fn();
jest.mock('@/lib/supabase-server-auth',()=>({createServerSupabaseAuthClient:async()=>({auth:{getUser:mockAuth},from:mockFrom})}));
jest.mock('@/lib/supabase-server',()=>({createServiceRoleClient:()=>mockService()}));
jest.mock('next/navigation',()=>({redirect:()=>{throw new Error('NEXT_REDIRECT');}}));
const user={id:'synthetic-owner'},facility='11111111-1111-4111-8111-111111111111';
const job={id:'synthetic-job',facility_id:facility,title:'Private synthetic vacancy',job_type:'ネイリスト',employment_type:'正社員',created_at:'2026-10-16T00:00:00Z',salary_min:null,salary_max:null,salary_note:null,description:null,requirements:null,benefits:null};
function chain(finish:typeof mockMembers){const q={select:jest.fn(),eq:jest.fn(),in:jest.fn(),order:finish,then:(resolve:unknown,reject:unknown)=>finish().then(resolve,reject)};q.select.mockReturnValue(q);q.eq.mockReturnValue(q);q.in.mockReturnValue(q);return q;}
beforeEach(()=>{jest.clearAllMocks();mockAuth.mockResolvedValue({data:{user},error:null});mockMembers.mockResolvedValue({data:[{facility_id:facility}],error:null});mockJobs.mockResolvedValue({data:[job],error:null});mockFrom.mockReturnValue(chain(mockMembers));mockService.mockReturnValue({from:()=>chain(mockJobs)});});
test.each(['data-error','null-error','throw'])('uncertain auth %s does not read private vacancies or redirect as signed out',async fault=>{
 if(fault==='throw')mockAuth.mockRejectedValue(new Error('private-auth-diagnostic'));else mockAuth.mockResolvedValue({data:{user:fault==='data-error'?user:null},error:{message:'private-auth-diagnostic'}});
 const html=renderToStaticMarkup(await Page());expect(html).toContain('role="alert"');expect(html).not.toContain(job.title);expect(html).not.toContain('新規作成');expect(mockFrom).not.toHaveBeenCalled();expect(mockService).not.toHaveBeenCalled();
});
test.each(['membership','jobs'].flatMap(source=>['data-error','null-error','throw'].map(fault=>[source,fault])))('%s failure %s does not become empty, partial or private controls',async(source,fault)=>{
 const lookup=source==='membership'?mockMembers:mockJobs;
  if(fault==='throw')lookup.mockRejectedValue(new Error('private-db-diagnostic'));else lookup.mockResolvedValue({data:fault==='null-error'?null:source==='membership'?[{facility_id:facility}]:[job],error:{message:'private-db-diagnostic'}});
  const html=renderToStaticMarkup(await Page());expect(html).toContain('role="alert"');expect(html).not.toContain('求人がありません');expect(html).not.toContain('管理可能な施設がありません');expect(html).not.toContain(job.title);expect(html).not.toContain('新規作成');expect(html).not.toContain('private-db-diagnostic');expect(html).toContain('method="get"');
  if(source==='membership')expect(mockService).not.toHaveBeenCalled();
});
test('genuine anonymous remains login redirect',async()=>{mockAuth.mockResolvedValue({data:{user:null},error:null});await expect(Page()).rejects.toThrow('NEXT_REDIRECT');});
test('genuine no membership remains no manageable facilities',async()=>{mockMembers.mockResolvedValue({data:[],error:null});const html=renderToStaticMarkup(await Page());expect(html).toContain('管理可能な施設がありません');expect(html).not.toContain('role="alert"');expect(mockService).not.toHaveBeenCalled();});
test('genuine empty vacancies retains empty state and create control',async()=>{mockJobs.mockResolvedValue({data:[],error:null});const html=renderToStaticMarkup(await Page());expect(html).toContain('求人がありません');expect(html).toContain('新規作成');});
test('verified existing vacancy remains visible',async()=>{const html=renderToStaticMarkup(await Page());expect(html).toContain(job.title);expect(html).toContain('新規作成');expect(html).not.toContain('role="alert"');});
