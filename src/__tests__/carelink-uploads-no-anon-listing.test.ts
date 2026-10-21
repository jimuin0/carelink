/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * 店舗登録写真（carelink-uploads）は公開バケットなので、表示は公開 URL で足りる。
 * 匿名 SELECT ポリシーを付けると Storage API で申込者全員のファイル名を列挙できてしまう
 * （2026年10月21日に撤去）。migration を適用順に読み、最終状態でこのポリシーが残らないことを固定する。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.cwd(), 'supabase', 'migrations');

// CREATE と DROP を同じ正規表現で拾い、SQL に書かれた順に適用する
// （「DROP POLICY IF EXISTS → CREATE POLICY」の冪等パターンで再作成されたものを見落とさないため）。
const POLICY_STATEMENT = /CREATE POLICY\s+"([^"]+)"\s+ON\s+storage\.objects([^;]*);|DROP POLICY\s+(?:IF EXISTS\s+)?"([^"]+)"\s+ON\s+storage\.objects/gi;

function anonListingPoliciesAfter(sqlFiles: string[]): string[] {
  const live = new Set<string>();
  for (const sql of sqlFiles) {
    for (const m of sql.matchAll(POLICY_STATEMENT)) {
      if (m[3]) { live.delete(m[3]); continue; }
      const body = m[2];
      if (/FOR\s+(SELECT|ALL)\b/i.test(body) && /\banon\b/i.test(body) && body.includes('carelink-uploads')) live.add(m[1]);
      else live.delete(m[1]);
    }
  }
  return [...live];
}

function migrationFiles(): string[] {
  return readdirSync(dir).filter(f => f.endsWith('.sql')).sort().map(f => readFileSync(join(dir, f), 'utf8'));
}

test('carelink-uploads ends with no anonymous listing policy', () => {
  expect(anonListingPoliciesAfter(migrationFiles())).toEqual([]);
});

test('the scan sees the original anonymous read policy (guards against a vacuous pass)', () => {
  const original = readFileSync(join(dir, '20260321000002_storage_policy.sql'), 'utf8');
  expect(original).toMatch(/CREATE POLICY "Allow public read" ON storage\.objects\s+FOR SELECT TO anon/);
});

test('a drop-then-recreate in one file leaves the policy in place (source order is respected)', () => {
  const recreate = `DROP POLICY IF EXISTS "Allow public read" ON storage.objects;
CREATE POLICY "Allow public read" ON storage.objects FOR SELECT TO anon USING (bucket_id = 'carelink-uploads');`;
  expect(anonListingPoliciesAfter([recreate])).toEqual(['Allow public read']);
  expect(anonListingPoliciesAfter([...migrationFiles(), recreate])).toEqual(['Allow public read']);
});

test('policies for other buckets or roles are not counted', () => {
  expect(anonListingPoliciesAfter([
    `CREATE POLICY "photos read" ON storage.objects FOR SELECT TO anon USING (bucket_id = 'photos');`,
    `CREATE POLICY "auth read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'carelink-uploads');`,
  ])).toEqual([]);
});
