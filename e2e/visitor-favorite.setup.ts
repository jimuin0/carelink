// 来院者（一般ユーザー）の施設お気に入りトグル E2E のセットアップ。
// CI の隔離 Supabase に公開施設＋来院者ユーザーを seed し、実 UI でログインして storageState を保存。
// 本番不可侵。
import { test as setup, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { VISITOR_FAVORITE_AUTH_FILE, VISITOR_FAVORITE_FACILITY_FILE } from './visitor-favorite.fixtures';

// supabase-js v2 は Node 20 で createClient 時に WebSocket を要求し throw する。realtime 非接続のためダミー。
if (!globalThis.WebSocket) {
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = class {};
}

setup('provision visitor and a published facility', async ({ page }) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('visitor-favorite.setup: SUPABASE env 未設定（CI の supabase start 由来）');
  const sb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const ts = `${Date.now()}`;
  const email = `e2e-fav-${ts}@example.invalid`;
  const password = 'TestVisitorFav2026!';
  const slug = `e2e-fav-${ts}`;

  // 公開施設（お気に入り対象。/api/favorites は status='published' のみ受理）
  const { error: fe } = await sb.from('facility_profiles').insert({
    name: `E2Eお気に入り店舗_${ts}`, slug, business_type: 'hair_salon',
    prefecture: '東京都', city: 'テスト市', address: 'テスト1-1-1', status: 'published',
  });
  if (fe) throw new Error('seed facility: ' + fe.message);

  // 来院者ユーザー
  const { error: ce } = await sb.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { display_name: 'E2Eお気に入り来院者' },
  });
  if (ce) throw new Error('seed user: ' + ce.message);

  // 実 UI でログイン（来院者）→ /mypage へ
  await page.goto('/auth/login?redirect=/mypage');
  await page.fill('#login-email', email);
  await page.fill('#login-password', password);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  const outcome = await Promise.race([
    page.waitForURL((u) => !u.pathname.startsWith('/auth/login'), { timeout: 20000 }).then(() => 'navigated').catch(() => 'timeout'),
    page.getByText('メールアドレスまたはパスワードが正しくありません').waitFor({ timeout: 20000 }).then(() => 'bad').catch(() => 'no-error'),
  ]);
  if (outcome !== 'navigated') throw new Error(`visitor-favorite ログイン失敗 (outcome=${outcome}, url=${page.url()})`);

  fs.mkdirSync(path.dirname(VISITOR_FAVORITE_AUTH_FILE), { recursive: true });
  await page.context().storageState({ path: VISITOR_FAVORITE_AUTH_FILE });
  fs.writeFileSync(VISITOR_FAVORITE_FACILITY_FILE, JSON.stringify({ slug }));
  expect(slug).toBeTruthy();
});
