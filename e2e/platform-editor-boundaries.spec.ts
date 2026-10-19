import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
test.use({trace:'off',screenshot:'off',video:'off',serviceWorkers:'block'});
test.beforeAll(()=>{
 if(process.env.CI!=='true'||process.env.GITHUB_ACTIONS!=='true'||process.env.NEXT_PUBLIC_SUPABASE_URL!=='https://localhost:54330'||process.env.PLAYWRIGHT_BASE_URL!=='https://localhost:3000'||!process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.RESEND_API_KEY||process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK)throw new Error('Editor fixture requires isolated CI without provider credentials');
});
test('platform drafts persist exact values, never enqueue delivery, and reject a revoked editor',async({page})=>{
 const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
 const token=randomUUID(),email=`synthetic-editor-${token}@example.invalid`,password=randomUUID();
 const identity=await db.auth.admin.createUser({email,password,email_confirm:true});if(identity.error||!identity.data.user)throw new Error('Synthetic editor identity unavailable');
 const actor=identity.data.user.id,slug=`synthetic-editor-${token}`,featureTitle=`Synthetic editor ${token}`,changedTitle=`Changed editor ${token}`,subject=`Synthetic draft ${token}`;
 const facilities=[randomUUID(),randomUUID()];
 const headers={Origin:'https://localhost:3000'};
 try{
  expect((await db.from('profiles').update({is_platform_admin:true}).eq('id',actor)).error).toBeNull();
  await page.goto('/auth/login?redirect=%2Fmypage');await page.getByRole('button',{name:'必須のみ',exact:true}).click();
  await page.getByLabel('メールアドレス',{exact:true}).fill(email);await page.getByLabel('パスワード',{exact:true}).fill(password);await page.getByRole('button',{name:'ログイン',exact:true}).click();await page.waitForURL('**/mypage');
  const created=await page.request.post('/api/admin/features',{headers,data:{title:featureTitle,is_active:false,href:null}});expect(created.status()).toBe(201);expect(created.headers()['cache-control']).toBe('no-store');const feature=(await created.json()).feature;
  const changed=await page.request.patch(`/api/admin/features/${feature.id}`,{headers,data:{title:changedTitle,subtitle:'Synthetic detail'}});expect(changed.status()).toBe(200);
  const savedFeature=await db.from('feature_articles').select('title,subtitle,is_active,href').eq('id',feature.id).single();expect(savedFeature.error).toBeNull();expect(savedFeature.data).toEqual({title:changedTitle,subtitle:'Synthetic detail',is_active:false,href:''});
  const posted=await page.request.post('/api/admin/platform-blog',{headers,data:{slug,title:featureTitle,is_published:false,tags:['synthetic'],content:[{b:2,a:1}]}});expect(posted.status()).toBe(201);const post=(await posted.json()).post;
  const edited=await page.request.patch(`/api/admin/platform-blog/${post.id}`,{headers,data:{description:null,category:'Synthetic',content:[{a:3,b:4}]}});expect(edited.status()).toBe(200);
  const savedPost=await db.from('platform_blog_posts').select('description,category,content,tags,is_published,threads_post_id').eq('id',post.id).single();expect(savedPost.error).toBeNull();expect(savedPost.data).toEqual({description:'',category:'Synthetic',content:[{a:3,b:4}],tags:['synthetic'],is_published:false,threads_post_id:null});
  const drafted=await page.request.post('/api/admin/newsletter',{headers,data:{campaign_type:'promo',subject,html_content:'<p>Synthetic draft</p>',text_content:null}});expect(drafted.status()).toBe(201);const campaign=(await drafted.json()).campaign;
  const savedDraft=await db.from('newsletter_campaigns').select('status,created_by,scheduled_at').eq('id',campaign.id).single();expect(savedDraft.error).toBeNull();expect(savedDraft.data).toEqual({status:'draft',created_by:actor,scheduled_at:null});
  const queue=await db.from('webhook_retry_queue').select('id').eq('target_id',campaign.id);expect(queue.error).toBeNull();expect(queue.data).toEqual([]);
  const refusedCancel=await page.request.patch(`/api/admin/newsletter/${campaign.id}`,{headers,data:{action:'cancel'}});expect(refusedCancel.status()).toBe(400);
  await page.goto('/admin/platform-blog');await expect(page.getByText(featureTitle,{exact:true})).toBeVisible();
  await page.goto('/admin/features');await expect(page.getByText(changedTitle,{exact:true})).toBeVisible();
  expect((await db.from('facility_profiles').insert(facilities.map((id,i)=>({id,name:`Synthetic editor facility ${i}`,slug:`synthetic-editor-${token}-${i}`,business_type:'その他',prefecture:'Synthetic',city:'Synthetic',address:'Synthetic',status:'draft'})))).error).toBeNull();
  expect((await db.from('facility_members').insert(facilities.map((facility_id,i)=>({facility_id,user_id:actor,role:i===0?'owner':'admin'})))).error).toBeNull();
  const bulk=await page.request.post('/api/admin/chain/bulk-coupon',{headers,data:{facility_ids:facilities,name:'Synthetic bulk',discount_type:'percentage',discount_value:10}});expect(bulk.status()).toBe(201);
  const coupons=await db.from('coupons').select('facility_id').in('facility_id',facilities);expect(coupons.error).toBeNull();expect(coupons.data?.map(c=>c.facility_id).sort()).toEqual([...facilities].sort());
  expect((await db.from('facility_members').delete().eq('user_id',actor).eq('facility_id',facilities[1])).error).toBeNull();
  const refusedBulk=await page.request.post('/api/admin/chain/bulk-coupon',{headers,data:{facility_ids:facilities,name:'Synthetic refused bulk',discount_type:'percentage',discount_value:10}});expect(refusedBulk.status()).toBe(403);
  const absent=await db.from('coupons').select('id').in('facility_id',facilities).eq('name','Synthetic refused bulk');expect(absent.error).toBeNull();expect(absent.data).toEqual([]);
  const gbp=await page.request.post('/api/admin/gbp/posts',{headers,data:{facility_id:facilities[0],body:'a'+'😀'.repeat(900)}});expect(gbp.status()).toBe(201);
  const savedGbp=await db.from('gbp_posts').select('body,status').eq('facility_id',facilities[0]).single();expect(savedGbp.error).toBeNull();expect(savedGbp.data).toEqual({body:'a'+'😀'.repeat(749),status:'draft'});
  const featureList=await page.request.get('/api/admin/features');expect(featureList.status()).toBe(200);expect((await featureList.json()).features.some((f:{id:string})=>f.id===feature.id)).toBe(true);
  expect((await db.from('profiles').update({is_platform_admin:false}).eq('id',actor)).error).toBeNull();
  const denied=await page.request.patch(`/api/admin/features/${feature.id}`,{headers,data:{is_active:true}});expect(denied.status()).toBe(401);
  const unchanged=await db.from('feature_articles').select('is_active').eq('id',feature.id).single();expect(unchanged.error).toBeNull();expect(unchanged.data?.is_active).toBe(false);
  expect((await db.from('profiles').update({is_platform_admin:true}).eq('id',actor)).error).toBeNull();
  expect((await page.request.delete(`/api/admin/features/${feature.id}`,{headers})).status()).toBe(200);
  expect((await page.request.delete(`/api/admin/platform-blog/${post.id}`,{headers})).status()).toBe(200);
  const remaining=await db.from('platform_blog_posts').select('id').eq('id',post.id);expect(remaining.error).toBeNull();expect(remaining.data).toEqual([]);
 }finally{
  expect((await db.from('feature_articles').delete().in('title',[featureTitle,changedTitle])).error).toBeNull();
  expect((await db.from('platform_blog_posts').delete().eq('slug',slug)).error).toBeNull();
  expect((await db.from('newsletter_campaigns').delete().eq('subject',subject)).error).toBeNull();
  expect((await db.from('facility_profiles').delete().in('id',facilities)).error).toBeNull();
  expect((await db.auth.admin.deleteUser(actor)).error).toBeNull();
 }
});
