/**
 * 店舗に見せるお客様のメールは「その店舗の予約で入力したもの（bookings.email の最新）」だけ（点検 A414）。
 * profiles.email（本人が自由に書き換えられる・ログイン用と同じことがある）を店舗へ返さないことを、
 * list_facility_customer_profiles の最終定義で固定する。
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const DIR = join(process.cwd(), 'supabase/migrations');
const files = readdirSync(DIR).filter(f => /^\d{14}_.*\.sql$/.test(f)).sort();
const defining = files.filter(f => /FUNCTION public\.list_facility_customer_profiles\(/.test(readFileSync(join(DIR, f), 'utf8'))
  && /CREATE (OR REPLACE )?FUNCTION public\.list_facility_customer_profiles\(/.test(readFileSync(join(DIR, f), 'utf8')));
const latest = defining[defining.length - 1];
const body = readFileSync(join(DIR, latest), 'utf8');
const fn = body.slice(body.indexOf('FUNCTION public.list_facility_customer_profiles('), body.indexOf('$$;', body.indexOf('FUNCTION public.list_facility_customer_profiles(')));

test('最終定義は 20261114500100 以降', () => {
  expect(latest >= '20261114500100').toBe(true);
});
test('メールは予約（bookings.email）の最新から取り、profiles.email を返さない', () => {
  expect(fn).not.toMatch(/p\.email/);
  expect(fn).toMatch(/SELECT nullif\(b\.email, ''\)\s+FROM public\.bookings b\s+WHERE b\.facility_id = p_facility_id AND b\.user_id = p\.id\s+ORDER BY b\.created_at DESC, b\.id DESC\s+LIMIT 1/);
});
test('店舗の owner/admin 確認と予約者限定・service_role 専用は維持', () => {
  expect(fn).toContain("m.role IN ('owner', 'admin')");
  expect(fn).toContain('SECURITY INVOKER SET search_path = \'\'');
  expect(body).toContain('GRANT EXECUTE ON FUNCTION public.list_facility_customer_profiles(uuid, uuid, uuid[]) TO service_role;');
  expect(body).toContain('REVOKE ALL ON FUNCTION public.list_facility_customer_profiles(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;');
});
