// 来院者 予約完走 E2E のセットアップ。
// CI の隔離 Supabase（supabase start＝一時 DB・本番不可侵）に「予約可能な施設」を
// service role で seed する：公開施設＋スタッフ＋全曜日の勤務スケジュール（空き枠が出る）
// ＋メニュー。slug をファイルに書き出して spec へ渡す。
import { test as setup } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { BOOKING_FACILITY_FILE, BOOKING_SEED } from './booking.fixtures';

// supabase-js v2 は Node 20 で createClient 時に WebSocket（realtime 用）を要求し throw する。
// seed は REST のみで realtime に接続しないため、ダミーを与えて構築時 throw を回避する。
if (!globalThis.WebSocket) {
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = class {};
}

setup('seed bookable facility', async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('booking setup: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定');
  }
  const sb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const ts = `${Date.now()}`;
  const slug = `e2e-booking-${ts}`;

  // 公開施設
  const { data: fac, error: fe } = await sb
    .from('facility_profiles')
    .insert({
      name: `E2E予約店舗_${ts}`,
      slug,
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

  // スタッフ
  const { data: staff, error: se } = await sb
    .from('staff_profiles')
    .insert({ facility_id: facilityId, name: BOOKING_SEED.staffName, slug: `e2e-bk-staff-${ts}`, sort_order: 1, is_active: true })
    .select('id')
    .single();
  if (se) throw new Error('seed staff: ' + se.message);
  const staffId = staff.id as string;

  // 全曜日（0=日〜6=土）09:00-20:00 の勤務スケジュール → どの日付でも空き枠が出る
  const schedules = Array.from({ length: 7 }, (_, d) => ({
    staff_id: staffId, day_of_week: d, start_time: '09:00', end_time: '20:00',
  }));
  const { error: sce } = await sb.from('staff_schedules').insert(schedules);
  if (sce) throw new Error('seed schedules: ' + sce.message);

  // メニュー（category/name は NOT NULL）。is_published は DEFAULT false で、
  // getFacilityMenus は is_published null/true のみ客向けに出すため true を明示する。
  const { error: me } = await sb.from('facility_menus').insert({
    facility_id: facilityId,
    category: 'カット',
    name: BOOKING_SEED.menuName,
    price: BOOKING_SEED.menuPrice,
    duration_minutes: BOOKING_SEED.menuDuration,
    is_published: true,
  });
  if (me) throw new Error('seed menu: ' + me.message);

  fs.mkdirSync(path.dirname(BOOKING_FACILITY_FILE), { recursive: true });
  fs.writeFileSync(BOOKING_FACILITY_FILE, JSON.stringify({ slug, facilityId }));
});
