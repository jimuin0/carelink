/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * `scripts/diagnose-*.sql`（本番を調べるための SELECT 専用ランブック）が
 * 実在しないテーブル・列を参照していないことを機械で固定する（2026年8月11日 新設）。
 *
 * 【なぜ必要か】CLAUDE.md「既知の罠」の筆頭が【存在しないテーブル名・列名を参照して
 * 無音停止する事故】で、実際に `menus`→`facility_menus`、`reviews`→`facility_reviews` 等で
 * 繰り返し起きている。`tsc` は Supabase クライアントに型が配線されていないため検知できず、
 * SQL に至っては型検査そのものが無い。本番の SQL Editor に貼って初めて
 * `column "xxx" does not exist` で気づく＝調査の現場で詰まる。
 *
 * schema-snapshot.json（実在テーブル／列の正）と突合して、貼る前に落とす。
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { STOCK_IMAGE_DOMAINS } from '@/lib/stock-image-guard';

const ROOT = process.cwd();
const SCRIPTS = join(ROOT, 'scripts');
const snapshot: Record<string, string[]> = JSON.parse(
  readFileSync(join(ROOT, 'src/lib/schema-snapshot.json'), 'utf8')
);

const diagnosticFiles = readdirSync(SCRIPTS).filter(
  (f) => f.startsWith('diagnose-') && f.endsWith('.sql')
);

/** `-- @check <table>.<column>` 宣言を集める。 */
function declaredColumns(sql: string): Array<[string, string]> {
  return [...sql.matchAll(/^--\s*@check\s+([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\s*$/gm)].map(
    (m) => [m[1], m[2]] as [string, string]
  );
}

describe('診断用 SQL が実在する列だけを参照している', () => {
  it('diagnose-*.sql が存在する（走査対象ゼロを緑にしない）', () => {
    expect(diagnosticFiles.length).toBeGreaterThanOrEqual(2);
  });

  it.each(diagnosticFiles)('%s: @check 宣言の列がすべて schema-snapshot に実在する', (file) => {
    const sql = readFileSync(join(SCRIPTS, file), 'utf8');
    const declared = declaredColumns(sql);
    expect(declared.length).toBeGreaterThan(0);

    const missing = declared
      .filter(([t, c]) => !snapshot[t]?.includes(c))
      .map(([t, c]) => `${t}.${c}`);
    expect(missing).toEqual([]);
  });

  /**
   * 宣言と本文のズレを塞ぐ。UNION ALL を足したのに @check を書き忘れると、宣言側の検査は
   * 緑のまま本文だけが腐る（＝この検査が無いと上のテストは飾りになる）。
   */
  it('diagnose-stock-images.sql の本文で使う (table, column) が全て @check 宣言済み', () => {
    const sql = readFileSync(join(SCRIPTS, 'diagnose-stock-images.sql'), 'utf8');
    const declared = new Set(declaredColumns(sql).map(([t, c]) => `${t}.${c}`));

    // 本文の各枝は `SELECT '<table>' t, '<column>' c, …` / `SELECT '<table>', '<column>', …` の形。
    const used = [...sql.matchAll(/'([a-z_][a-z0-9_]*)'\s*t?,\s*'([a-z_][a-z0-9_]*)'\s*c?,/g)].map(
      (m) => `${m[1]}.${m[2]}`
    );
    expect(used.length).toBeGreaterThanOrEqual(24);
    expect(used.filter((u) => !declared.has(u))).toEqual([]);
  });
});

/**
 * SQL 側のドメイン列挙は `STOCK_IMAGE_DOMAINS` の手写しなので、片方だけ増えると
 * 「アプリは拒否するのに棚卸しでは見つからない」ドメインが生まれる。集合一致で固定する。
 */
describe('診断 SQL のストックドメインが SSOT と一致する', () => {
  const sql = readFileSync(join(SCRIPTS, 'diagnose-stock-images.sql'), 'utf8');
  const patternLine = sql.split('\n').find((l) => l.includes('::text AS re'));

  it('パターン行が見つかる（抽出の負の対照）', () => {
    expect(patternLine).toBeDefined();
  });

  it('SQL のドメイン集合が STOCK_IMAGE_DOMAINS と完全一致する', () => {
    const inSql = [...(patternLine as string).matchAll(/([a-z0-9-]+(?:\\\.[a-z0-9-]+)+)/g)].map(
      (m) => m[1].replace(/\\/g, '')
    );
    expect(inSql.length).toBe(STOCK_IMAGE_DOMAINS.length);
    expect(new Set(inSql)).toEqual(new Set(STOCK_IMAGE_DOMAINS));
  });
});
