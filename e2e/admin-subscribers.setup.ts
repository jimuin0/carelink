// オーナーのサブスク契約者ステータス変更 E2E のセットアップ。
// 1) CI の隔離 Supabase に service role でオーナー＋施設＋owner権限＋プラン＋契約者
//    （customer user + アクティブな user_subscription）を seed。
// 2) 実 UI（/auth/login）でオーナーとしてログインし、認証済み storageState を保存する。
// admin-subscribers.spec.ts はこの storageState で /admin/subscription-plans の契約者一覧から
// 「一時停止」操作を検証する（user-subscriptions GET の profiles 別取得マージも実 UI で通る）。
import { test as setup, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { SUBSCRIBERS_AUTH_FILE, SUBSCRIBERS_SEED } from './admin-subscribers.fixtures';

// supabase-js v2 は Node 20 で createClient 時に WebSocket を要求し throw する。realtime 非接続のためダミー。
if (!globalThis.WebSocket) {
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = class {};
}

setup('provision owner with an active subscriber', async ({ page }) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('admin-subscribers.setup: SUPABASE env 未設定（CI の supabase start 由来）');
  const sb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const ts = `${Date.now()}`;
  const ownerEmail = `e2e-owner-subs-${ts}@example.invalid`;
  const password = 'TestOwnerSubs2026!';

  // 公開施設
  const { data: fac, error: fe } = await sb.from('facility_profiles').insert({
    name: `E2E契約者店舗_${ts}`, slug: `e2e-subs-${ts}`, business_type: 'hair_salon',
    prefecture: '東京都', city: 'テスト市', address: 'テスト1-1-1', status: 'published',
  }).select('id').single();
  if (fe) throw new Error('seed facility: ' + fe.message);
  const facilityId = fac.id as string;

  // オーナーユーザー＋owner権限
  const { data: ow, error: oe } = await sb.auth.admin.createUser({
    email: ownerEmail, password, email_confirm: true, user_metadata: { display_name: 'E2E契約者管理者' },
  });
  if (oe) throw new Error('seed owner: ' + oe.message);
  const { error: me } = await sb.from('facility_members').insert({ user_id: ow.user.id, facility_id: facilityId, role: 'owner' });
  if (me) throw new Error('seed member: ' + me.message);

  // 契約者になる来院者ユーザー
  const { data: cust, error: ce } = await sb.auth.admin.createUser({
    email: `e2e-subscriber-${ts}@example.invalid`, password, email_confirm: true, user_metadata: { display_name: 'E2E契約者' },
  });
  if (ce) throw new Error('seed subscriber user: ' + ce.message);

  // サブスクプラン（NOT NULL＝facility_id/name/price。sessions_per_month/valid_months は DEFAULT）
  const { data: plan, error: pe } = await sb.from('subscription_plans').insert({
    facility_id: facilityId, name: SUBSCRIBERS_SEED.planName, price: 8000, sessions_per_month: 4,
  }).select('id').single();
  if (pe) throw new Error('seed plan: ' + pe.message);

  // アクティブな契約（NOT NULL＝user_id/facility_id/plan_id。status は DEFAULT 'active'）→ 一時停止/解約ボタンが出る
  const { error: use } = await sb.from('user_subscriptions').insert({
    user_id: cust.user.id, facility_id: facilityId, plan_id: plan.id,
  });
  if (use) throw new Error('seed user_subscription: ' + use.message);

  // 実 UI でログイン（オーナー）
  await page.goto('/auth/login?redirect=/admin');
  await page.fill('#login-email', ownerEmail);
  await page.fill('#login-password', password);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  const outcome = await Promise.race([
    page.waitForURL((u) => !u.pathname.startsWith('/auth/login'), { timeout: 20000 }).then(() => 'navigated').catch(() => 'timeout'),
    page.getByText('メールアドレスまたはパスワードが正しくありません').waitFor({ timeout: 20000 }).then(() => 'bad-credentials').catch(() => 'no-error'),
  ]);
  if (outcome !== 'navigated') throw new Error(`admin-subscribers ログイン失敗 (outcome=${outcome}, url=${page.url()})`);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'ダッシュボード' })).toBeVisible({ timeout: 15000 });

  fs.mkdirSync(path.dirname(SUBSCRIBERS_AUTH_FILE), { recursive: true });
  await page.context().storageState({ path: SUBSCRIBERS_AUTH_FILE });
});
