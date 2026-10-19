/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
jest.mock('@/lib/supabase-server',()=>({createServiceRoleClient:()=>({rpc:mockRpc})}));
jest.mock('@/lib/with-route',()=>({serverError:()=>NextResponse.json({error:'Unavailable'},{status:500})}));
const mockRpc=jest.fn();
import { NextResponse } from 'next/server';
import { writePlatformEditor } from '../platform-editor-write';
const id='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222';
const feature={id,title:'Synthetic feature',is_active:false};
const post={id,title:'Synthetic post',slug:'synthetic-post',is_published:false};
const draft={id,subject:'Synthetic draft',status:'draft',created_by:actor,scheduled_at:null};
beforeEach(()=>mockRpc.mockReset());
test.each([
 ['feature','create',null,{title:feature.title,is_active:false},feature],
 ['feature','update',id,{title:feature.title},feature],
 ['feature','delete',id,{},feature],
 ['post','create',null,{slug:post.slug,title:post.title},post],
 ['post','update',id,{is_published:false},post],
 ['post','delete',id,{},post],
 ['newsletter','create',null,{subject:draft.subject},draft],
 ['newsletter','cancel',id,{}, {...draft,status:'cancelled',created_by:null}],
] as const)('%s:%s confirms exact target, actor and values',async(target,action,record,values,data)=>{
 mockRpc.mockResolvedValue({data,error:null});const result=await writePlatformEditor(actor,record,target,action,values,'/test');expect(result).toEqual(data);
 expect(mockRpc).toHaveBeenCalledWith('manage_platform_editor_atomic',{p_actor_id:actor,p_record_id:record,p_kind:`${target}:${action}`,p_values:values,p_expected_image_url:null});
});
test('image exemption is a separate locked precondition',async()=>{
 const url='https://example.invalid/legacy';mockRpc.mockResolvedValue({data:{...feature,image_url:url},error:null});
 expect(await writePlatformEditor(actor,id,'feature','update',{image_url:url},'/test',url)).not.toBeInstanceOf(NextResponse);
 expect(mockRpc.mock.calls[0][1].p_expected_image_url).toBe(url);
});
test('JSON receipt tolerates key ordering, serializes negative zero and omits undefined',async()=>{
 const data={...post,content:[{b:2,a:0}],tags:['a']};mockRpc.mockResolvedValue({data,error:null});
 const result=await writePlatformEditor(actor,id,'post','update',{content:[{a:-0,b:2}],tags:['a'],description:undefined},'/test');expect(result).toEqual(data);
 expect(mockRpc.mock.calls[0][1].p_values).not.toHaveProperty('description');
});
test('UUID identity comparison accepts canonical casing',async()=>{
 const upper='AAAA1111-1111-4111-8111-111111111111';mockRpc.mockResolvedValue({data:{...feature,id:upper.toLowerCase()},error:null});expect(await writePlatformEditor(actor,upper,'feature','update',{is_active:false},'/test')).not.toBeInstanceOf(NextResponse);
});
test.each([['42501',403],['P0002',404],['22023',400],['23505',409],['40001',409],['08006',500],['',500]])('error %s refuses accompanying data with %s',async(code,status)=>{
 mockRpc.mockResolvedValue({data:feature,error:{code,message:'private failure'}});const res=await writePlatformEditor(actor,id,'feature','update',{title:feature.title},'/test') as NextResponse;expect(res.status).toBe(status);expect(await res.text()).not.toContain('private failure');
});
test.each([null,[],{},false,{...feature,id:'invalid'},{...feature,id:actor},{...feature,is_active:'false'}])('reject malformed or cross-record receipt %p',async data=>{
 mockRpc.mockResolvedValue({data,error:null});expect((await writePlatformEditor(actor,id,'feature','update',{is_active:false},'/test') as NextResponse).status).toBe(500);
});
test.each([
 ['feature','update',{title:'wrong'},feature],['post','update',{content:[{a:1}]},{...post,content:[{a:2}]}],['newsletter','create',{subject:'wrong'},draft],
] as const)('reject %s contradictory receipt',async(target,action,values,data)=>{
 mockRpc.mockResolvedValue({data,error:null});expect((await writePlatformEditor(actor,action==='create'?null:id,target,action,values,'/test') as NextResponse).status).toBe(500);
});
test.each([{...draft,status:'scheduled'},{...draft,created_by:id},{...draft,scheduled_at:'2027-01-01'}])('draft creation refuses unauthorized state %p',async data=>{
 mockRpc.mockResolvedValue({data,error:null});expect((await writePlatformEditor(actor,null,'newsletter','create',{subject:draft.subject},'/test') as NextResponse).status).toBe(500);
});
test('cancel refuses a receipt that did not cancel',async()=>{
 mockRpc.mockResolvedValue({data:draft,error:null});expect((await writePlatformEditor(actor,id,'newsletter','cancel',{},'/test') as NextResponse).status).toBe(500);
});
