/**
 * @jest-environment node
 *
 * CareLink ポイントの台帳（user_points）を読めるのは本人だけ（2026年10月23日）。
 *
 * 台帳は全店共通で、他店での来店ポイント（支払額の目安と日時）・口コミポイント（どの店に書いたか）・
 * 誕生日ポイント（誕生月）まで載る。以前あった user_points_facility_member_read は
 * 「自店に予約がある客か」だけで全行を店舗の owner / admin に読ませていた（PostgREST を直接叩けば読めた）。
 * migration 20261023000000 で撤去した。
 *
 * migration を適用順（辞書順。接頭辞の無い combined_phase2_to_6.sql は最後）に読み、
 * 最終状態で user_points に残るポリシーが「本人の行を読む SELECT」1 本だけであることを固定する。
 * 実 DB での確認（店舗の owner が客の台帳を 0 行しか読めないこと）は
 * supabase/shadow/booking-points-cap-fixtures.sql が CI の使い捨て PG17 で行う。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.cwd(), 'supabase', 'migrations');
const MIGRATION = '20261023000000_user_points_own_read_only.sql';

/** コメントを除き空白を 1 つに潰した SQL（説明文の中の語に反応しない）。 */
const code = (text: string) => text.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');

// CREATE と DROP を同じ正規表現で拾い、書かれた順に適用する
// （「DROP POLICY IF EXISTS → CREATE POLICY」で作り直したものを見落とさないため）。
const POLICY_STATEMENT = /CREATE POLICY\s+"?(\w+)"?\s+ON\s+(?:public\.)?"?user_points"?(?!\w)([^;]*);|DROP POLICY\s+(?:IF EXISTS\s+)?"?(\w+)"?\s+ON\s+(?:public\.)?"?user_points"?(?!\w)/gi;

function userPointsPoliciesAfter(sqlFiles: string[]): Map<string, string> {
  const live = new Map<string, string>();
  for (const sql of sqlFiles) {
    for (const m of code(sql).matchAll(POLICY_STATEMENT)) {
      if (m[3]) live.delete(m[3]);
      else live.set(m[1], m[2].trim());
    }
  }
  return live;
}

function migrationFiles(): string[] {
  return readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(join(dir, f), 'utf8'));
}

test('最終状態で user_points に残るポリシーは本人の行を読む SELECT の 1 本だけ', () => {
  const live = userPointsPoliciesAfter(migrationFiles());
  expect([...live.keys()]).toEqual(['user_points_own_read']);
  expect(live.get('user_points_own_read')).toBe('FOR SELECT USING (auth.uid() = user_id)');
});

test('撤去する migration は接続先ガードで始まり、ポリシーを消すだけ', () => {
  const sql = code(readFileSync(join(dir, MIGRATION), 'utf8')).trim();
  expect(sql).toMatch(/^DO \$guard\$ BEGIN IF to_regclass\('public\.facility_profiles'\) IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END \$guard\$;/);
  expect(sql).toContain('DROP POLICY IF EXISTS "user_points_facility_member_read" ON public.user_points;');
  expect(sql).not.toMatch(/CREATE POLICY|GRANT/i);
});

test('走査は撤去前の店舗向けポリシーを実際に拾っている（空振りしていない）', () => {
  const before = readdirSync(dir).filter((f) => f.endsWith('.sql') && f < MIGRATION).sort()
    .map((f) => readFileSync(join(dir, f), 'utf8'));
  expect([...userPointsPoliciesAfter(before).keys()].sort()).toEqual(['user_points_facility_member_read', 'user_points_own_read']);
});

test('後の migration で作り直すと検出する（書かれた順に適用する・負の対照）', () => {
  const recreate = `DROP POLICY IF EXISTS "user_points_facility_member_read" ON user_points;
CREATE POLICY "user_points_facility_member_read" ON user_points FOR SELECT USING (true);`;
  expect([...userPointsPoliciesAfter([...migrationFiles(), recreate]).keys()].sort())
    .toEqual(['user_points_facility_member_read', 'user_points_own_read']);
  // FOR 句の無いポリシー（FOR ALL）や引用符なし・スキーマ付きも拾う
  expect([...userPointsPoliciesAfter([...migrationFiles(), 'CREATE POLICY anyone ON public.user_points USING (true);']).keys()])
    .toContain('anyone');
});

test('他のテーブルのポリシーは数えない', () => {
  expect(userPointsPoliciesAfter([
    'CREATE POLICY "user_points_archive_read" ON user_points_archive FOR SELECT USING (true);',
    'CREATE POLICY "bookings_read" ON public.bookings FOR SELECT USING (true);',
  ]).size).toBe(0);
});
