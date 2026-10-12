import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
// Real UI/Auth/API/DB in the managed disposable lifecycle; no provider sends.
test.use({trace:'off',screenshot:'off',video:'off',serviceWorkers:'block'});
test.beforeAll(()=>{
 if(process.env.CI!=='true'||process.env.GITHUB_ACTIONS!=='true'
   ||process.env.NEXT_PUBLIC_SUPABASE_URL!=='https://localhost:54330'
   ||process.env.PLAYWRIGHT_BASE_URL!=='https://localhost:3000'
   ||!process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.RESEND_API_KEY
   ||process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK)throw new Error('Review moderation requires isolated CI without sending credentials');
});
test('displayed content -> stale edit rejected -> refreshed approval -> lost response replays same decision',async({page},info)=>{
 const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
 const email=`synthetic-review-moderation-${randomUUID()}@example.invalid`,password=randomUUID();
 const identity=await db.auth.admin.createUser({email,password,email_confirm:true});
 if(identity.error||!identity.data.user)throw new Error('Synthetic moderation identity unavailable');
 const actor=identity.data.user.id,fid=randomUUID(),rid=randomUUID();
 try{
  const promoted=await db.from('profiles').update({is_platform_admin:true}).eq('id',actor).select('id');
  expect(promoted.error).toBeNull();expect(promoted.data).toHaveLength(1);
  const facility=await db.from('facility_profiles').insert({id:fid,name:'Synthetic moderation facility',slug:`synthetic-moderation-${fid}`,business_type:'その他',prefecture:'合成県',city:'合成市',address:'合成住所',status:'draft'});
  expect(facility.error).toBeNull();
  const review=await db.from('facility_reviews').insert({id:rid,facility_id:fid,user_id:actor,reviewer_name:'Synthetic author',reviewer_ip:'127.0.0.11',rating:4,rating_skill:4,rating_service:4,rating_atmosphere:4,rating_cleanliness:4,rating_explanation:4,comment:'Original synthetic review content',status:'published',is_flagged:true,flag_reason:'Synthetic moderation flag'});
  expect(review.error).toBeNull();
  const queued=await db.from('moderation_queue').select('id').eq('content_id',rid).eq('status','pending').single();
  expect(queued.error).toBeNull();const qid=queued.data!.id;
  await page.setExtraHTTPHeaders({'x-real-ip':`198.51.100.${120+info.retry*2+(info.project.name==='chromium'?0:1)}`});
  await page.goto('/auth/login?redirect=%2Fadmin%2Fmoderation');
  await page.getByRole('button',{name:'必須のみ',exact:true}).click();
  await page.getByLabel('メールアドレス',{exact:true}).fill(email);
  await page.getByLabel('パスワード',{exact:true}).fill(password);
  await page.getByRole('button',{name:'ログイン',exact:true}).click();
  await page.waitForURL('**/admin/moderation');
  const card=page.getByTestId(`moderation-${qid}`);
  await card.getByRole('button',{name:'審査する',exact:true}).click();
  await expect(card.getByText('Original synthetic review content',{exact:true})).toBeVisible();
  await card.getByPlaceholder('審査メモ（任意）').fill('Synthetic observed decision');
  const changed=await db.rpc('edit_review_atomic',{p_actor_id:actor,p_review_id:rid,p_patch:{comment:'Revised synthetic review content'}});
  expect(changed.error).toBeNull();
  await card.getByRole('button',{name:'承認',exact:true}).click();
  await expect(page.getByText('審査状態が変更されています。再読み込みして確認してください',{exact:true})).toBeVisible();
  const pending=await db.from('facility_reviews').select('is_flagged').eq('id',rid).single();
  expect(pending.error).toBeNull();expect(pending.data?.is_flagged).toBe(true);
  await card.getByRole('button',{name:'内容を再取得',exact:true}).click();
  await expect(card.getByText('Revised synthetic review content',{exact:true})).toBeVisible();
  let loseFirst=true;const replies:Array<{status:number;body:unknown}>=[];
  await page.route(`**/api/admin/moderation/${qid}`,async route=>{
   if(route.request().method()!=='PATCH'){await route.continue();return;}
   const response=await route.fetch();replies.push({status:response.status(),body:route.request().postDataJSON()});
   if(loseFirst){loseFirst=false;await route.abort('connectionfailed');return;}
   await route.fulfill({response});
  });
  await card.getByRole('button',{name:'承認',exact:true}).click();
  await expect(page.getByText('審査結果を確認できませんでした。メモは保持されています。再読み込みして状態を確認してください',{exact:true})).toBeVisible();
  await expect(card.getByPlaceholder('審査メモ（任意）')).toHaveValue('Synthetic observed decision');
  await card.getByRole('button',{name:'承認',exact:true}).click();
  await expect(page.getByText('承認しました',{exact:true})).toBeVisible();
  expect(replies.map(reply=>reply.status)).toEqual([200,200]);expect(replies[1].body).toEqual(replies[0].body);
  const persisted=await db.from('facility_reviews').select('comment,status,is_flagged,flag_reason').eq('id',rid).single();
  expect(persisted.error).toBeNull();expect(persisted.data).toEqual({comment:'Revised synthetic review content',status:'published',is_flagged:false,flag_reason:null});
  const decision=await db.from('moderation_queue').select('status,reviewed_by,review_note').eq('id',qid).single();
  expect(decision.error).toBeNull();expect(decision.data).toEqual({status:'approved',reviewed_by:actor,review_note:'Synthetic observed decision'});
 }finally{
  const removed=await db.from('facility_profiles').delete().eq('id',fid);expect(removed.error).toBeNull();
  const removedIdentity=await db.auth.admin.deleteUser(actor);expect(removedIdentity.error).toBeNull();
 }
});
