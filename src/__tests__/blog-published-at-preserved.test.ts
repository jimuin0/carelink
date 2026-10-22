/**
 * @jest-environment node
 *
 * 公開済みの記事を保存し直しても公開日（published_at）が変わらないことを、
 * 2 つの書き込み RPC の【最新定義】で機械的に固定する（2026年10月22日 新設）。
 *
 * 【不具合】運営のコラム（manage_platform_editor_atomic の post:update）も店舗ブログ
 * （manage_admin_content_atomic の blog:update）も、編集画面が保存のたびに is_published を
 * 必ず送るのに、RPC は「is_published=true が送られたら published_at=clock_timestamp()」と
 * していた。公開中の記事の誤字を直すだけで公開日が今日になり、一覧の先頭へ移っていた。
 *
 * 守るもの:
 *   1. 最新定義の published_at の式が「更新前から公開中なら元の公開日を保つ」形になっている
 *   2. 公開の取り消しは NULL、is_published を送らない保存は元の値のまま（従来どおり）
 *   3. published_at の式以外は、ひとつ前の定義と一字一句同じ（ついでの変更を混ぜない）
 *   4. SECURITY INVOKER・SET search_path・権限（service_role だけが実行できる）を保ち、接続先ガードを持つ
 *
 * 実際の PostgreSQL での挙動（公開日が保たれる・取り消し→再公開で新しい時刻になる）は
 * scripts/check-content-write-concurrency.py と scripts/check-platform-editor-concurrency.py が
 * CI（.github/workflows/schema-fingerprint.yml）の使い捨て DB で確かめる。
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const DIR = join(process.cwd(), 'supabase/migrations');

type Definition = { file: string; sql: string; body: string };

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
  },
  {
    fn: 'manage_platform_editor_atomic',
    table: 'platform_blog_posts',
    record: 'b',
    signature: 'public.manage_platform_editor_atomic(uuid,uuid,text,jsonb,text)',
  },
];

describe.each(cases)('$fn', ({ fn, table, record, signature }) => {
  const defs = definitions(fn);
  const latest = defs[defs.length - 1];
  const previous = defs[defs.length - 2];

  test('空振りしていない（定義が 2 つ以上あり、最新は公開日を保つ migration）', () => {
    expect(defs.length).toBeGreaterThanOrEqual(2);
    expect(latest.file).toBe('20261022190000_blog_keep_original_published_at.sql');
  });

  test('更新前から公開中なら、元の公開日を保つ（保存した日へ上書きしない）', () => {
    const expr = normalize(updatePublishedAt(latest.body));
    expect(expr).toBe(normalize(
      `published_at=CASE WHEN p_values ? 'is_published' THEN CASE WHEN ${record}.is_published THEN `
      + `CASE WHEN ${table}.is_published IS TRUE THEN coalesce(${table}.published_at,clock_timestamp()) ELSE clock_timestamp() END `
      + `ELSE NULL END ELSE ${record}.published_at END`,
    ));
    // 回帰の形そのもの: 「公開なら無条件に今の時刻」を許さない
    expect(expr).not.toMatch(new RegExp(`WHEN ${record}\\.is_published THEN clock_timestamp\\(\\)`));
  });

  test('published_at の式以外は、ひとつ前の定義と同じ', () => {
    const swap = (body: string, expr: string) => normalize(body.replace(updatePublishedAt(body), expr));
    const placeholder = '<published_at>';
    expect(swap(latest.body, placeholder).replace(/^CREATE OR REPLACE FUNCTION/, 'CREATE FUNCTION'))
      .toBe(swap(previous.body, placeholder).replace(/^CREATE OR REPLACE FUNCTION/, 'CREATE FUNCTION'));
  });

  test('SECURITY INVOKER・SET search_path を保ち、service_role だけが実行できる', () => {
    expect(latest.body).toContain("LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$");
    const sql = normalize(latest.sql);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC,anon,authenticated;`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`);
  });

  test('接続先ガードを最初の文に持つ', () => {
    expect(latest.sql.startsWith(
      "DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;",
    )).toBe(true);
  });
});
