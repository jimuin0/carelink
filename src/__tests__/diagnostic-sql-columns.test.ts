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

/**
 * 🔴 Supabase の SQL Editor はプロジェクトごとにタブが開くため、【別プロジェクトのタブに
 * 貼ってしまう】事故が繰り返し起きている。
 *   ・2026年8月2日 … soel で実行し「RLS が90本欠落」という存在しない事故を報告しかけた
 *   ・2026年8月12日 … admin-dashboard(uwzzavnxcqgjppnmdtie) で実行し
 *     「relation "audit_logs" does not exist」となった
 * 冒頭コメントに project ref を書くだけでは防げなかった（読まずに貼るため）。
 * SQL 自身が接続先を検査して落ちるようにし、その配線をここで固定する。
 */
describe('診断用 SQL が接続先を自己検査する', () => {
  it.each(diagnosticFiles)('%s: 先頭に接続先ガードがある', (file) => {
    const sql = readFileSync(join(SCRIPTS, file), 'utf8');
    const guard = sql.indexOf('$connguard$');
    expect(guard).toBeGreaterThan(-1);

    // ガードより前に実行可能な文が無いこと（コメントと空行だけ）。
    // 後ろに置くと、間違ったプロジェクトで先頭のクエリだけ走ってしまう。
    const before = sql.slice(0, sql.indexOf('DO $connguard$'));
    const executable = before
      .split('\n')
      .filter((l) => l.trim() && !l.trimStart().startsWith('--'));
    expect(executable).toEqual([]);

    // 目印テーブルは CareLink 固有のものを使う（どのプロジェクトにも在る名前では判別できない）。
    for (const marker of ['facility_profiles', 'facility_menus', 'audit_logs']) {
      expect(sql.slice(guard, sql.indexOf('$connguard$;'))).toContain(marker);
    }
    // 誤爆したときに何をすべきかが読めること
    expect(sql).toContain('xzafxiupbflvgbarrihe');
  });
});

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
 * 🔴 `audit_logs.record_id` は TEXT（どの表の id でも入る汎用列）だが、各表の `id` は UUID。
 * 素で `=` すると本番で `ERROR: 42883 operator does not exist: text = uuid` になる（実際に踏んだ）。
 * `database.types.ts` はどちらも `string` として出すので型検査では防げない。書き方で防ぐ。
 */
describe('診断 SQL の record_id 比較が型キャスト済み', () => {
  it.each(diagnosticFiles)('%s: record_id との比較に ::text がある', (file) => {
    const sql = readFileSync(join(SCRIPTS, file), 'utf8');
    // `record_id = <何か>` / `<何か> = record_id` を拾い、両辺のどちらかに ::text が要る。
    const comparisons = [...sql.matchAll(/^[^-\n]*\brecord_id\s*=\s*([^\n]+)$/gm)].map((m) => m[0]);
    for (const line of comparisons) {
      expect(line).toContain('::text');
    }
  });

  it('検出が空振りしていない（負の対照）', () => {
    const sql = readFileSync(join(SCRIPTS, 'diagnose-clobbered-images.sql'), 'utf8');
    const comparisons = [...sql.matchAll(/^[^-\n]*\brecord_id\s*=\s*([^\n]+)$/gm)];
    expect(comparisons.length).toBeGreaterThanOrEqual(2);
    // キャストを外した文字列は検査に引っかかる形であること
    expect(/^[^-\n]*\brecord_id\s*=\s*([^\n]+)$/m.test('      AND a.record_id = m.id')).toBe(true);
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
