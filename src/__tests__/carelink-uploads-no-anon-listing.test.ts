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

function finalAnonListingPolicies(): string[] {
  const live = new Set<string>();
  for (const file of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(dir, file), 'utf8');
    for (const m of sql.matchAll(/CREATE POLICY\s+"([^"]+)"\s+ON\s+storage\.objects\s+FOR\s+(SELECT|ALL)\s+TO\s+[^;]*\banon\b[^;]*carelink-uploads[^;]*;/gi)) live.add(m[1]);
    for (const m of sql.matchAll(/DROP POLICY\s+(?:IF EXISTS\s+)?"([^"]+)"\s+ON\s+storage\.objects/gi)) live.delete(m[1]);
  }
  return [...live];
}

test('carelink-uploads ends with no anonymous listing policy', () => {
  expect(finalAnonListingPolicies()).toEqual([]);
});

test('the scan sees the original anonymous read policy (guards against a vacuous pass)', () => {
  const original = readFileSync(join(dir, '20260321000002_storage_policy.sql'), 'utf8');
  expect(original).toMatch(/CREATE POLICY "Allow public read" ON storage\.objects\s+FOR SELECT TO anon/);
});
