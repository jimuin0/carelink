import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { prepareSalonIntent } from '../src/lib/salon-submission-intent';
import { commitSalonSubmission } from '../src/lib/salon-submission-commit';

// テスト用の申込の削除を、実際の DB の外部キー・トリガの上で確かめる（2026-11-06）。
// 消してはいけないものを消せないことが本題なので、断る条件を 1 つずつ実 DB で確かめる。
// 使い捨ての CI の DB にだけ合成データを作る。
test.beforeAll(() => {
  if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true'
    || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://localhost:54330'
    || process.env.PLAYWRIGHT_BASE_URL !== 'https://localhost:3000'
    || !process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.RESEND_API_KEY) {
    throw new Error('Test registration deletion checks require isolated CI without send credentials');
  }
});

function service(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } });
}
async function user(db: SupabaseClient, email = `del-${randomUUID()}@example.invalid`, password = randomUUID()) {
  const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error('Synthetic user unavailable');
  return created.data.user.id;
}
async function operator(db: SupabaseClient, email?: string, password?: string) {
  const id = await user(db, email, password);
  const promoted = await db.from('profiles').update({ is_platform_admin: true }).eq('id', id).select('id').single();
  if (promoted.error) throw new Error('Synthetic operator unavailable');
  return id;
}
/** 申込（受付の通知は送信済みにしておく）。 */
async function registration(db: SupabaseClient, name = `合成削除 ${randomUUID()}`, settle = true) {
  const prepared = await prepareSalonIntent(db);
  if (prepared.state !== 'prepared') throw new Error('Synthetic intent preparation failed');
  const receipt = await commitSalonSubmission(db, {
    intentId: prepared.intentId,
    registration: { facility_name: name, business_type: 'ヘアサロン', representative_name: '合成', contact_name: '合成',
      email: `del-${randomUUID()}@example.invalid`, phone: '09000000000', source: 'register' },
    photoIds: [], consent: { terms_agreed: true, license_warranted: true },
  }, prepared.proof);
  if (receipt.state !== 'committed') throw new Error('Synthetic receipt creation failed');
  if (settle) {
    const settled = await db.from('webhook_retry_queue').update({ status: 'success' }).eq('registration_id', receipt.receiptId);
    if (settled.error) throw new Error('Synthetic queue update failed');
  }
  return { id: receipt.receiptId, name };
}
async function classify(db: SupabaseClient, actor: string, salon: string, value: 'test' | 'real') {
  const result = await db.rpc('set_salon_registration_classification', { p_actor: actor, p_salon: salon, p_value: value, p_expected_revision: 0 });
  if (result.error || result.data?.outcome !== 'updated') throw new Error('Synthetic classification failed');
}
async function facility(db: SupabaseClient, salon: string) {
  const owner = await user(db);
  const id = randomUUID();
  const inserted = await db.from('facility_profiles').insert({ id, name: '合成削除店', slug: `del-${id}`, business_type: 'その他',
    prefecture: '愛知県', city: '西尾市', address: '合成町1', status: 'draft' });
  if (inserted.error) throw new Error('Synthetic facility unavailable');
  const member = await db.from('facility_members').insert({ facility_id: id, user_id: owner, role: 'owner' });
  if (member.error) throw new Error('Synthetic owner unavailable');
  const linked = await db.from('salons').update({ claimed_facility_id: id, claimed_by_user_id: owner, claimed_at: new Date().toISOString() })
    .eq('id', salon).select('id').single();
  if (linked.error) throw new Error('Synthetic claim unavailable');
  return { id, owner };
}
const remove = (db: SupabaseClient, actor: string, salon: string, name: string) =>
  db.rpc('delete_test_registration', { p_actor: actor, p_salon: salon, p_expected_name: name });
const exists = async (db: SupabaseClient, table: string, id: string) =>
  ((await db.from(table).select('id').eq('id', id).maybeSingle()).data ?? null) !== null;

test('テスト用の申込は、下書きの店舗・送信記録ごと消え、ログインアカウントと他の申込は残り、監査ログが残る', async () => {
  const db = service();
  const actor = await operator(db);
  const target = await registration(db);
  const other = await registration(db);
  await classify(db, actor, target.id, 'test');
  await classify(db, actor, other.id, 'test');
  const shop = await facility(db, target.id);
  const menu = await db.from('facility_menus').insert({ facility_id: shop.id, name: '合成メニュー', category: 'カット', price: 1000, duration_minutes: 30, is_published: true });
  expect(menu.error).toBeNull();

  const result = await remove(db, actor, target.id, target.name);
  expect(result.error).toBeNull();
  expect(result.data).toEqual({ outcome: 'deleted', facility_id: shop.id, upload_paths: [] });

  expect(await exists(db, 'salons', target.id)).toBe(false);
  expect(await exists(db, 'facility_profiles', shop.id)).toBe(false);
  expect((await db.from('webhook_retry_queue').select('id').eq('registration_id', target.id)).data).toEqual([]);
  expect((await db.from('salon_submission_intents').select('id').eq('salon_id', target.id)).data).toEqual([]);
  expect((await db.from('facility_menus').select('id').eq('facility_id', shop.id)).data).toEqual([]);
  expect(await exists(db, 'salons', other.id)).toBe(true);
  expect((await db.auth.admin.getUserById(shop.owner)).data.user?.id).toBe(shop.owner);
  const audit = await db.from('audit_logs').select('user_id,action,table_name,old_values').eq('record_id', target.id).eq('table_name', 'salons').eq('action', 'delete').single();
  expect(audit.error).toBeNull();
  expect(audit.data?.user_id).toBe(actor);
  expect((audit.data?.old_values as { facility_name: string }).facility_name).toBe(target.name);
});

test('店舗の無い申込も消せる', async () => {
  const db = service();
  const actor = await operator(db);
  const target = await registration(db);
  await classify(db, actor, target.id, 'test');
  expect((await remove(db, actor, target.id, target.name)).data).toEqual({ outcome: 'deleted', facility_id: null, upload_paths: [] });
  expect(await exists(db, 'salons', target.id)).toBe(false);
});

test('本物・未確認の申込、店舗名が変わった申込、運営でない人の操作は断り、何も消さない', async () => {
  const db = service();
  const actor = await operator(db);
  const unknown = await registration(db);
  expect((await remove(db, actor, unknown.id, unknown.name)).data).toEqual({ outcome: 'not_test' });
  const real = await registration(db);
  await classify(db, actor, real.id, 'real');
  expect((await remove(db, actor, real.id, real.name)).data).toEqual({ outcome: 'not_test' });
  const renamed = await registration(db);
  await classify(db, actor, renamed.id, 'test');
  expect((await remove(db, actor, renamed.id, '別の名前')).data).toEqual({ outcome: 'changed' });
  expect((await remove(db, await user(db), renamed.id, renamed.name)).data).toEqual({ outcome: 'forbidden' });
  expect((await remove(db, actor, randomUUID(), 'x')).data).toEqual({ outcome: 'not_found' });
  for (const row of [unknown, real, renamed]) expect(await exists(db, 'salons', row.id)).toBe(true);
});

test('下書き以外の店舗、予約・顧客のある店舗、送信待ちのある申込は断り、何も消さない', async () => {
  const db = service();
  const actor = await operator(db);

  const suspended = await registration(db);
  await classify(db, actor, suspended.id, 'test');
  const suspendedShop = await facility(db, suspended.id);
  expect((await db.from('facility_profiles').update({ status: 'suspended' }).eq('id', suspendedShop.id)).error).toBeNull();
  expect((await remove(db, actor, suspended.id, suspended.name)).data).toEqual({ outcome: 'facility_not_draft' });
  expect(await exists(db, 'facility_profiles', suspendedShop.id)).toBe(true);

  const active = await registration(db);
  await classify(db, actor, active.id, 'test');
  const activeShop = await facility(db, active.id);
  expect((await db.from('customers').insert({ facility_id: activeShop.id, name: '合成顧客', phone: '090-0000-0000' })).error).toBeNull();
  expect((await remove(db, actor, active.id, active.name)).data).toEqual({ outcome: 'has_activity' });
  expect(await exists(db, 'facility_profiles', activeShop.id)).toBe(true);

  const pending = await registration(db, undefined, false);
  await classify(db, actor, pending.id, 'test');
  expect((await remove(db, actor, pending.id, pending.name)).data).toEqual({ outcome: 'delivery_in_progress' });
  expect(await exists(db, 'salons', pending.id)).toBe(true);
});

test('ブラウザの権限からは関数を呼べない', async () => {
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const result = await anon.rpc('delete_test_registration', { p_actor: randomUUID(), p_salon: randomUUID(), p_expected_name: 'x' });
  expect(result.error).not.toBeNull();
});

test('管理画面：テスト・検証用にした申込にだけ削除ボタンが出て、押すと一覧から消える', async ({ page }) => {
  test.setTimeout(90_000);
  const db = service();
  const email = `del-op-${randomUUID()}@example.invalid`;
  const password = randomUUID();
  await operator(db, email, password);
  const target = await registration(db);

  await page.goto('/auth/login?redirect=/admin/registrations');
  await page.getByRole('button', { name: '必須のみ', exact: true }).click();
  await page.fill('#login-email', email);
  await page.fill('#login-password', password);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await page.waitForURL(url => !url.pathname.startsWith('/auth/login'), { timeout: 20000 });
  await page.goto('/admin/registrations');
  await page.getByLabel('検索値').fill(target.name);
  await page.getByRole('button', { name: '検索する' }).click();
  await expect(page.getByText(target.name, { exact: true })).toBeVisible();

  const button = page.getByRole('button', { name: `${target.name}を削除` });
  await expect(button).toHaveCount(0);
  await page.getByLabel(`${target.name}の申込の種類`).selectOption('test');
  await expect(button).toBeVisible();
  await button.click();
  await page.getByRole('button', { name: '削除する' }).click();
  await expect(page.getByText(`${target.name}を削除しました`)).toBeVisible();
  await expect(page.getByText(target.name, { exact: true })).toHaveCount(0);
  expect(await exists(db, 'salons', target.id)).toBe(false);
});
