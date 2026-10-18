/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { middleware } from '@/middleware';
jest.mock('@supabase/ssr',()=>({createServerClient:jest.fn()}));
const user={id:'ab830000-0000-4000-8000-000000000001'};
function query(result:Promise<unknown>){
 const q={select:jest.fn().mockReturnThis(),eq:jest.fn().mockReturnThis(),in:jest.fn().mockReturnThis(),limit:jest.fn().mockReturnThis(),maybeSingle:jest.fn().mockReturnThis(),single:jest.fn().mockReturnThis(),abortSignal:jest.fn().mockReturnThis(),then:result.then.bind(result)};return q;
}
beforeEach(()=>{jest.useFakeTimers();jest.clearAllMocks();delete process.env.ADMIN_COOKIE_SECRET;});
afterEach(()=>jest.useRealTimers());
test.each([['/admin/settings','facility_members'],['/admin/inquiries','profiles']])('pending %s authority read returns unavailable without granting or pinning denial',async(path,table)=>{
 let resolveLate!:(value:unknown)=>void;
 const pending=query(new Promise(resolve=>{resolveLate=resolve;}));const ready=query(Promise.resolve({data:null,error:null}));
 (createServerClient as jest.Mock).mockReturnValue({auth:{getUser:async()=>({data:{user},error:null})},from:(name:string)=>name===table?pending:ready});
 let response:Awaited<ReturnType<typeof middleware>>|undefined;
 void middleware(new NextRequest('https://carelink.example.invalid'+path)).then(r=>{response=r;});
 await jest.advanceTimersByTimeAsync(5001);
 expect(response).toBeDefined();expect(response!.status).toBe(503);expect(response!.headers.get('Cache-Control')).toBe('no-store');
 expect(response!.headers.get('set-cookie')??'').not.toContain('_cm_mbr_');
 expect(pending.abortSignal.mock.calls[0][0].aborted).toBe(true);
 const unavailable=response;resolveLate({data:table==='profiles'?{is_platform_admin:true}:{role:'owner'},error:null});
 await jest.advanceTimersByTimeAsync(1);expect(response).toBe(unavailable);expect(response!.status).toBe(503);expect(response!.headers.get('set-cookie')??'').not.toContain('_cm_mbr_');
});
