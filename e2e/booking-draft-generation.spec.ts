import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { CLIENT_CLEANUP_GENERATION_KEY, CLIENT_BOOKING_DRAFT_META_PREFIX } from '../src/lib/client-cleanup-marker';
import { bookingDraftKey } from '../src/lib/client-storage';

// Actual local app + its isolated PG17 catalog. Browser auth/booking/storage
// API requests and every external URL are intercepted; no booking, login,
// logout, email or account deletion is executed.
test.use({ serviceWorkers: 'block', trace: 'off', screenshot: 'off', video: 'off' });
const facilityId = randomUUID(), menuId = randomUUID(), staffId = randomUUID();
const slug = `synthetic-booking-generation-${facilityId}`;
let seeded = false, container: string;
const bookingPath = `/facility/${slug}/booking`;
function sql(value: string) {
  const result = spawnSync('docker', ['exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], { input: value, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Isolated synthetic booking-generation fixture SQL failed');
}
test.beforeAll(async ({ request }) => {
  const base = new URL(process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw new Error('Booking-generation browser checks require a loopback app');
  const response = await request.get('/register');
  const connect = (response.headers()['content-security-policy'] || '').split(';').find(value => value.trim().startsWith('connect-src')) || '';
  if (!/https?:\/\/(?:127\.0\.0\.1:54321|localhost:54321|localhost:54330)(?:\s|$)/.test(connect)) {
    throw new Error('App Supabase CSP must prove a local API before any synthetic fixture is created');
  }
  const nativeCI = process.env.CI === 'true' && process.env.GITHUB_ACTIONS === 'true';
  if (!nativeCI && !/^unix:\/\/.+\/\.docker\/run\/docker\.sock$/.test(process.env.DOCKER_HOST || '')) throw new Error('Local Docker socket required');
  const found = spawnSync('docker', ['ps', '--filter', 'name=^supabase_db_carelink$', '--filter', 'label=com.docker.compose.project=carelink', '--format', '{{.Names}}'], { encoding: 'utf8' });
  const names = found.stdout.trim().split('\n').filter(Boolean);
  if (found.status !== 0 || names.length !== 1 || names[0] !== 'supabase_db_carelink') throw new Error('Exactly one isolated carelink database container required');
  container = names[0];
  sql(`BEGIN;
    DO $$ BEGIN IF current_database()<>'postgres' OR current_setting('server_version_num')::int/10000<>17 THEN RAISE EXCEPTION 'isolated PG17 required'; END IF; END $$;
    INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status)
      VALUES('${facilityId}','合成予約下書き検証店','${slug}','ヘアサロン','検証県','検証市','合成住所','draft');
    INSERT INTO public.facility_menus(id,facility_id,category,name,price,duration_minutes,is_published)
      VALUES('${menuId}','${facilityId}','カット','合成カット',5000,60,true);
    INSERT INTO public.staff_profiles(id,facility_id,name,slug,is_active)
      VALUES('${staffId}','${facilityId}','合成担当','${slug}-staff',true);
    INSERT INTO public.facility_photos(facility_id,photo_url,photo_type)
      VALUES('${facilityId}','${base.origin}/icons/icon-192.png','other');
    UPDATE public.facility_profiles SET status='published',business_hours='{"mon":{"open":"09:00","close":"20:00"},"tue":{"open":"09:00","close":"20:00"},"wed":{"open":"09:00","close":"20:00"},"thu":{"open":"09:00","close":"20:00"},"fri":{"open":"09:00","close":"20:00"},"sat":{"open":"09:00","close":"20:00"},"sun":{"open":"09:00","close":"20:00"}}' WHERE id='${facilityId}';
    COMMIT;`);
  seeded = true;
});
test.afterAll(() => {
  if (!seeded) return;
  sql(`BEGIN; DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.bookings WHERE facility_id='${facilityId}') THEN RAISE EXCEPTION 'synthetic fixture unexpectedly booked'; END IF; END $$;
    DELETE FROM public.facility_profiles WHERE id='${facilityId}' AND slug='${slug}' AND name='合成予約下書き検証店'; COMMIT;`);
});
async function isolated(context: BrowserContext) {
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return route.abort();
    if (url.pathname === '/api/slots') return route.fulfill({ status: 200, json: { slots: [{ slot_start: '10:00:00', slot_end: '11:00:00', staff_id: staffId }] } });
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/storage/')) return route.abort();
    return route.continue();
  });
}
async function cleanupEpoch(page: Page) {
  await page.evaluate(() => { document.cookie = 'carelink_client_cleanup=1; Path=/; SameSite=Lax'; });
  await page.reload();
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), CLIENT_CLEANUP_GENERATION_KEY)).toMatch(/^[a-f0-9-]{36}$/);
  await expect.poll(() => page.evaluate(() => document.cookie.includes('carelink_client_cleanup=1'))).toBe(false);
  return page.evaluate(key => localStorage.getItem(key), CLIENT_CLEANUP_GENERATION_KEY);
}
async function confirmStep(page: Page) {
  await page.getByRole('button', { name: /合成カット/ }).click();
  await page.getByRole('button', { name: '次へ（日時を選ぶ）' }).click();
  await page.locator('button:not([disabled])').filter({ has: page.getByText('△', { exact: true }) }).first().click();
  await page.getByRole('button', { name: '次へ（確認・予約）' }).click();
  await expect(page.getByRole('heading', { name: '予約内容の確認・お客様情報' })).toBeVisible();
}
test('a sleeping old tab legacy booking draft is denied after another tab already consumed the retirement cookie', async ({ page, context }) => {
  await isolated(context); await page.goto('/register');
  // A genuine old document has no current boot subscriber. This same-origin
  // static fixture represents that sleeping document, then navigates to the
  // actual new booking page for the restore check.
  await context.route('**/synthetic-legacy-booking-tab', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>合成旧予約タブ</title>' }));
  const sleeping = await context.newPage(); await sleeping.goto('/synthetic-legacy-booking-tab');
  await sleeping.evaluate(({ key, menuId }) => sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), menuIds: [menuId],
    selectedDate: '2099-01-15', customerName: '退会前の合成氏名', email: 'retired@example.invalid' })), { key: bookingDraftKey(facilityId), menuId });
  const generation = await cleanupEpoch(page); expect(generation).not.toBeNull();
  expect(await sleeping.evaluate(key => sessionStorage.getItem(key), bookingDraftKey(facilityId))).not.toBeNull();
  await sleeping.goto(bookingPath);
  await expect(sleeping.getByText('ログアウト・退会前の予約下書きは復元しませんでした。現在の入力から続けてください。')).toBeVisible();
  await expect(sleeping.getByRole('button', { name: /合成カット/ })).toBeVisible();
  expect(await sleeping.evaluate(key => sessionStorage.getItem(key), bookingDraftKey(facilityId))).toBeNull();
});
test('new guest booking input saved after cleanup retains its exact value and restores once in the current generation', async ({ page, context }) => {
  await isolated(context); await page.goto('/register'); const generation = await cleanupEpoch(page); await page.goto(bookingPath); await confirmStep(page);
  await page.fill('#booking-name', '新しい合成氏名'); await page.fill('#booking-email', 'fresh@example.invalid'); await page.fill('#booking-note', '合成の新しい備考');
  await page.getByRole('link', { name: 'ログインする', exact: true }).click(); await expect(page).toHaveURL(/\/auth\/login\?/);
  const stored = await page.evaluate(({ key, metaKey }) => ({ value: JSON.parse(sessionStorage.getItem(key)!), meta: JSON.parse(sessionStorage.getItem(metaKey)!) }),
    { key: bookingDraftKey(facilityId), metaKey: `${CLIENT_BOOKING_DRAFT_META_PREFIX}${facilityId}` });
  expect(stored.value).toMatchObject({ customerName: '新しい合成氏名', email: 'fresh@example.invalid', note: '合成の新しい備考', menuIds: [menuId] });
  expect(Object.keys(stored.value).sort()).toEqual(['couponId','customerName','email','menuIds','note','phone','pointsToUse','savedAt','selectedDate','staffId','usePoints']);
  expect(stored.meta).toMatchObject({ version: 1, generation }); expect(JSON.stringify(stored.meta)).not.toMatch(/新しい合成|fresh@example|identity|receipt|token/);
  await page.goto(bookingPath); await expect(page.getByRole('heading', { name: '日時を選択' })).toBeVisible();
  expect(await page.evaluate(key => sessionStorage.getItem(key), bookingDraftKey(facilityId))).toBeNull();
  await page.locator('button:not([disabled])').filter({ has: page.getByText('△', { exact: true }) }).first().click();
  await page.getByRole('button', { name: '次へ（確認・予約）' }).click();
  await expect(page.locator('#booking-name')).toHaveValue('新しい合成氏名'); await expect(page.locator('#booking-email')).toHaveValue('fresh@example.invalid');
});
test('an unavailable generation store never navigates away with unverified saved input', async ({ page, context }) => {
  await isolated(context); await page.goto(bookingPath); await confirmStep(page);
  await page.fill('#booking-name', '画面に保持する合成氏名'); await page.fill('#booking-email', 'keep@example.invalid');
  await page.evaluate(key => { const original = Storage.prototype.getItem; Storage.prototype.getItem = function(name) {
    if (this === localStorage && name === key) throw new DOMException('synthetic blocked store', 'SecurityError'); return original.call(this, name);
  }; }, CLIENT_CLEANUP_GENERATION_KEY);
  await page.getByRole('link', { name: 'ログインする', exact: true }).click();
  await expect(page.getByText('予約の下書きを保存・確認できませんでした。現在の入力はこの画面に保持されています。')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/facility/${slug}/booking$`));
  await expect(page.locator('#booking-name')).toHaveValue('画面に保持する合成氏名'); await expect(page.locator('#booking-email')).toHaveValue('keep@example.invalid');
  await expect(page.getByRole('button', { name: 'この内容で予約する' })).toBeEnabled();
});
