/**
 * 点検 A280: 20260321000004_facilities_phase1.sql が入れる架空の公開施設 10 件を、
 * 新しい環境でも残さないことを固定する（適用済み migration は書き換えず、後続 migration で消す）。
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const seed = readFileSync(join(ROOT, 'supabase/migrations/20260321000004_facilities_phase1.sql'), 'utf8');
const removal = readFileSync(join(ROOT, 'supabase/migrations/20261114400000_remove_phase1_fictional_facilities.sql'), 'utf8');

// シードの INSERT INTO facility_profiles ... VALUES ( '名前', 'slug', ... の組を取り出す。
const seeded = [...seed.matchAll(/INSERT INTO facility_profiles[^\n]*\nVALUES \(\n\s*'([^']+)',\n\s*'([^']+)',/g)]
  .map((m) => ({ name: m[1], slug: m[2] }));

test('シードの架空施設 10 件を取り出せる（空振り防止）', () => {
  expect(seeded).toHaveLength(10);
});

test.each(seeded)('$slug を施設名つきで削除対象にしている', ({ name, slug }) => {
  expect(removal).toContain(`('${slug}', '${name}')`);
});

test('接続先ガードと、実店舗を消さないための条件を持つ', () => {
  expect(removal).toMatch(/DO \$guard\$ BEGIN\s+IF to_regclass\('public\.facility_profiles'\) IS NULL/);
  expect(removal).toContain("split_part(p.main_photo_url, '/', 3) = 'images.unsplash.com'");
  expect(removal).toContain('NOT EXISTS (SELECT 1 FROM public.facility_members m WHERE m.facility_id = p.id)');
  expect(removal).toContain('p.name = seed.name');
});
