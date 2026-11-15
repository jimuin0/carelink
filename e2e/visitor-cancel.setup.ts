import { approveSyntheticListing } from './listing-verification-fixture';
// 来院者（一般ユーザー）のキャンセルフロー E2E のセットアップ。
// CI の隔離 Supabase に、来院者ユーザー＋その本人名義の予約(confirmed・未来日)を seed し、
// 実 UI でログインして認証済み storageState を保存する。本番不可侵。
import { test as setup, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { VISITOR_AUTH_FILE, VISITOR_BOOKING_FILE, VISITOR_MEMBER_BOOKING_MENU } from './visitor-cancel.fixtures';
import { confirmSyntheticBookingPreparation } from './booking-preparation.seed';

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
  if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true'
    || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://localhost:54330'
    || process.env.PLAYWRIGHT_BASE_URL !== 'https://localhost:3000') {
    throw new Error('visitor fixture requires the managed disposable HTTPS CI lifecycle');
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('visitor.setup: SUPABASE env 未設定');
  const sb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const ts = `${Date.now()}`;
  const email = `e2e-visitor-${ts}@example.invalid`;
  const password = 'TestVisitor2026!';

  // 公開施設（予約のひも付け先）
  const { data: fac, error: fe } = await sb.from('facility_profiles').insert({
    name: `E2E来院者店舗_${ts}`, slug: `e2e-visitor-${ts}`, business_type: 'ヘアサロン',
    prefecture: '東京都', city: 'テスト市', address: 'テスト1-1-1', status: 'draft',
  }).select('id').single();
  if (fe) throw new Error('seed facility: ' + fe.message);
  await approveSyntheticListing(sb, fac.id);

  // 会員本人が UI から新しく予約できる準備も揃える。既存予約の取消だけでは、
  // 新規受付が user_id に結びつかず本人履歴へ出ない不具合を検出できない。
  const staff = await sb.from('staff_profiles').insert({
    facility_id: fac.id, name: 'E2E会員予約担当', slug: `e2e-member-staff-${ts}`, is_active: true,
  }).select('id').single();
  if (staff.error || !staff.data) throw new Error('seed member booking staff failed');
  const schedules = await sb.from('staff_schedules').insert(Array.from({ length: 7 }, (_, day_of_week) => ({
    staff_id: staff.data.id, day_of_week, start_time: '09:00', end_time: '20:00',
  })));
  if (schedules.error) throw new Error('seed member booking schedules failed');
  const menu = await sb.from('facility_menus').insert({
    facility_id: fac.id, category: 'カット', name: VISITOR_MEMBER_BOOKING_MENU,
    price: 5000, duration_minutes: 60, is_published: true,
  });
  if (menu.error) throw new Error('seed member booking menu failed');
  await confirmSyntheticBookingPreparation(sb, fac.id);

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
  fs.writeFileSync(VISITOR_BOOKING_FILE, JSON.stringify({
    id: bk.id, facilityId: fac.id, slug: `e2e-visitor-${ts}`, userId, email,
  }));
  expect(bk.id).toBeTruthy();
});
