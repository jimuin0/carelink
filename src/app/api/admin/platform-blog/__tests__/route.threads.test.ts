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
import { POST } from '../route';
beforeEach(()=>jest.clearAllMocks());
test.each([true,false])('article published=%s wires durable shared sender through after-response only',async isPublished=>{
 mockFrom.mockReturnValue({insert:()=>({select:()=>({single:async()=>({data:{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',title:'Title',slug:'slug',is_published:isPublished},error:null})})})});
 const response=await POST(new NextRequest('http://localhost/api/admin/platform-blog',{method:'POST',body:JSON.stringify({title:'Title',slug:'slug',is_published:isPublished})}));
 expect(response.status).toBe(201);expect(runAfterResponse).toHaveBeenCalledTimes(isPublished?1:0);expect(publishArticleToThreads).toHaveBeenCalledTimes(isPublished?1:0);
});
test('article insert failure never invokes external delivery',async()=>{
 mockFrom.mockReturnValue({insert:()=>({select:()=>({single:async()=>({data:null,error:{message:'db'}})})})});
 const response=await POST(new NextRequest('http://localhost/api/admin/platform-blog',{method:'POST',body:JSON.stringify({title:'Title',slug:'slug',is_published:true})}));
 expect(response.status).toBe(500);expect(publishArticleToThreads).not.toHaveBeenCalled();
});
