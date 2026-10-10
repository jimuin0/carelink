import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { BOOKING_CREATE_PENDING_PREFIX } from '../src/lib/booking-create-client';

// Real local UI -> local API -> real PG17. External providers must be disabled
// in this local dev runtime; this test never seeds an actual customer/account.
test.use({ serviceWorkers:'block', trace:'off', screenshot:'off', video:'off' });
const facilityId=randomUUID(),menuId=randomUUID(),staffId=randomUUID(),slug=`synthetic-receipt-${facilityId}`;
let seeded=false;
// Independent synthetic reverse-proxy IPs keep this multi-browser fixture from exhausting the real slot throttle.
// These headers are used only after the loopback/CSP/database isolation checks.
test.beforeEach(async ({context}) => { await context.setExtraHTTPHeaders({'x-real-ip': '2001:db8:' + randomUUID().replace(/-/g,'').match(/.{1,4}/g)!.slice(0,6).join(':')}); });
function sql(value:string){const p=spawnSync('docker',['exec','-i','supabase_db_carelink','psql','-X','-v','ON_ERROR_STOP=1','-A','-t','-U','postgres','-d','postgres'],{input:value,encoding:'utf8'});if(p.status!==0)throw new Error('Synthetic receipt fixture SQL failed');return p.stdout.trim();}
test.beforeAll(async({request})=>{
  const base=new URL(process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000');
  if(!['localhost','127.0.0.1','[::1]'].includes(base.hostname))throw new Error('Only isolated loopback app allowed');
  const r=await request.get('/register');const csp=r.headers()['content-security-policy'] || '';
  if(!/https?:\/\/(?:127\.0\.0\.1:54321|localhost:54321|localhost:54330)(?:\s|;|$)/.test(csp))throw new Error('Local Supabase CSP required');
  const ci=process.env.CI==='true'&&process.env.GITHUB_ACTIONS==='true';
  if(!ci&&!/^unix:\/\/.+\/\.docker\/run\/docker\.sock$/.test(process.env.DOCKER_HOST || ''))throw new Error('Local Docker socket required');
  sql(`BEGIN;DO $$ BEGIN IF current_database()<>'postgres' OR current_setting('server_version_num')::int/10000<>17 OR to_regclass('public.booking_create_operations') IS NULL THEN RAISE EXCEPTION 'isolated new PG17 catalog required'; END IF; END $$;
    INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status,business_hours) VALUES('${facilityId}','合成受付検証店','${slug}','ヘアサロン','検証県','検証市','合成住所','draft','{"mon":{"open":"09:00","close":"20:00"},"tue":{"open":"09:00","close":"20:00"},"wed":{"open":"09:00","close":"20:00"},"thu":{"open":"09:00","close":"20:00"},"fri":{"open":"09:00","close":"20:00"},"sat":{"open":"09:00","close":"20:00"},"sun":{"open":"09:00","close":"20:00"}}');
    INSERT INTO public.facility_menus(id,facility_id,category,name,price,duration_minutes,is_published) VALUES('${menuId}','${facilityId}','カット','合成受付カット',500,30,true);
    INSERT INTO public.staff_profiles(id,facility_id,name,slug,is_active) VALUES('${staffId}','${facilityId}','合成担当','${slug}-staff',true);
    INSERT INTO public.staff_schedules(staff_id,day_of_week,start_time,end_time) SELECT '${staffId}',d,'09:00','20:00' FROM generate_series(0,6)d;
    INSERT INTO public.facility_photos(facility_id,photo_url,photo_type) VALUES('${facilityId}','${base.origin}/icons/icon-192.png','other');
    UPDATE public.facility_profiles SET status='published' WHERE id='${facilityId}';COMMIT;`);seeded=true;
});
test.afterAll(()=>{if(!seeded)return;sql(`BEGIN;DELETE FROM public.webhook_retry_queue WHERE facility_id='${facilityId}';DELETE FROM public.booking_create_operations WHERE facility_id='${facilityId}';DELETE FROM public.facility_profiles WHERE id='${facilityId}' AND slug='${slug}' AND name='合成受付検証店';COMMIT;`);});
async function isolated(context:BrowserContext){await context.route('**/*',route=>{const url=new URL(route.request().url());return ['localhost','127.0.0.1','[::1]'].includes(url.hostname)?route.continue():route.abort();});}
async function confirm(page:Page){await page.goto(`/facility/${slug}/booking`);await page.getByRole('button',{name:/合成受付カット/}).click();await page.getByRole('button',{name:'次へ（日時を選ぶ）'}).click();await page.locator('table button:not([disabled])').first().click();await page.getByRole('button',{name:'次へ（確認・予約）'}).click();await page.fill('#booking-name','合成受付氏名');await page.fill('#booking-email','synthetic-receipt@example.invalid');}
function operationCount(operation:string){return sql(`SELECT (SELECT count(*) FROM public.bookings b JOIN public.booking_create_operations o ON o.booking_id=b.id WHERE o.id='${operation}'),(SELECT count(*) FROM public.webhook_retry_queue WHERE payload->>'booking_create_operation'='${operation}');`);}
test('lost response after actual commit replays fixed receipt without booking/notification duplication',async({page,context})=>{
  await isolated(context);
  let lost=false,creates=0;const keys:string[]=[];
  await context.route('**/api/booking',async route=>{const request=route.request();const action=request.headers()['x-booking-action'];const key=request.headers()['idempotency-key'];if(key)keys.push(key);if(action==='create'){creates++;if(!lost){lost=true;const response=await route.fetch();expect(response.status()).toBe(200);return route.abort('failed');}}return route.continue();});
  await confirm(page);expect(await page.evaluate(()=>typeof navigator.locks?.request)).toBe('function');await page.getByRole('button',{name:'この内容で予約する'}).click();
  await expect(page.getByRole('button',{name:'受付状況を照合する'})).toBeEnabled();await expect(page.locator('#booking-email')).toBeDisabled();
  const record=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)!),BOOKING_CREATE_PENDING_PREFIX+facilityId);
  expect(Object.keys(record).sort()).toEqual(['id','state']);expect(record.state).toBe('pending');expect(operationCount(record.id)).toBe('1|1');
  await page.getByRole('button',{name:'同じ内容で再確認する'}).click();await expect(page).toHaveURL(/\/booking\/complete\?/);expect(creates).toBe(1);expect(new Set(keys).size).toBe(1);expect(operationCount(record.id)).toBe('1|1');
  await expect(page.getByText(/メール通知は予約の受付とは別に処理/)).toBeVisible();
  await page.goto(`/facility/${slug}/booking`);await expect(page.getByRole('button',{name:'新しい予約を入力する'})).toBeVisible();await page.getByRole('button',{name:'新しい予約を入力する'}).click();await expect(page.getByRole('button',{name:/合成受付カット/})).not.toBeDisabled();
});
test('precommit network failure plus reload closes durable prepared key before guest editing',async({page,context})=>{
  await isolated(context);let prepared:string|null=null;
  await context.route('**/api/booking',async route=>{if(route.request().headers()['x-booking-action']==='create'){prepared=route.request().headers()['idempotency-key'];return route.abort('failed');}return route.continue();});
  await confirm(page);await page.getByRole('button',{name:'この内容で予約する'}).click();await expect(page.getByRole('button',{name:'受付状況を照合する'})).toBeEnabled();expect(prepared).not.toBeNull();expect(operationCount(prepared!)).toBe('0|0');
  await page.reload();await expect(page.getByRole('button',{name:'未受付の終了を確認して編集する'})).toBeVisible();await page.getByRole('button',{name:'未受付の終了を確認して編集する'}).click();
  await expect(page.getByRole('button',{name:/合成受付カット/})).not.toBeDisabled();expect(sql(`SELECT state FROM public.booking_create_operations WHERE id='${prepared}';`)).toBe('closed');expect(operationCount(prepared!)).toBe('0|0');
});

test('two guest tabs serialize first context-cookie handshake before preparing independently scoped receipts',async({page,context})=>{
  await isolated(context);const other=await context.newPage();await confirm(page);await confirm(other);
  expect(await page.evaluate(()=>typeof navigator.locks?.request)).toBe('function');
  let contexts=0,atFirstRelease=0;const operations:string[]=[];
  await context.route('**/api/booking',async route=>{
    const action=route.request().headers()['x-booking-action'];
    if(action==='context'){
      contexts++;
      if(contexts===1){await new Promise(resolve=>setTimeout(resolve,250));atFirstRelease=contexts;}
    }
    if(action==='create'){operations.push(route.request().headers()['idempotency-key']);return route.abort('failed');}
    return route.continue();
  });
  await Promise.all([page.getByRole('button',{name:'この内容で予約する'}).click(),other.getByRole('button',{name:'この内容で予約する'}).click()]);
  await expect(page.getByRole('button',{name:'受付状況を照合する'})).toBeEnabled();await expect(other.getByRole('button',{name:'受付状況を照合する'})).toBeEnabled();
  expect(atFirstRelease).toBe(1);expect(contexts).toBe(2);expect(new Set(operations).size).toBe(2);
  expect(sql(`SELECT count(*),count(DISTINCT guest_scope_hash) FROM public.booking_create_operations WHERE id IN ('${operations[0]}','${operations[1]}') AND state='prepared';`)).toBe('2|1');
  await page.getByRole('button',{name:'未受付の終了を確認して編集する'}).click();await other.getByRole('button',{name:'未受付の終了を確認して編集する'}).click();
  await expect(page.locator('#booking-email')).not.toBeDisabled();await expect(other.locator('#booking-email')).not.toBeDisabled();
});
