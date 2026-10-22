/**
 * @jest-environment node
 *
 * 公開済みの記事を保存し直しても公開日（published_at）が変わらないことを、
 * 2 つの書き込み RPC で機械的に固定する（2026年10月22日 新設）。
 *
 * 【不具合】運営のコラム（manage_platform_editor_atomic の post:update）も店舗ブログ
 * （manage_admin_content_atomic の blog:update）も、編集画面が保存のたびに is_published を
 * 必ず送るのに、RPC は「is_published=true が送られたら published_at=clock_timestamp()」と
 * していた。公開中の記事の誤字を直すだけで公開日が今日になり、一覧の先頭へ移っていた。
 *
 * 守るもの:
 *   1. 【最新定義】の published_at の式が「更新前から公開中なら元の公開日を保つ」形のまま
 *      （公開の取り消しは NULL、is_published を送らない保存は元の値のまま＝従来どおり）。
 *      最新定義が修正 migration より古い（＝修正が消えた）状態も落とす。
 *   2. 修正 migration（20261022190000）の定義は、published_at の式以外が修正前の定義
 *      （ファイル名で固定）と一字一句同じ（ついでの変更を混ぜていない）
 *   3. 修正 migration が SECURITY INVOKER・SET search_path・権限（service_role だけが実行できる）を保ち、
 *      接続先ガードを持つ
 *
 * 比較の相手をファイル名で固定しているのは、今後この RPC を正当に定義し直したとき
 * （kind の追加など）に 2 の比較が落ちないようにするため。最新定義に求めるのは 1 だけ。
 *
 * 実際の PostgreSQL での挙動（公開日が保たれる・取り消し→再公開で新しい時刻になる）は
 * scripts/check-content-write-concurrency.py と scripts/check-platform-editor-concurrency.py が
 * CI（.github/workflows/schema-fingerprint.yml）の使い捨て DB で確かめる。
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const DIR = join(process.cwd(), 'supabase/migrations');

type Definition = { file: string; sql: string; body: string };

/** 公開日を保つ修正を入れた migration。 */
const FIX_FILE = '20261022190000_blog_keep_original_published_at.sql';

/** タイムスタンプ順で、関数を定義する migration を古い順に返す。 */
function definitions(fn: string): Definition[] {
  const pattern = new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${fn}\\([\\s\\S]*?END \\$\\$;`);
  return readdirSync(DIR)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(DIR, file), 'utf8') }))
    .map(({ file, sql }) => {
      const m = pattern.exec(sql);
      return m ? { file, sql, body: m[0] } : null;
    })
    .filter((d): d is Definition => d !== null);
}

/** UPDATE 文の published_at=... の式（次の列代入 or WHERE の手前まで）を取り出す。 */
function updatePublishedAt(body: string): string {
  const m = /UPDATE public\.(?:blog_posts|platform_blog_posts) SET[\s\S]*?(published_at=CASE[\s\S]*?END)(?=,updated_at=|\s+WHERE )/.exec(body);
  if (!m) throw new Error('UPDATE の published_at の式を抽出できなかった');
  return m[1];
}

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

const cases = [
  {
    fn: 'manage_admin_content_atomic',
    table: 'blog_posts',
    record: 'blog',
    signature: 'public.manage_admin_content_atomic(uuid,uuid,uuid,text,jsonb)',
    beforeFix: '20261017143936_admin_content_write_authority_atomic.sql',
  },
  {
    fn: 'manage_platform_editor_atomic',
    table: 'platform_blog_posts',
    record: 'b',
    signature: 'public.manage_platform_editor_atomic(uuid,uuid,text,jsonb,text)',
    beforeFix: '20261019023252_platform_editor_write_atomic.sql',
  },
];

describe.each(cases)('$fn', ({ fn, table, record, signature, beforeFix }) => {
  const defs = definitions(fn);
  const latest = defs[defs.length - 1];
  const byFile = (file: string) => {
    const def = defs.find((d) => d.file === file);
    if (!def) throw new Error(`${file} に ${fn} の定義が見つからない`);
    return def;
  };
  const fix = byFile(FIX_FILE);
  const previous = byFile(beforeFix);

  /** 「更新前から公開中なら元の公開日を保つ」式。 */
  const keepsOriginalDate = normalize(
    `published_at=CASE WHEN p_values ? 'is_published' THEN CASE WHEN ${record}.is_published THEN `
    + `CASE WHEN ${table}.is_published IS TRUE THEN coalesce(${table}.published_at,clock_timestamp()) ELSE clock_timestamp() END `
    + `ELSE NULL END ELSE ${record}.published_at END`,
  );

  test('最新定義は修正 migration 以降のもの（修正が古い定義で上書きされていない）', () => {
    expect(latest.file >= FIX_FILE).toBe(true);
  });

  test('最新定義でも、更新前から公開中なら元の公開日を保つ（保存した日へ上書きしない）', () => {
    const expr = normalize(updatePublishedAt(latest.body));
    expect(expr).toBe(keepsOriginalDate);
    // 回帰の形そのもの: 「公開なら無条件に今の時刻」を許さない
    expect(expr).not.toMatch(new RegExp(`WHEN ${record}\\.is_published THEN clock_timestamp\\(\\)`));
  });

  test('修正前の定義は公開のたびに今の時刻を入れていた（負の対照・比較相手の取り違え防止）', () => {
    expect(normalize(updatePublishedAt(previous.body))).toMatch(
      new RegExp(`WHEN ${record}\\.is_published THEN clock_timestamp\\(\\)`),
    );
  });

  test('修正 migration は published_at の式以外を修正前の定義から変えていない', () => {
    const swap = (body: string) => normalize(body.replace(updatePublishedAt(body), '<published_at>'))
      .replace(/^CREATE OR REPLACE FUNCTION/, 'CREATE FUNCTION');
    expect(swap(fix.body)).toBe(swap(previous.body));
  });

  test('修正 migration は SECURITY INVOKER・SET search_path を保ち、service_role だけが実行できる', () => {
    expect(fix.body).toContain("LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$");
    const sql = normalize(fix.sql);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC,anon,authenticated;`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`);
  });

  test('修正 migration は接続先ガードを最初の文に持つ', () => {
    expect(fix.sql.startsWith(
      "DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;",
    )).toBe(true);
  });
});
