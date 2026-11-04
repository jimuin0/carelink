// 一度 search_path を固定した関数が、後の migration の作り直しで固定を失わないようにする。
//
// 🔴 why(2026-11-04 実測): 20261015140541 が search_facilities_nearby の search_path を固定したが、
//   20261030014653 が CREATE OR REPLACE FUNCTION で作り直した。CREATE OR REPLACE は関数の設定
//   （proconfig）も新しい定義で置き換えるので、SET search_path を書き忘れると固定は無言で外れる。
//   本番で proconfig が NULL になり、Supabase の検査（function_search_path_mutable）で初めて見つかった。
//   schema-fingerprint は関数の設定を記録しないため、ドリフト検査でも検知できなかった。
//
// 規則: migration を適用順（辞書順）に読み、一度でも search_path を固定した関数は、
//   最後の状態でも固定されていなければならない。固定とみなすのは次の 2 つ。
//   - CREATE FUNCTION 文の中に SET search_path がある
//   - ALTER FUNCTION … SET search_path
//   CREATE FUNCTION に SET が無い、または ALTER FUNCTION … RESET search_path なら固定を外したとみなす。
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = join(__dirname, '..', '..', '..', 'supabase', 'migrations');

type Event = { name: string; pinned: boolean; file: string };

/** 関数名（スキーマ・引用符を除いた小文字）。オーバーロードは同じ名前として扱う（安全側）。 */
function normalize(raw: string): string {
  return raw.replace(/"/g, '').replace(/^public\./i, '').toLowerCase();
}

/** CREATE FUNCTION 文の末尾（本文の閉じ $tag$ の後の最初の ;）までを切り出す。 */
function createStatement(sql: string, start: number): string {
  const open = /\$([A-Za-z_]*)\$/g;
  open.lastIndex = start;
  const tag = open.exec(sql);
  if (!tag) return sql.slice(start, sql.indexOf(';', start) + 1 || undefined);
  const close = sql.indexOf(tag[0], tag.index + tag[0].length);
  const end = sql.indexOf(';', close + tag[0].length);
  return sql.slice(start, end === -1 ? undefined : end + 1);
}

/** コメントを除いてから、関数の search_path に関わる出来事を出現順に取り出す。 */
export function searchPathEvents(sql: string, file: string): Event[] {
  const text = sql.replace(/--[^\n]*/g, '');
  const events: Array<Event & { at: number }> = [];
  const create = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+((?:"?public"?\.)?"?[A-Za-z_][A-Za-z0-9_]*"?)\s*\(/gi;
  for (let m = create.exec(text); m; m = create.exec(text)) {
    const statement = createStatement(text, m.index);
    // 本文の中の文字列ではなく、文の設定として書かれた SET search_path だけを見る。
    const tagMatch = /\$([A-Za-z_]*)\$/.exec(statement);
    const outside = tagMatch
      ? statement.slice(0, tagMatch.index) + statement.slice(statement.lastIndexOf(tagMatch[0]) + tagMatch[0].length)
      : statement;
    events.push({ name: normalize(m[1]), pinned: /\bSET\s+search_path\b/i.test(outside), file, at: m.index });
  }
  const alter = /ALTER\s+FUNCTION\s+((?:"?public"?\.)?"?[A-Za-z_][A-Za-z0-9_]*"?)\s*(?:\([^;]*?\))?\s*(SET|RESET)\s+search_path\b/gi;
  for (let m = alter.exec(text); m; m = alter.exec(text)) {
    events.push({ name: normalize(m[1]), pinned: m[2].toUpperCase() === 'SET', file, at: m.index });
  }
  return events.sort((a, b) => a.at - b.at).map(({ at: _at, ...event }) => event);
}

/** 一度固定したのに、最後の状態で固定が外れている関数を返す。 */
export function unpinnedAfterPin(files: Array<{ file: string; sql: string }>): string[] {
  const everPinned = new Set<string>();
  const last = new Map<string, Event>();
  for (const { file, sql } of files) {
    for (const event of searchPathEvents(sql, file)) {
      if (event.pinned) everPinned.add(event.name);
      last.set(event.name, event);
    }
  }
  return [...everPinned].filter((name) => !last.get(name)?.pinned)
    .map((name) => `${name}（最後の定義: ${last.get(name)?.file}）`).sort();
}

const migrationFiles = () => readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
  .map((file) => ({ file, sql: readFileSync(join(MIGRATIONS, file), 'utf8') }));

describe('検出の仕組み', () => {
  it('作り直しで SET が無いと外れ、ALTER で固定し直すと戻る', () => {
    const pin = 'ALTER FUNCTION public.f(integer) SET search_path = public, pg_temp;';
    const recreate = 'CREATE OR REPLACE FUNCTION f(a integer) RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;';
    const recreatePinned = 'CREATE OR REPLACE FUNCTION public.f(a integer) RETURNS int LANGUAGE sql SET search_path = public AS $$ SELECT 1 $$;';
    expect(unpinnedAfterPin([{ file: '1.sql', sql: pin }, { file: '2.sql', sql: recreate }])).toEqual(['f（最後の定義: 2.sql）']);
    expect(unpinnedAfterPin([{ file: '1.sql', sql: pin }, { file: '2.sql', sql: recreate }, { file: '3.sql', sql: pin }])).toEqual([]);
    expect(unpinnedAfterPin([{ file: '1.sql', sql: pin }, { file: '2.sql', sql: recreatePinned }])).toEqual([]);
  });
  it('本文の後ろに書いた SET も、RESET も見分ける', () => {
    const trailing = 'CREATE FUNCTION g() RETURNS void AS $fn$ BEGIN END $fn$ LANGUAGE plpgsql SET search_path = \'\';';
    const reset = 'ALTER FUNCTION g() RESET search_path;';
    expect(unpinnedAfterPin([{ file: '1.sql', sql: trailing }])).toEqual([]);
    expect(unpinnedAfterPin([{ file: '1.sql', sql: trailing }, { file: '2.sql', sql: reset }])).toEqual(['g（最後の定義: 2.sql）']);
  });
  it('本文の中の文字列やコメントの SET search_path は数えない', () => {
    const pin = 'ALTER FUNCTION h() SET search_path = public;';
    const body = "CREATE OR REPLACE FUNCTION h() RETURNS text LANGUAGE sql AS $$ SELECT 'SET search_path = x' $$; -- SET search_path";
    expect(unpinnedAfterPin([{ file: '1.sql', sql: pin }, { file: '2.sql', sql: body }])).toEqual(['h（最後の定義: 2.sql）']);
  });
});

describe('supabase/migrations', () => {
  const files = migrationFiles();

  it('migration を読めている（空振り防止）', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.flatMap(({ file, sql }) => searchPathEvents(sql, file)).filter((e) => e.pinned).length).toBeGreaterThan(50);
  });

  it('一度 search_path を固定した関数は、最後の状態でも固定されている', () => {
    expect(unpinnedAfterPin(files)).toEqual([]);
  });

  it('負の対照: 今回の固定し直しを除くと search_facilities_nearby が検出される', () => {
    const without = files.filter(({ file }) => file !== '20261104120000_repin_search_facilities_nearby_path.sql');
    expect(unpinnedAfterPin(without)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^search_facilities_nearby（/)]),
    );
  });
});
