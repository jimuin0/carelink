/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * migration のバージョン番号（ファイル名先頭の数字）が重複していないことを固定する
 * （2026年8月12日 新設）。
 *
 * 🔴 【なぜ必要か＝実際に踏んだ事故】新しい migration を `20260811000001_…` で追加したところ、
 * 同じ番号の `20260811000001_codify_prod_only_indexes_and_feature_admin.sql` が既にあった。
 * Supabase CLI はファイル名の数字部分を `supabase_migrations.schema_migrations.version`
 * （主キー）に入れるため、適用時に
 *
 *     ERROR: duplicate key value violates unique constraint "schema_migrations_pkey"
 *     Key (version)=(20260811000001) already exists.
 *
 * で失敗する。**片方は適用され、もう片方は永久に適用されない**ので、本番とリポジトリが
 * 静かに食い違う原因にもなる。
 *
 * 【なぜユニットテストなのか】この事故を検出したのは E2E（Playwright）だけだった。E2E は
 * Supabase コンテナ起動と全 migration 適用を伴い、失敗まで数分かかるうえ最後に回る。
 * ファイル名を見れば済む検査に、そこまで払う必要はない。
 *
 * 【桁数は検査しない】既存に 8 桁のものが 3 本あり、数字を持たない combined_phase2_to_6.sql
 * もある。形式の統一は本テストの目的ではない（重複だけが実害を出す）。
 */
import { readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase/migrations');

/** ファイル名先頭の数字列をバージョンとして取り出す（数字始まりでないものは対象外）。 */
export function versionOf(filename: string): string | null {
  const m = /^(\d+)_/.exec(filename);
  return m ? m[1] : null;
}

/** 同じバージョンを持つファイル名の組を返す。 */
function duplicateVersions(filenames: string[]): Record<string, string[]> {
  const byVersion = new Map<string, string[]>();
  for (const f of filenames) {
    const v = versionOf(f);
    if (!v) continue;
    if (!byVersion.has(v)) byVersion.set(v, []);
    byVersion.get(v)!.push(f);
  }
  const dups: Record<string, string[]> = {};
  for (const [v, files] of byVersion) if (files.length > 1) dups[v] = files.sort();
  return dups;
}

describe('migration のバージョン番号が一意である', () => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));

  it('走査対象が存在する（空振りを緑にしない）', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.filter((f) => versionOf(f) !== null).length).toBeGreaterThan(100);
  });

  it('重複したバージョン番号が無い', () => {
    // 重複していると supabase の schema_migrations 主キー違反で適用が止まり、
    // 片方の migration が永久に未適用のまま残る。
    expect(duplicateVersions(files)).toEqual({});
  });

  it('重複検出そのものが機能する（負の対照）', () => {
    const planted = ['20260101000001_a.sql', '20260101000001_b.sql', '20260101000002_c.sql'];
    expect(duplicateVersions(planted)).toEqual({
      '20260101000001': ['20260101000001_a.sql', '20260101000001_b.sql'],
    });
    // 数字始まりでないファイルは対象外（combined_phase2_to_6.sql 等）
    expect(duplicateVersions(['combined_phase2_to_6.sql', 'other.sql'])).toEqual({});
    expect(versionOf('combined_phase2_to_6.sql')).toBeNull();
    expect(versionOf('20260812000001_x.sql')).toBe('20260812000001');
  });
});
