/** @jest-environment node */
/**
 * 掲載が下書き・停止に戻った施設のお気に入りを外せる（2026年10月23日・20261023140000）。
 *
 * 回帰の中身: toggle_user_favorite_atomic が p_desired に関係なく最初に「施設が published か」を確かめて
 * P0002 を投げていたため、非公開になった施設のお気に入りは /api/favorites からも外せなかった
 * （ブラウザのロールは favorites へ書けないので、外す経路はこの RPC しか無い）。
 *
 * 振る舞いは supabase/shadow/favorite-removal-unpublished-fixtures.sql が使い捨て DB で確かめる。ここは次を固定する:
 *   - 【最後に適用される定義】が、削除を published の確認より前に行い、published の確認は追加の経路だけにあること
 *   - 追加は今も published の施設に限ること（FOR SHARE で非公開化と直列化する）
 *   - SECURITY INVOKER・search_path・権限（service_role だけ）を変えていないこと
 *   - 接続先ガードと、使い捨て DB での検証が CI に配線されていること
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const MIGRATION = '20261023140000_favorite_removal_after_unpublish.sql';
const FIXTURE = 'supabase/shadow/favorite-removal-unpublished-fixtures.sql';
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
const withoutComments = (sql: string) => sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');

/** 辞書順（＝適用順）で最後に現れる toggle_user_favorite_atomic の定義と、そのファイル。 */
function latestDefinition(): { file: string; body: string } {
  let found: { file: string; body: string } | null = null;
  for (const file of files) {
    const sql = withoutComments(readFileSync(join(MIGRATIONS, file), 'utf8'));
    for (const match of sql.matchAll(/CREATE (?:OR REPLACE )?FUNCTION public\.toggle_user_favorite_atomic\(/g)) {
      const open = sql.indexOf('$$', match.index);
      found = { file, body: sql.slice(match.index, sql.indexOf('$$', open + 2) + 2) };
    }
  }
  if (!found) throw new Error('toggle_user_favorite_atomic is not defined');
  return found;
}

describe('toggle_user_favorite_atomic: 外す操作は施設の掲載状態に左右されない', () => {
  const { file, body } = latestDefinition();
  const deleteAt = body.indexOf('DELETE FROM public.favorites');
  const publishedAt = body.indexOf("status='published' FOR SHARE");

  test('最後に適用される定義はこの migration', () => {
    expect(file).toBe(MIGRATION);
  });

  test('削除は published の確認より前にあり、追加の経路（p_desired が true 以外）でだけ行う', () => {
    expect(deleteAt).toBeGreaterThan(-1);
    expect(publishedAt).toBeGreaterThan(-1);
    expect(deleteAt).toBeLessThan(publishedAt);
    const removal = body.slice(body.indexOf('IF p_desired IS NOT true THEN'), publishedAt);
    expect(removal).toContain('DELETE FROM public.favorites WHERE user_id=p_actor_id AND facility_id=p_facility_id');
    // 外す（false）か、トグルで行が消えたら、施設を見ずに false を返す。
    expect(removal).toContain('IF p_desired IS false OR FOUND THEN RETURN false; END IF;');
  });

  test('追加は今も公開中の施設だけ（見つからなければ P0002）', () => {
    const addition = body.slice(publishedAt);
    expect(addition).toContain("RAISE EXCEPTION 'FAVORITE_FACILITY_UNAVAILABLE' USING ERRCODE='P0002'");
    expect(addition.indexOf('RAISE EXCEPTION')).toBeLessThan(addition.indexOf('INSERT INTO public.favorites'));
  });

  test('ロックの順序（アカウント → 利用者×施設）と関数の性質は変えていない', () => {
    expect(body).toContain('RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=\'\'');
    expect(body).toContain('p_desired boolean DEFAULT NULL');
    const account = body.indexOf('PERFORM public.lock_booking_account(p_actor_id);');
    const pair = body.indexOf("pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('favorite:'||p_actor_id::text||':'||p_facility_id::text,0))");
    expect(account).toBeGreaterThan(-1);
    expect(pair).toBeGreaterThan(account);
    expect(deleteAt).toBeGreaterThan(pair);
  });

  test('接続先ガードと権限の再宣言がある', () => {
    const sql = readFileSync(join(MIGRATIONS, MIGRATION), 'utf8');
    expect(sql).toMatch(/DO \$guard\$ BEGIN IF to_regclass\('public\.facility_profiles'\) IS NULL THEN RAISE EXCEPTION/);
    expect(sql.indexOf('DO $guard$')).toBeLessThan(sql.indexOf('CREATE OR REPLACE FUNCTION'));
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.toggle_user_favorite_atomic(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.toggle_user_favorite_atomic(uuid,uuid,boolean) TO service_role;');
  });

  test('使い捨て DB での検証が CI に配線されている', () => {
    const workflow = readFileSync(join(ROOT, '.github/workflows/schema-fingerprint.yml'), 'utf8');
    expect(workflow).toContain(`psql -X -v ON_ERROR_STOP=1 -d carelink_shadow -f ${FIXTURE}`);
    const fixture = readFileSync(join(ROOT, FIXTURE), 'utf8');
    expect(fixture).toContain("'removing a draft facility returns false'");
    expect(fixture).toContain("'adding a draft facility is refused'");
    expect(fixture.trim().endsWith('ROLLBACK;')).toBe(true);
  });
});
