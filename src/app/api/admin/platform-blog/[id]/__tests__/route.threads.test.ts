/** @jest-environment node */
jest.mock('@/lib/rate-limit',()=>({checkRateLimit:jest.fn(()=>false)}));
jest.mock('@/lib/csrf',()=>({checkCsrf:jest.fn(()=>null)}));
jest.mock('@/lib/platform-admin',()=>({requirePlatformAdmin:async()=>({id:'admin'})}));
jest.mock('@/lib/audit-logger',()=>({writeAuditLog:jest.fn()}));
jest.mock('@/lib/platform-blog-threads',()=>({publishArticleToThreads:jest.fn(async()=> 'published')}));
jest.mock('@/lib/after-response',()=>({runAfterResponse:jest.fn((action:()=>Promise<unknown>)=>action())}));
const mockFrom=jest.fn();
jest.mock('@/lib/supabase-server',()=>({createServiceRoleClient:()=>({from:mockFrom})}));
import { NextRequest } from 'next/server';
import { runAfterResponse } from '@/lib/after-response';
import { publishArticleToThreads } from '@/lib/platform-blog-threads';
import { PATCH } from '../route';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
beforeEach(()=>jest.clearAllMocks());
test.each([true,false])('updated article published=%s uses the same durable sender',async isPublished=>{
 mockFrom.mockReturnValue({update:()=>({eq:()=>({select:()=>({maybeSingle:async()=>({data:{id,title:'Title',slug:'slug',is_published:isPublished},error:null})})})})});
 const response=await PATCH(new NextRequest('http://localhost/api/admin/platform-blog/'+id,{method:'PATCH',body:JSON.stringify({is_published:isPublished})}),{params:Promise.resolve({id})});
 expect(response.status).toBe(200);expect(runAfterResponse).toHaveBeenCalledTimes(isPublished?1:0);expect(publishArticleToThreads).toHaveBeenCalledTimes(isPublished?1:0);
});
