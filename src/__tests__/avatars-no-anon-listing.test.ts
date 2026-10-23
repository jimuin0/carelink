/**
 * @jest-environment node
 *
 * プロフィール写真（avatars）は公開バケットなので、表示は公開 URL で足りる。匿名の SELECT ポリシー
 * 「Public read avatars」（20260420000011）が残っていたため、Storage API の一覧で全会員の
 * アカウント ID（フォルダ名）と顔写真の URL を列挙できた（2026年10月23日に撤去・20261023190100）。
 * migration を適用順に読み、最終状態で匿名・公開の読み取りポリシーが残らないこと、新しい写真が
 * 推測できない名前で保存されることを固定する。実 DB での挙動は
 * supabase/shadow/avatars-no-anon-listing-fixtures.sql が CI の使い捨て PG17 で確かめる。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const dir = join(ROOT, 'supabase', 'migrations');
const FILE = '20261023190100_avatars_no_anon_listing.sql';
const SQL = readFileSync(join(dir, FILE), 'utf8');

// CREATE と DROP を同じ正規表現で拾い、SQL に書かれた順に適用する（名前は引用符あり・なしの両方）。
const POLICY_STATEMENT = /CREATE POLICY\s+(?:"([^"]+)"|(\w+))\s+ON\s+storage\.objects([^;]*);|DROP POLICY\s+(?:IF EXISTS\s+)?(?:"([^"]+)"|(\w+))\s+ON\s+storage\.objects/gi;
const withoutComments = (sql: string) => sql.replace(/--[^\n]*/g, '');

function avatarReadPoliciesAfter(sqlFiles: string[]): Map<string, string> {
  const live = new Map<string, string>();
  for (const sql of sqlFiles) {
    for (const m of withoutComments(sql).matchAll(POLICY_STATEMENT)) {
      const dropped = m[4] ?? m[5];
      if (dropped) { live.delete(dropped); continue; }
      const name = (m[1] ?? m[2])!;
      const body = m[3];
      if (/FOR\s+(SELECT|ALL)\b/i.test(body) && body.includes("'avatars'")) live.set(name, body);
      else live.delete(name);
    }
  }
  return live;
}
const migrationFiles = () => readdirSync(dir).filter(f => f.endsWith('.sql')).sort().map(f => readFileSync(join(dir, f), 'utf8'));

test('最終状態で avatars を読めるのは本人のフォルダだけ（匿名・公開の読み取りが残らない）', () => {
  const live = avatarReadPoliciesAfter(migrationFiles());
  expect([...live.keys()]).toEqual(['avatars_select_own_live']);
  const body = live.get('avatars_select_own_live')!;
  expect(body).toMatch(/TO authenticated/);
  expect(body).toContain("(storage.foldername(name))[1]=(SELECT auth.uid())::text");
});

test('走査は元の匿名読み取りポリシーを見ている（空振り防止）', () => {
  const original = readFileSync(join(dir, '20260420000011_storage_image_only.sql'), 'utf8');
  expect(original).toMatch(/CREATE POLICY "Public read avatars" ON storage\.objects\s+FOR SELECT TO anon\s+USING \(bucket_id = 'avatars'\);/);
  const before = avatarReadPoliciesAfter(readdirSync(dir).filter(f => f.endsWith('.sql') && f < FILE).sort()
    .map(f => readFileSync(join(dir, f), 'utf8')));
  expect([...before.keys()].sort()).toEqual(['Public read avatars', 'avatars_select_own_live']);
});

test('同じファイルで消して作り直せば残る（書かれた順に適用している）', () => {
  const recreate = `DROP POLICY IF EXISTS "Public read avatars" ON storage.objects;
CREATE POLICY "Public read avatars" ON storage.objects FOR SELECT TO anon USING (bucket_id = 'avatars');`;
  expect([...avatarReadPoliciesAfter([...migrationFiles(), recreate]).keys()]).toContain('Public read avatars');
});

describe(`${FILE} の形`, () => {
  test('接続先ガードが最初・匿名の読み取りを消し、残りがあれば止める', () => {
    expect(SQL.indexOf('DO $guard$')).toBeGreaterThan(-1);
    expect(SQL.indexOf('DO $guard$')).toBeLessThan(SQL.indexOf('DROP POLICY'));
    expect(SQL).toContain("IF to_regclass('public.facility_profiles') IS NULL OR to_regclass('storage.objects') IS NULL THEN");
    expect(SQL).toContain('DROP POLICY IF EXISTS "Public read avatars" ON storage.objects;');
    expect(SQL).toContain("RAISE EXCEPTION 'avatars/review-photos listing policy requires reconciliation: %', leftover;");
    // 本番には migration 外で作られた同等のポリシーが別名で残っていた（2026-10-23 pg_policies で確認）
    expect(SQL).toContain('DROP POLICY IF EXISTS avatars_public_read ON storage.objects;');
    expect(SQL).toContain('DROP POLICY IF EXISTS review_photos_public_read ON storage.objects;');
    expect(SQL).toContain('DROP POLICY IF EXISTS "Public read review-photos" ON storage.objects;');
    expect(SQL.indexOf('DROP POLICY IF EXISTS "Public read avatars"')).toBeLessThan(SQL.indexOf('DO $reconcile$'));
  });

  test('本人のフォルダだけを消せる DELETE ポリシー（書き込みポリシーと同じ条件）', () => {
    expect(SQL).toContain(`CREATE POLICY avatars_delete_own ON storage.objects FOR DELETE TO authenticated
USING(bucket_id='avatars' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text
  AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid())));`);
    const insert = readFileSync(join(dir, '20261008104929_salon_upload_capacity_and_write_scope.sql'), 'utf8');
    expect(insert).toContain(`WITH CHECK(bucket_id='avatars' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text
  AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid())));`);
  });

  test('適用順とデプロイとの前後を明記している', () => {
    expect(SQL).toContain('Apply order: after every migration up to 20261023190000.');
    expect(SQL).toContain('Safe before or after deploying the');
  });
});

test('プロフィール画面は推測できる名前（avatar.<拡張子>）で上書きしない・一覧を取らない', () => {
  const page = readFileSync(join(ROOT, 'src/app/mypage/profile/page.tsx'), 'utf8');
  expect(page).toContain("import { uploadAvatar } from '@/lib/avatar-upload';");
  expect(page).toContain('await uploadAvatar(supabase, user.id, file, avatarUrl);');
  expect(page).not.toMatch(/\/avatar\.\$\{ext\}/);
  expect(page).not.toMatch(/upsert:\s*true/);
  for (const source of [page, readFileSync(join(ROOT, 'src/lib/avatar-upload.ts'), 'utf8')]) expect(source).not.toMatch(/\.list\(/);
});

test('実 DB での挙動を確かめる shadow fixture が CI に配線されている', () => {
  const workflow = readFileSync(join(ROOT, '.github/workflows/schema-fingerprint.yml'), 'utf8');
  expect(workflow).toContain('psql -X -v ON_ERROR_STOP=1 -d carelink_shadow -f supabase/shadow/avatars-no-anon-listing-fixtures.sql');
  const fixture = readFileSync(join(ROOT, 'supabase/shadow/avatars-no-anon-listing-fixtures.sql'), 'utf8');
  expect(fixture).toMatch(/^BEGIN;$/m);
  expect(fixture.trim().endsWith('ROLLBACK;')).toBe(true);
  expect(fixture).toContain("IF current_database() NOT LIKE 'carelink_shadow%'");
  for (const label of [
    "anonymous listing returns no avatar (before: every member''s account id)",
    'a member reads only their own folder',
    'a member deletes their own previous photo',
    "another member''s photo cannot be deleted",
    'a retired account cannot delete through RLS',
  ]) expect(fixture).toContain(label);
});
