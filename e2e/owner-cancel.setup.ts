// オーナー（店舗管理者）のキャンセル／無断キャンセル E2E のセットアップ。
// 1) CI の隔離 Supabase（supabase start の一時 DB）に service role で
//    テスト店舗＋オーナー＋スタッフ＋キャンセル対象の予約を seed する（本番不可侵）。
// 2) 実 UI（/auth/login）でそのオーナーとしてログインし、認証済み storageState を保存する。
// owner-cancel.spec.ts はこの storageState で /admin/bookings/[id] を開き、ステータス変更
// （pending→お断り(cancelled) / confirmed→cancelled / confirmed→no_show）の書き込みを検証する。
import { test as setup, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import {
  OWNER_AUTH_FILE, OWNER_PENDING_FILE, OWNER_CONFIRMED_FILE, OWNER_NOSHOW_FILE, OWNER_SEED,
} from './owner-cancel.fixtures';

// supabase-js v2 は Node 20 で createClient 時に WebSocket を要求し throw する。realtime 非接続のためダミー。
if (!globalThis.WebSocket) {
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = class {};
}

// JST の本日（YYYY-MM-DD）。CI=UTC のため +9h して算出する。
function jstToday(): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

setup('provision owner and cancelable bookings', async ({ page }) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('owner-cancel.setup: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定（CI の supabase start 由来の env が必要）');
  }
  const sb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const ts = `${Date.now()}`;
  const email = `e2e-owner-cancel-${ts}@example.invalid`;
  const password = 'TestOwnerCancel2026!';
  const today = jstToday();
  const customerEmail = 'e2e-cancel-customer@example.invalid';

  // 1) 公開店舗
  const { data: fac, error: fe } = await sb.from('facility_profiles').insert({
    name: `E2Eキャンセル店舗_${ts}`, slug: `e2e-owner-cancel-${ts}`, business_type: 'hair_salon',
    prefecture: '東京都', city: 'テスト市', address: 'テスト1-1-1', status: 'published',
  }).select('id').single();
  if (fe) throw new Error('seed facility: ' + fe.message);
  const facilityId = fac.id as string;

  // 2) オーナーユーザー
  const { data: cu, error: ce } = await sb.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { display_name: 'E2Eキャンセル管理者' },
  });
  if (ce) throw new Error('seed user: ' + ce.message);
  const userId = cu.user.id;

  // 3) オーナー権限（middleware の /admin 認可・booking-status API の membership 検証に必須）
  const { error: me } = await sb.from('facility_members').insert({ user_id: userId, facility_id: facilityId, role: 'owner' });
  if (me) throw new Error('seed member: ' + me.message);

  // 4) スタッフ
  const { data: staff, error: se } = await sb.from('staff_profiles').insert([
    { facility_id: facilityId, name: OWNER_SEED.staffName, slug: `e2e-cancel-staff-${ts}`, sort_order: 1, is_active: true },
  ]).select('id');
  if (se) throw new Error('seed staff: ' + se.message);
  const staffId = staff[0].id as string;

  // 5) キャンセル対象の予約を3件 seed（pending / confirmed×2）。bookings の NOT NULL 必須列＝
  //    facility_id/booking_date/start_time/end_time/customer_name/email（admin.setup と同根の本番 drift）。
  const { data: seeded, error: be } = await sb.from('bookings').insert([
    { facility_id: facilityId, staff_id: staffId, booking_date: today, start_time: '10:00', end_time: '11:00', customer_name: OWNER_SEED.pendingCustomer, email: customerEmail, status: 'pending', total_price: 6000 },
    { facility_id: facilityId, staff_id: staffId, booking_date: today, start_time: '12:00', end_time: '13:00', customer_name: OWNER_SEED.confirmedCustomer, email: customerEmail, status: 'confirmed', total_price: 6000 },
    { facility_id: facilityId, staff_id: staffId, booking_date: today, start_time: '14:00', end_time: '15:00', customer_name: OWNER_SEED.noShowCustomer, email: customerEmail, status: 'confirmed', total_price: 6000 },
  ]).select('id, customer_name');
  if (be) throw new Error('seed bookings: ' + be.message);
  const pendingId = (seeded ?? []).find((b) => b.customer_name === OWNER_SEED.pendingCustomer)?.id;
  const confirmedId = (seeded ?? []).find((b) => b.customer_name === OWNER_SEED.confirmedCustomer)?.id;
  const noShowId = (seeded ?? []).find((b) => b.customer_name === OWNER_SEED.noShowCustomer)?.id;
  if (!pendingId || !confirmedId || !noShowId) throw new Error('seed bookings: id が取得できません');

  // 6) 実 UI でログイン（@supabase/ssr の認証 Cookie を確立）
  await page.goto('/auth/login?redirect=/admin');
  await page.fill('#login-email', email);
  await page.fill('#login-password', password);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  const outcome = await Promise.race([
    page.waitForURL((u) => !u.pathname.startsWith('/auth/login'), { timeout: 20000 }).then(() => 'navigated').catch(() => 'timeout'),
    page.getByText('メールアドレスまたはパスワードが正しくありません').waitFor({ timeout: 20000 }).then(() => 'bad-credentials').catch(() => 'no-error'),
  ]);
  if (outcome !== 'navigated') {
    throw new Error(`owner-cancel E2E ログイン失敗 (outcome=${outcome}, url=${page.url()})`);
  }
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'ダッシュボード' })).toBeVisible({ timeout: 15000 });

  // 7) 認証済み storageState＋各予約 id を保存
  fs.mkdirSync(path.dirname(OWNER_AUTH_FILE), { recursive: true });
  await page.context().storageState({ path: OWNER_AUTH_FILE });
  fs.writeFileSync(OWNER_PENDING_FILE, JSON.stringify({ id: pendingId }));
  fs.writeFileSync(OWNER_CONFIRMED_FILE, JSON.stringify({ id: confirmedId }));
  fs.writeFileSync(OWNER_NOSHOW_FILE, JSON.stringify({ id: noShowId }));
});
