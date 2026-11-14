/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * GPS 検索のキーワード照合が NULL 安全であることを固定する（2026年8月12日 新設）。
 *
 * 🔴 【本番で実測した欠陥】migration 20260812000001 が複数語 AND 判定を
 *
 *     NOT EXISTS (… WHERE term <> '' AND NOT (col ILIKE … OR col ILIKE … ))
 *
 * で書いたが、6列のうち1つでも NULL があると OR 連鎖が NULL になり、`NOT NULL` も NULL、
 * 内側の WHERE が NULL の行を返さないため【その語は一致した】と誤判定される。
 * 結果、**どれか1列でも NULL の施設は、どんなキーワードにも一致する**。
 *
 * 本番実測: 現在地 (34.7706, 135.4532) キーワード「豊中 鍼灸」で、鍼灸院に加えて
 * 照合列に NULL を含むまつげサロン2店が返っていた。20260812000002 で COALESCE を入れて解消。
 *
 * 【なぜ静的検査なのか】この誤りは SQL を読んでも気づきにくく、
 * 「AND のつもりが実質 OR 以下」という形で静かに検索結果を汚す。
 * 実データを本番で見るまで発覚しなかったので、書き方そのものを固定する。
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS = join(process.cwd(), 'supabase/migrations');

/**
 * search_facilities_nearby の定義文。schema 修飾（public.）・引用符・空白/改行・大小文字の違いでも拾う。
 * 固定文字列の includes だと `CREATE OR REPLACE FUNCTION public.search_facilities_nearby(` の新定義を
 * 見落とし、古い定義を検査し続けて緑になる。
 */
const DEFINITION_RE = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:"?public"?\.)?"?search_facilities_nearby"?\s*\(/i;

/** search_facilities_nearby を定義する migration のうち、版番号が最大＝最終的に有効なもの。 */
function latestSearchRpcMigration(): string {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => DEFINITION_RE.test(readFileSync(join(MIGRATIONS, f), 'utf8')))
    .sort();
  expect(files.length).toBeGreaterThan(0);
  return readFileSync(join(MIGRATIONS, files[files.length - 1]), 'utf8');
}

/** キーワード照合ブロック（NOT EXISTS 〜 その閉じまで）を切り出す。 */
function keywordBlock(sql: string): string {
  const start = sql.indexOf('OR NOT EXISTS (');
  expect(start).toBeGreaterThan(-1);
  const end = sql.indexOf('AND (features_filter IS NULL', start);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}

/** 各 `… ILIKE …` の左辺（比較される式）を取り出す。 */
function leftOperands(sql: string): string[] {
  return [...sql.matchAll(/^\s*(?:OR\s+)?(.+?)\s+ILIKE/gm)].map((m) => m[1].trim());
}

describe('定義文の検出（最新定義の取りこぼし防止）', () => {
  it.each([
    'CREATE OR REPLACE FUNCTION search_facilities_nearby(',
    'CREATE OR REPLACE FUNCTION public.search_facilities_nearby(',
    'create or replace function "public"."search_facilities_nearby" (',
    'CREATE OR REPLACE FUNCTION\n  public.search_facilities_nearby\n(',
    'CREATE FUNCTION public.search_facilities_nearby(',
  ])('%j を定義として拾う', (text) => {
    expect(DEFINITION_RE.test(text)).toBe(true);
  });

  it.each([
    'ALTER FUNCTION public.search_facilities_nearby(double precision) SET search_path = public',
    'GRANT EXECUTE ON FUNCTION search_facilities_nearby(',
    'CREATE OR REPLACE FUNCTION search_facilities_nearby_v2(',
  ])('%j は定義として拾わない', (text) => {
    expect(DEFINITION_RE.test(text)).toBe(false);
  });
});

describe('GPS 検索のキーワード照合が NULL 安全', () => {
  const sql = latestSearchRpcMigration();
  const block = keywordBlock(sql);

  it('照合ブロックを抽出できている（空振り防止）', () => {
    expect(block).toContain('regexp_split_to_array');
    // 照合対象は 6 列
    expect((block.match(/ILIKE/g) || []).length).toBe(6);
  });

  it('ILIKE の左辺がすべて COALESCE で包まれている', () => {
    // NULL のまま比較すると OR 連鎖が NULL になり、NOT EXISTS が誤って真になる。
    const operands = leftOperands(block);
    expect(operands).toHaveLength(6);
    expect(operands.filter((o) => !o.startsWith('COALESCE('))).toEqual([]);
  });

  it('検出そのものが機能する（負の対照）', () => {
    const bad = "      v.name ILIKE '%' || term || '%'\n      OR v.city ILIKE '%' || term || '%'";
    const operands = leftOperands(bad);
    expect(operands).toEqual(['v.name', 'v.city']);
    expect(operands.filter((o) => !o.startsWith('COALESCE('))).toEqual(['v.name', 'v.city']);
  });

  it('全角スペースも区切りに含めている（PostgreSQL の \\s は U+3000 を含まない）', () => {
    expect(block).toContain('　');
  });
});
