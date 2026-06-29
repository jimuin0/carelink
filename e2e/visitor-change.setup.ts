// 来院者（一般ユーザー）の予約日時変更 E2E のセットアップ。
// 1) CI の隔離 Supabase（supabase start の一時 DB）に service role で「予約可能な施設
//    （スタッフ＋全曜日スケジュール→空き枠が出る）＋メニュー」と「来院者＋その本人名義の
//    変更可能な確定予約」を seed する（本番不可侵）。
// 2) 実 UI（/auth/login）で来院者としてログインし、認証済み storageState を保存する。
// visitor-change.spec.ts はこの storageState で /mypage/bookings/[id]/change を開き、
// 新しい日付・空き枠を選んで「日時変更」の書き込みを検証する。
import { test as setup, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { VISITOR_CHANGE_AUTH_FILE, VISITOR_CHANGE_BOOKING_FILE, VISITOR_CHANGE_SEED } from './visitor-change.fixtures';

// supabase-js v2 は Node 20 で createClient 時に WebSocket を要求し throw する。realtime 非接続のためダミー。
if (!globalThis.WebSocket) {
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = class {};
}

// JST の本日 +2 日（YYYY-MM-DD）。CI=UTC のため +9h して算出する。変更元の予約日（未来日）に使う。
function jstDatePlus(days: number): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000 + days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

setup('provision visitor and a changeable booking', async ({ page }) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('visitor-change.setup: SUPABASE env 未設定（CI の supabase start 由来）');
  const sb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const ts = `${Date.now()}`;
  const email = `e2e-change-${ts}@example.invalid`;
  const password = 'TestVisitorChange2026!';

  // 1) 公開施設
  const { data: fac, error: fe } = await sb.from('facility_profiles').insert({
    name: `E2E変更店舗_${ts}`, slug: `e2e-change-${ts}`, business_type: 'hair_salon',
    prefecture: '東京都', city: 'テスト市', address: 'テスト1-1-1', status: 'published',
  }).select('id').single();
  if (fe) throw new Error('seed facility: ' + fe.message);
  const facilityId = fac.id as string;

  // 2) スタッフ（指名あり予約にして staff 単位の空き枠計算を通す）
  const { data: staff, error: se } = await sb.from('staff_profiles').insert({
    facility_id: facilityId, name: VISITOR_CHANGE_SEED.staffName, slug: `e2e-change-staff-${ts}`, sort_order: 1, is_active: true,
  }).select('id').single();
  if (se) throw new Error('seed staff: ' + se.message);
  const staffId = staff.id as string;

  // 3) 全曜日（0=日〜6=土）09:00-20:00 の勤務スケジュール → どの未来日でも空き枠が出る
  const schedules = Array.from({ length: 7 }, (_, d) => ({ staff_id: staffId, day_of_week: d, start_time: '09:00', end_time: '20:00' }));
  const { error: sce } = await sb.from('staff_schedules').insert(schedules);
  if (sce) throw new Error('seed schedules: ' + sce.message);

  // 4) メニュー（duration_minutes は変更ページの空き枠取得 duration に使う・is_published は明示 true）
  const { data: menu, error: me } = await sb.from('facility_menus').insert({
    facility_id: facilityId, category: 'カット', name: VISITOR_CHANGE_SEED.menuName, price: 6000, duration_minutes: 60, is_published: true,
  }).select('id').single();
  if (me) throw new Error('seed menu: ' + me.message);
  const menuId = menu.id as string;

  // 5) 来院者ユーザー
  const { data: cu, error: ce } = await sb.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { display_name: 'E2E変更来院者' },
  });
  if (ce) throw new Error('seed user: ' + ce.message);
  const userId = cu.user.id;

  // 6) 本人名義の確定予約（指名あり・未来日 JST+2 の 10:00-11:00）→ 変更可能(canChange=pending/confirmed)
  const { data: bk, error: be } = await sb.from('bookings').insert({
    facility_id: facilityId, user_id: userId, staff_id: staffId, menu_id: menuId,
    booking_date: jstDatePlus(2), start_time: '10:00', end_time: '11:00',
    customer_name: VISITOR_CHANGE_SEED.customerName, email, status: 'confirmed', total_price: 6000,
  }).select('id').single();
  if (be) throw new Error('seed booking: ' + be.message);

  // 7) 実 UI でログイン（来院者）→ /mypage へ
  await page.goto('/auth/login?redirect=/mypage');
  await page.fill('#login-email', email);
  await page.fill('#login-password', password);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  const outcome = await Promise.race([
    page.waitForURL((u) => !u.pathname.startsWith('/auth/login'), { timeout: 20000 }).then(() => 'navigated').catch(() => 'timeout'),
    page.getByText('メールアドレスまたはパスワードが正しくありません').waitFor({ timeout: 20000 }).then(() => 'bad').catch(() => 'no-error'),
  ]);
  if (outcome !== 'navigated') throw new Error(`visitor-change ログイン失敗 (outcome=${outcome}, url=${page.url()})`);

  fs.mkdirSync(path.dirname(VISITOR_CHANGE_AUTH_FILE), { recursive: true });
  await page.context().storageState({ path: VISITOR_CHANGE_AUTH_FILE });
  fs.writeFileSync(VISITOR_CHANGE_BOOKING_FILE, JSON.stringify({ id: bk.id }));
  expect(bk.id).toBeTruthy();
});
