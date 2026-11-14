/**
 * 点検 A66（2026年11月13日）：facility_photos へブラウザから書ける URL を自社 Storage の
 * photos/facilities/<自施設ID>/ に限る migration の固定。
 * DB を立てずに検査するため、SQL の判定を同じ規則の JS に写し、管理画面が保存する URL 形式
 * （getPublicUrl の結果）が通ること・外部 URL や他施設のパスが通らないことを確かめる。
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261113120000_facility_photos_own_storage_url.sql'), 'utf8');
const page = readFileSync(join(process.cwd(), 'src/app/admin/photos/page.tsx'), 'utf8');

const FID = '11111111-2222-3333-4444-555555555555';
function ownStorage(url: string | null, facilityId: string | null): boolean {
  if (url === null || facilityId === null) return false;
  if (url.includes('..') || url.includes('\\')) return false;
  if (/[?#\s]/.test(url)) return false;
  return new RegExp(`^https?://[A-Za-z0-9.-]+(:[0-9]+)?/storage/v1/object/public/photos/facilities/${facilityId}/[^/]+$`).test(url);
}

test('migration は接続先ガード・判定関数・INSERT/UPDATE の WITH CHECK を持つ', () => {
  expect(sql).toMatch(/DO \$guard\$[\s\S]*to_regclass\('public\.facility_profiles'\)/);
  expect(sql).toContain("strpos(p_url, '..') = 0");
  expect(sql).toContain('/storage/v1/object/public/photos/facilities/');
  const checks = sql.match(/AND public\.facility_photo_url_is_own_storage\(photo_url, facility_id\)/g) ?? [];
  expect(checks).toHaveLength(2);
  expect(sql).toMatch(/CREATE POLICY "owner_admin_insert_photos"[\s\S]*FOR INSERT TO authenticated/);
  expect(sql).toMatch(/CREATE POLICY "owner_admin_update_photos"[\s\S]*FOR UPDATE TO authenticated/);
  // 既存行に触れない
  expect(sql).not.toMatch(/\b(DELETE FROM|UPDATE public\.facility_photos)\b/i);
});

test('管理画面のアップロード先は photos バケットの facilities/<施設ID>/ のまま', () => {
  expect(page).toContain("const path = `facilities/${facilityId}/${Date.now()}-${i}.${ext}`;");
  expect(page).toContain(".from('photos').getPublicUrl(path)");
});

test.each([
  [`https://xzafxiupbflvgbarrihe.supabase.co/storage/v1/object/public/photos/facilities/${FID}/1731480000000-0.jpg`, true],
  [`http://127.0.0.1:54321/storage/v1/object/public/photos/facilities/${FID}/1-0.png`, true],
  ['https://images.unsplash.com/photo-1.jpg', false],
  [`https://evil.example/storage/v1/object/public/photos/facilities/99999999-2222-3333-4444-555555555555/1.jpg`, false],
  [`https://x.supabase.co/storage/v1/object/public/salons/facilities/${FID}/1.jpg`, false],
  [`https://x.supabase.co/storage/v1/object/public/photos/facilities/${FID}/../other/1.jpg`, false],
  [`https://x.supabase.co/storage/v1/object/public/photos/facilities/${FID}/1.jpg?x=1`, false],
  [`https://x.supabase.co/storage/v1/object/public/photos/facilities/${FID}/a/b.jpg`, false],
])('%s → %s', (url, ok) => {
  expect(ownStorage(url, FID)).toBe(ok);
});

test('URL・施設 ID が無ければ通さない', () => {
  expect(ownStorage(null, FID)).toBe(false);
  expect(ownStorage('x', null)).toBe(false);
});
