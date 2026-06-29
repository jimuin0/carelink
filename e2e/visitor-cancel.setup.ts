// 来院者（一般ユーザー）のキャンセルフロー E2E のセットアップ。
// CI の隔離 Supabase に、来院者ユーザー＋その本人名義の予約(confirmed・未来日)を seed し、
// 実 UI でログインして認証済み storageState を保存する。本番不可侵。
import { test as setup, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { VISITOR_AUTH_FILE, VISITOR_BOOKING_FILE } from './visitor-cancel.fixtures';

// supabase-js v2 は Node 20 で createClient 時に WebSocket を要求し throw する。realtime 非接続のためダミー。
if (!globalThis.WebSocket) {
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = class {};
}

// JST 明日（YYYY-MM-DD）。CI=UTC のため +9h +1day。未来日でキャンセル可能にする。
function jstTomorrow(): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000 + 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

setup('provision visitor and a cancelable booking', async ({ page }) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('visitor.setup: SUPABASE env 未設定');
  const sb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const ts = `${Date.now()}`;
  const email = `e2e-visitor-${ts}@example.invalid`;
  const password = 'TestVisitor2026!';

  // 公開施設（予約のひも付け先）
  const { data: fac, error: fe } = await sb.from('facility_profiles').insert({
    name: `E2E来院者店舗_${ts}`, slug: `e2e-visitor-${ts}`, business_type: 'hair_salon',
    prefecture: '東京都', city: 'テスト市', address: 'テスト1-1-1', status: 'published',
  }).select('id').single();
  if (fe) throw new Error('seed facility: ' + fe.message);

  // 来院者ユーザー
  const { data: cu, error: ce } = await sb.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { display_name: 'E2E来院者' },
  });
  if (ce) throw new Error('seed user: ' + ce.message);
  const userId = cu.user.id;

  // 本人名義の予約（confirmed・明日）→ キャンセル可能(canCancel=pending/confirmed)
  const { data: bk, error: be } = await sb.from('bookings').insert({
    facility_id: fac.id, user_id: userId, booking_date: jstTomorrow(), start_time: '11:00', end_time: '12:00',
    customer_name: 'E2E来院者', email, status: 'confirmed', total_price: 5000,
  }).select('id').single();
  if (be) throw new Error('seed booking: ' + be.message);

  // 実 UI でログイン（来院者）→ /mypage へ
  await page.goto('/auth/login?redirect=/mypage');
  await page.fill('#login-email', email);
  await page.fill('#login-password', password);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  const outcome = await Promise.race([
    page.waitForURL((u) => !u.pathname.startsWith('/auth/login'), { timeout: 20000 }).then(() => 'navigated').catch(() => 'timeout'),
    page.getByText('メールアドレスまたはパスワードが正しくありません').waitFor({ timeout: 20000 }).then(() => 'bad').catch(() => 'no-error'),
  ]);
  if (outcome !== 'navigated') throw new Error(`visitor ログイン失敗 (outcome=${outcome}, url=${page.url()})`);

  fs.mkdirSync(path.dirname(VISITOR_AUTH_FILE), { recursive: true });
  await page.context().storageState({ path: VISITOR_AUTH_FILE });
  fs.writeFileSync(VISITOR_BOOKING_FILE, JSON.stringify({ id: bk.id }));
  expect(bk.id).toBeTruthy();
});
