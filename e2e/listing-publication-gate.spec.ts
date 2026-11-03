import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { prepareSalonIntent } from '../src/lib/salon-submission-intent';
import { commitSalonSubmission } from '../src/lib/salon-submission-commit';
import { approveSyntheticListing } from './listing-verification-fixture';

// 掲載の公開ゲート・「書類は後から」・書類の承認での公開待ち・承認メールの取り消しを、実際の DB で確かめる
// （2026-11-03 独立レビュー：単体テストのモックでは、トリガと RLS の上での実際の挙動を保証できないため）。
// 使い捨ての CI の DB にだけ合成データを作る。送信用の鍵が無いことも確かめる。
test.beforeAll(() => {
  if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true'
    || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://localhost:54330'
    || process.env.PLAYWRIGHT_BASE_URL !== 'https://localhost:3000'
    || !process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.RESEND_API_KEY) {
    throw new Error('Listing publication gate checks require isolated CI without send credentials');
  }
});

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const CLOSED = Object.fromEntries(DAYS.map(day => [day, null]));
const READY_HOURS = { ...CLOSED, mon: { open: '10:00', close: '18:00' } };

function service(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } });
}
async function user(db: SupabaseClient, email = `gate-${randomUUID()}@example.invalid`) {
  const created = await db.auth.admin.createUser({ email, password: randomUUID(), email_confirm: true });
  if (created.error || !created.data.user) throw new Error('Synthetic user unavailable');
  return created.data.user.id;
}
async function operator(db: SupabaseClient) {
  const id = await user(db);
  const promoted = await db.from('profiles').update({ is_platform_admin: true }).eq('id', id).select('id').single();
  if (promoted.error) throw new Error('Synthetic operator unavailable');
  return id;
}
async function registration(db: SupabaseClient, email = `gate-${randomUUID()}@example.invalid`) {
  const prepared = await prepareSalonIntent(db);
  if (prepared.state !== 'prepared') throw new Error('Synthetic intent preparation failed');
  const receipt = await commitSalonSubmission(db, {
    intentId: prepared.intentId,
    registration: { facility_name: `合成公開ゲート ${randomUUID()}`, business_type: 'ヘアサロン', representative_name: '合成', contact_name: '合成',
      email, phone: '09000000000', source: 'register' },
    photoIds: [], consent: { terms_agreed: true, license_warranted: true },
  }, prepared.proof);
  if (receipt.state !== 'committed') throw new Error('Synthetic receipt creation failed');
  return receipt.receiptId;
}
/** 申込から作られた店舗（オーナー付き・下書き）。ready なら店舗名・所在地・営業時間が揃っている。 */
async function facility(db: SupabaseClient, ready: boolean, salonId?: string) {
  const owner = await user(db);
  const id = randomUUID();
  const inserted = await db.from('facility_profiles').insert({ id, name: '合成公開ゲート店', slug: `gate-${id}`, business_type: 'その他',
    prefecture: '愛知県', city: '西尾市', address: '合成町1', status: 'draft', business_hours: ready ? READY_HOURS : CLOSED });
  if (inserted.error) throw new Error('Synthetic facility unavailable');
  const member = await db.from('facility_members').insert({ facility_id: id, user_id: owner, role: 'owner' });
  if (member.error) throw new Error('Synthetic owner unavailable');
  if (salonId) {
    const linked = await db.from('salons').update({ claimed_facility_id: id, claimed_by_user_id: owner, claimed_at: new Date().toISOString() })
      .eq('id', salonId).select('id').single();
    if (linked.error) throw new Error('Synthetic claim unavailable');
  }
  return { id, owner };
}
const setStatus = (db: SupabaseClient, id: string, status: string) =>
  db.from('facility_profiles').update({ status }).eq('id', id).select('status');
const statusOf = async (db: SupabaseClient, id: string) =>
  (await db.from('facility_profiles').select('status').eq('id', id).single()).data?.status;
const pendingOf = async (db: SupabaseClient, id: string) =>
  (await db.from('listing_verification_approvals').select('auto_publish_pending').eq('facility_id', id).single()).data?.auto_publish_pending;
function expectRefused(result: { error: { code?: string; message?: string } | null }, name: string) {
  expect(result.error?.code).toBe('23514');
  expect(result.error?.message).toContain(`"${name}"`);
}

test('「書類は後から」の店舗は書類なしで公開でき、外すと次の公開から書類が要る', async () => {
  const db = service(); const actor = await operator(db);
  const salon = await registration(db); const shop = await facility(db, true, salon);
  expectRefused(await setStatus(db, shop.id, 'published'), 'published_listing_verification_required');
  const on = await db.rpc('set_listing_verification_deferral', { p_actor: actor, p_salon: salon, p_deferred: true });
  expect(on.error).toBeNull(); expect(on.data).toMatchObject({ outcome: 'updated', deferred: true, facility_published: false });
  expect((await setStatus(db, shop.id, 'published')).error).toBeNull();
  // 外しても公開中の店舗はそのまま。結果がそれを伝える。
  const off = await db.rpc('set_listing_verification_deferral', { p_actor: actor, p_salon: salon, p_deferred: false });
  expect(off.data).toMatchObject({ outcome: 'updated', deferred: false, facility_published: true });
  expect(await statusOf(db, shop.id)).toBe('published');
  expect((await setStatus(db, shop.id, 'draft')).error).toBeNull();
  expectRefused(await setStatus(db, shop.id, 'published'), 'published_listing_verification_required');
});

test('書類を承認した後は「書類は後から」が効かず、店舗名・所在地の変更は確認し直す', async () => {
  const db = service(); const actor = await operator(db);
  const salon = await registration(db); const shop = await facility(db, true, salon);
  await db.rpc('set_listing_verification_deferral', { p_actor: actor, p_salon: salon, p_deferred: true });
  await approveSyntheticListing(db, shop.id, shop.owner, false);
  // 承認だけでは DB の中で公開しない（公開はアプリが公開の規則を通してから行う）。公開待ちの印だけが付く。
  expect(await statusOf(db, shop.id)).toBe('draft');
  expect(await pendingOf(db, shop.id)).toBe(true);
  const published = await db.rpc('try_auto_publish_verified_facility', { p_facility_id: shop.id, p_actor: shop.owner });
  expect(published.error).toBeNull(); expect(published.data).toBe('published');
  expect(await statusOf(db, shop.id)).toBe('published');
  expect(await pendingOf(db, shop.id)).toBe(false);
  expectRefused(await db.from('facility_profiles').update({ name: '別の店' }).eq('id', shop.id).select('id'), 'published_listing_verification_required');
});

test('却下した申込から作られた店舗は、「書類は後から」が付いていても公開できない', async () => {
  const db = service(); const actor = await operator(db);
  const salon = await registration(db); const shop = await facility(db, true, salon);
  await db.rpc('set_listing_verification_deferral', { p_actor: actor, p_salon: salon, p_deferred: true });
  expect((await db.from('salons').update({ status: 'rejected' }).eq('id', salon).select('id')).error).toBeNull();
  expectRefused(await setStatus(db, shop.id, 'published'), 'published_listing_registration_rejected');
  // 却下した申込には新しく付けられない。
  const other = await registration(db);
  expect((await db.from('salons').update({ status: 'rejected' }).eq('id', other).select('id')).error).toBeNull();
  const refused = await db.rpc('set_listing_verification_deferral', { p_actor: actor, p_salon: other, p_deferred: true });
  expect(refused.data).toMatchObject({ outcome: 'rejected' });
  expect((await db.from('listing_verification_deferrals').select('salon_id').eq('salon_id', other)).data).toEqual([]);
});

test('設定の保存だけでは DB が公開せず、公開待ちの印はどの経路で公開しても外れる', async () => {
  const db = service();
  const shop = await facility(db, false);
  await approveSyntheticListing(db, shop.id, shop.owner, false);
  expect(await pendingOf(db, shop.id)).toBe(true);
  expect((await db.rpc('try_auto_publish_verified_facility', { p_facility_id: shop.id, p_actor: shop.owner })).data).toBe('not_ready');
  expect((await db.from('facility_profiles').update({ business_hours: READY_HOURS }).eq('id', shop.id).select('id')).error).toBeNull();
  expect(await statusOf(db, shop.id)).toBe('draft');
  // 手動の公開でも印が外れる（後で非公開に戻した店舗が、保存だけで意図せず再公開されないように）。
  expect((await setStatus(db, shop.id, 'published')).error).toBeNull();
  expect(await pendingOf(db, shop.id)).toBe(false);
  expect((await setStatus(db, shop.id, 'draft')).error).toBeNull();
  expect((await db.rpc('try_auto_publish_verified_facility', { p_facility_id: shop.id, p_actor: shop.owner })).data).toBe('not_pending');
  expect(await statusOf(db, shop.id)).toBe('draft');
});

test('承認を取り消すと未送信の承認メールが止まり、もう一度承認すると送る', async () => {
  const db = service(); const salon = await registration(db);
  const job = async () => (await db.from('webhook_retry_queue').select('status,attempt_count,delivery_started_at')
    .eq('registration_id', salon).eq('notification_kind', 'approval').eq('template_version', 1)).data;
  expect(await job()).toEqual([]);
  expect((await db.from('salons').update({ status: 'approved' }).eq('id', salon).select('id')).error).toBeNull();
  expect(await job()).toEqual([{ status: 'pending', attempt_count: 0, delivery_started_at: null }]);
  expect((await db.from('salons').update({ status: 'pending' }).eq('id', salon).select('id')).error).toBeNull();
  expect(await job()).toEqual([{ status: 'cancelled', attempt_count: 0, delivery_started_at: null }]);
  expect((await db.from('salons').update({ status: 'approved' }).eq('id', salon).select('id')).error).toBeNull();
  expect(await job()).toEqual([{ status: 'pending', attempt_count: 0, delivery_started_at: null }]);
});

test('ログイン後に申込の続きへ送るのは、承認済みでまだ誰も店舗を作っていない申込だけ', async () => {
  const db = service(); const email = `gate-${randomUUID()}@example.invalid`;
  const account = await user(db, email);
  const salon = await registration(db, email);
  const claimable = async () => (await db.rpc('has_claimable_approved_salon_receipt', { p_user_id: account })).data;
  expect(await claimable()).toBe(false);
  expect((await db.from('salons').update({ status: 'approved' }).eq('id', salon).select('id')).error).toBeNull();
  expect(await claimable()).toBe(true);
  await facility(db, false, salon);
  expect(await claimable()).toBe(false);
});
