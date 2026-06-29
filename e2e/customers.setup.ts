// オーナーの顧客台帳編集 E2E のセットアップ。
// 1) CI の隔離 Supabase に service role でオーナー＋施設＋owner権限＋顧客レコードを seed。
// 2) 実 UI（/auth/login）でオーナーとしてログインし、認証済み storageState を保存する。
// customers.spec.ts はこの storageState で /admin/customers を開き、顧客編集の書き込みを検証する。
import { test as setup, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { CUSTOMERS_AUTH_FILE, CUSTOMERS_SEED } from './customers.fixtures';

// supabase-js v2 は Node 20 で createClient 時に WebSocket を要求し throw する。realtime 非接続のためダミー。
if (!globalThis.WebSocket) {
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = class {};
}

setup('provision owner and a customer record', async ({ page }) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('customers.setup: SUPABASE env 未設定（CI の supabase start 由来）');
  const sb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const ts = `${Date.now()}`;
  const email = `e2e-owner-cust-${ts}@example.invalid`;
  const password = 'TestOwnerCust2026!';

  // 公開施設
  const { data: fac, error: fe } = await sb.from('facility_profiles').insert({
    name: `E2E顧客台帳店舗_${ts}`, slug: `e2e-cust-${ts}`, business_type: 'hair_salon',
    prefecture: '東京都', city: 'テスト市', address: 'テスト1-1-1', status: 'published',
  }).select('id').single();
  if (fe) throw new Error('seed facility: ' + fe.message);
  const facilityId = fac.id as string;

  // オーナーユーザー
  const { data: cu, error: ce } = await sb.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { display_name: 'E2E顧客台帳管理者' },
  });
  if (ce) throw new Error('seed user: ' + ce.message);
  const userId = cu.user.id;

  // オーナー権限（middleware の /admin 認可・customers API の membership 検証に必須）
  const { error: me } = await sb.from('facility_members').insert({ user_id: userId, facility_id: facilityId, role: 'owner' });
  if (me) throw new Error('seed member: ' + me.message);

  // 顧客レコード（customers の NOT NULL 必須列＝facility_id / name）。email は施設内一意のため付けない。
  const { error: cse } = await sb.from('customers').insert({
    facility_id: facilityId, name: CUSTOMERS_SEED.customerName, phone: '090-0000-0000',
  });
  if (cse) throw new Error('seed customer: ' + cse.message);

  // 実 UI でログイン（@supabase/ssr の認証 Cookie を確立）
  await page.goto('/auth/login?redirect=/admin');
  await page.fill('#login-email', email);
  await page.fill('#login-password', password);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  const outcome = await Promise.race([
    page.waitForURL((u) => !u.pathname.startsWith('/auth/login'), { timeout: 20000 }).then(() => 'navigated').catch(() => 'timeout'),
    page.getByText('メールアドレスまたはパスワードが正しくありません').waitFor({ timeout: 20000 }).then(() => 'bad-credentials').catch(() => 'no-error'),
  ]);
  if (outcome !== 'navigated') throw new Error(`customers ログイン失敗 (outcome=${outcome}, url=${page.url()})`);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'ダッシュボード' })).toBeVisible({ timeout: 15000 });

  fs.mkdirSync(path.dirname(CUSTOMERS_AUTH_FILE), { recursive: true });
  await page.context().storageState({ path: CUSTOMERS_AUTH_FILE });
});
