// 管理画面（オーナー）E2E のセットアップ。
// 1) CI の隔離 Supabase（supabase start で起動した一時 DB）に service role で
//    テスト店舗＋オーナー＋スタッフ＋予約を seed する（本番には触れない）。
// 2) 実 UI（/auth/login）でそのオーナーとしてログインし、認証済み storageState を保存する。
// admin.spec.ts はこの storageState を使って /admin/* を認証状態で検証する。
import { test as setup, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { ADMIN_AUTH_FILE, SEED, jstToday } from './admin.fixtures';

// supabase-js v2 は Node 20 で createClient 時に WebSocket（realtime 用）を要求し throw する。
// seed は REST（auth.admin / from().insert）のみで realtime に接続しないため、ダミーを与えて
// 構築時の throw を回避する（接続しないのでダミーの実体は一切使われない）。
if (!globalThis.WebSocket) {
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = class {};
}

setup('provision test owner and authenticate', async ({ page }) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('admin.setup: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定（CI の supabase start 由来の env が必要）');
  }

  const sb = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const ts = `${Date.now()}`;
  const email = `e2e-owner-${ts}@example.invalid`;
  const password = 'TestOwner2026!';
  const today = jstToday();

  // 1) 店舗（公開・ただし勤務スケジュール未設定＝予約不能警告の検証対象）
  const { data: fac, error: fe } = await sb
    .from('facility_profiles')
    .insert({
      name: `E2Eテスト店舗_${ts}`,
      slug: `e2e-admin-${ts}`,
      business_type: 'hair_salon',
      prefecture: '東京都',
      city: 'テスト市',
      address: 'テスト1-1-1',
      status: 'published',
    })
    .select('id')
    .single();
  if (fe) throw new Error('seed facility: ' + fe.message);
  const facilityId = fac.id as string;

  // 2) オーナーユーザー
  const { data: cu, error: ce } = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: 'E2Eテスト管理者' },
  });
  if (ce) throw new Error('seed user: ' + ce.message);
  const userId = cu.user.id;

  // 3) オーナー権限（middleware の /admin 認可に必須）
  const { error: me } = await sb
    .from('facility_members')
    .insert({ user_id: userId, facility_id: facilityId, role: 'owner' });
  if (me) throw new Error('seed member: ' + me.message);

  // 4) スタッフ（staffCount>0 にして「スケジュール未設定」警告経路を検証）
  const { data: staff, error: se } = await sb
    .from('staff_profiles')
    .insert([
      { facility_id: facilityId, name: SEED.staffName, slug: `e2e-staff-${ts}`, sort_order: 1, is_active: true },
    ])
    .select('id');
  if (se) throw new Error('seed staff: ' + se.message);
  const staffId = staff[0].id as string;

  // 5) 予約（本日）: 完了/無断/確定 → 本日売上・無断キャンセル率・最近の予約を検証
  // bookings の NOT NULL 必須列＝facility_id/booking_date/start_time/end_time/customer_name/email
  // （phase4_bookings.sql で確定。types は email? だが実 DB は NOT NULL＝drift）。
  const customerEmail = 'e2e-customer@example.invalid';
  const { error: be } = await sb.from('bookings').insert([
    { facility_id: facilityId, staff_id: staffId, booking_date: today, start_time: '10:00', end_time: '11:00', customer_name: SEED.completedCustomer, email: customerEmail, status: 'completed', total_price: SEED.completedPriceYen },
    { facility_id: facilityId, staff_id: staffId, booking_date: today, start_time: '12:00', end_time: '13:00', customer_name: SEED.noShowCustomer, email: customerEmail, status: 'no_show', total_price: SEED.noShowPriceYen },
    { facility_id: facilityId, staff_id: staffId, booking_date: today, start_time: '14:00', end_time: '15:00', customer_name: SEED.confirmedCustomer, email: customerEmail, status: 'confirmed', total_price: SEED.confirmedPriceYen },
  ]);
  if (be) throw new Error('seed bookings: ' + be.message);

  // 6) 実 UI でログイン（@supabase/ssr の認証 Cookie を確立）
  await page.goto('/auth/login?redirect=/admin');
  await page.fill('#login-email', email);
  await page.fill('#login-password', password);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  // 認可済みオーナーは /admin に着地する（未認可なら /mypage へ飛ぶ）
  await page.waitForURL('**/admin', { timeout: 20000 });
  await expect(page.getByRole('heading', { name: 'ダッシュボード' })).toBeVisible({ timeout: 15000 });

  // 7) 認証済み storageState を保存
  fs.mkdirSync(path.dirname(ADMIN_AUTH_FILE), { recursive: true });
  await page.context().storageState({ path: ADMIN_AUTH_FILE });
});
