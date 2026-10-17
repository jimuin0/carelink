/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
let mockClient: SupabaseClient;
const mockFetch=jest.fn();
jest.mock('@/lib/supabase-server',()=>({createServiceRoleClient:()=>mockClient}));
import { saveAdminStaff } from '../admin-staff-write';
const actor='33333333-3333-4333-8333-333333333333',facility='22222222-2222-4222-8222-222222222222',id='11111111-1111-4111-8111-111111111111';
const input={actorId:actor,facilityId:facility,staffId:id,menuIds:[],values:{name:'Staff'}};
beforeEach(()=>{mockFetch.mockReset();mockClient=createClient('https://menu-sdk.example.invalid','synthetic-service-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:mockFetch}});});
test('real Supabase HTTP encoder sends the verified actor and parses the jsonb receipt',async()=>{
 mockFetch.mockResolvedValue(new Response(JSON.stringify({id,facility_id:facility}),{status:200,headers:{'Content-Type':'application/json'}}));
 expect(await saveAdminStaff(input)).toEqual({id,facility_id:facility});
 const [url,options]=mockFetch.mock.calls[0];expect(new URL(url).pathname).toBe('/rest/v1/rpc/save_admin_staff_atomic');expect(options.method).toBe('POST');expect(JSON.parse(options.body)).toEqual({p_actor_id:actor,p_facility_id:facility,p_staff_id:id,p_values:input.values,p_menu_ids:[]});
});
test('real decoder treats SQL revocation as403 without returning its body',async()=>{
 mockFetch.mockResolvedValue(new Response(JSON.stringify({code:'42501',message:'PRIVATE_MEMBER_DETAIL'}),{status:403,headers:{'Content-Type':'application/json'}}));const r=await saveAdminStaff(input) as NextResponse;expect(r.status).toBe(403);expect(JSON.stringify(await r.json())).not.toContain('PRIVATE_MEMBER_DETAIL');
});
test('HTTP200 with a foreign facility is not successful persistence proof',async()=>{
 mockFetch.mockResolvedValue(new Response(JSON.stringify({id,facility_id:actor}),{status:200,headers:{'Content-Type':'application/json'}}));expect((await saveAdminStaff(input) as NextResponse).status).toBe(500);
});
