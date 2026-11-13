/**
 * 点検 B9-1：facility_profiles の SELECT 権を列単位にした（stripe_account_id を anon / authenticated から隠す）。
 * 列単位 GRANT の下では select('*') が権限エラーになり、列を足したのに一覧へ足し忘れると
 * 画面から新しい列が読めない。ここで次の 3 点を CI で固定する。
 *  1. 読める列の一覧 = schema-snapshot.json の facility_profiles 列 − stripe_account_id
 *  2. ブラウザ権限のクライアントで facility_profiles を select('*') しない
 *  3. migration が stripe_account_id を除いて列単位 GRANT している
 */
import fs from 'fs';
import path from 'path';
import { FACILITY_PROFILE_READABLE_COLUMNS } from '@/lib/facility-profile-columns';

const root = path.resolve(__dirname, '../..');
const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'src/lib/schema-snapshot.json'), 'utf8')) as Record<string, string[]>;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('facility_profiles の列単位 SELECT（B9-1）', () => {
  test('読める列の一覧は schema-snapshot の全列から stripe_account_id だけを除いたもの', () => {
    const listed = FACILITY_PROFILE_READABLE_COLUMNS.split(',').map(c => c.trim()).sort();
    const expected = snapshot.facility_profiles.filter(c => c !== 'stripe_account_id').sort();
    expect(snapshot.facility_profiles).toContain('stripe_account_id');
    expect(listed).toEqual(expected);
    expect(listed).not.toContain('stripe_account_id');
  });

  test("アプリ・e2e のどこでも facility_profiles を select('*') しない（列単位 GRANT で 42501 になる）", () => {
    const files = [...walk(path.join(root, 'src')), ...walk(path.join(root, 'e2e'))];
    expect(files.length).toBeGreaterThan(100);
    const offenders: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      const re = /from\(\s*['"]facility_profiles['"]\s*\)([\s\S]{0,400}?)(;|\n\s*\n)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(source))) {
        const sel = /\.select\(\s*(\)|['"`]\s*\*)/.exec(m[1]);
        if (sel) offenders.push(`${path.relative(root, file)}:${source.slice(0, m.index).split('\n').length}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('migration は stripe_account_id を除いた列だけを anon / authenticated に付け直す', () => {
    const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261113110100_facility_profiles_hide_stripe_account.sql'), 'utf8');
    expect(sql).toMatch(/REVOKE SELECT ON public\.facility_profiles FROM anon, authenticated/);
    expect(sql).toMatch(/attname <> 'stripe_account_id'/);
    expect(sql).toMatch(/GRANT SELECT \(%s\) ON public\.facility_profiles TO anon, authenticated/);
  });
});
