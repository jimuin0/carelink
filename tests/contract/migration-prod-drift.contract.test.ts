/**
 * @jest-environment node
 *
 * Migration ↔ 本番スキーマ ドリフト恒久ガード（発症前・secret 不要・常時実行）。
 *
 * 背景（事実）:
 *   2026-06-02 に「20260417_* feature wave（42 テーブル）が本番へ一度も適用されていない」
 *   静かなドリフトが発覚した（intake_form_responses / nps_surveys への INSERT が 42P01）。
 *   原因は Dashboard SQL Editor での out-of-band 手動適用と、CI 自動適用の不在（ADR-0005）。
 *
 * このガードの役割:
 *   staging secret に依存する schema-invariants.contract.test.ts は、secret 未設定だと
 *   describe.skip され「42 テーブル丸ごと欠落」のような大規模ドリフトを検知できなかった。
 *   本テストはネットワーク・secret を一切使わず、リポジトリ内の 2 つの事実だけを突き合わせる:
 *     (1) supabase/migrations/*.sql が「存在させるつもり」のテーブル（CREATE TABLE）
 *     (2) src/types/database.types.ts が示す「本番に実在する」テーブル（prod を introspection 生成）
 *   両者の差分が許可リストを超えたら即 FAIL する。CI で常に走るため、
 *   「migration を書いたが本番へ適用し忘れた」ドリフトを発症前（マージ前）に検知する。
 *
 * 運用（ドリフト台帳 = drift ledger）:
 *   - KNOWN_PENDING_DEPLOYMENT: migration には在るが本番へ未適用のテーブル群。
 *     神原さんが本番へ catch-up apply し database.types.ts を再生成するたびに、
 *     反映済みテーブルを本リストから削除する。空になればドリフト 0。
 *     ★ このリストへ新規追加するのは「本番適用を後回しにする」ことの明示宣言であり原則禁止。
 *       新しい migration は本番適用 → 型再生成までをワンセットで完了させること。
 *   - KNOWN_PROD_ONLY: 本番には在るが migration が無い「migration-less 残存テーブル」。
 *     repo から再現不能なオブジェクト。新規に増えたら（手動 prod 作成の兆候）検知する。
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'supabase', 'migrations');
const TYPES_FILE = join(__dirname, '..', '..', 'src', 'types', 'database.types.ts');

/**
 * 本番へ未適用と判明している migration 定義テーブル。
 *
 * 2026-06-03: 旧 43 テーブルを本番（ref: xzafxiupbflvgbarrihe）へ catch-up apply 完了し、
 *   database.types.ts を prod introspection で再生成・反映した（psql で applied_count=43 を実測確認）。
 *   よって本リストは空＝ドリフト 0 の状態。
 *   ※ 適用時に判明し恒久修正した landmine:
 *     - profiles に role / is_platform_admin 欠落 → supabase/migrations/20260324000001_profiles_admin_columns.sql で補完。
 *     - 20260417000023_nps_surveys / 20260417000028_reports の date_trunc(..., timestamptz) 部分 index が
 *       非 IMMUTABLE で失敗 → AT TIME ZONE 'UTC' 付与で IMMUTABLE 化（UTC 月/日境界で決定的）。
 *   新規 migration は「本番適用 → 型再生成」をワンセットで完了させること。このリストへの追加は原則禁止。
 */
const KNOWN_PENDING_DEPLOYMENT: ReadonlySet<string> = new Set([]);

/**
 * 本番に実在するが migration を持たない「残存テーブル」。
 * spatial_ref_sys は PostGIS のシステムテーブル（拡張機能が作成）。
 * features / job_postings は 20260320000002_prod_only_base_tables.sql で migration 追補済み
 *   （fresh-apply 再生可能化）。よって migration-less ではなくなったため本リストから除外。
 * facilities / recruits / blog_authors / booking_menus は旧世代の未使用残存。
 * facility_booking_suspensions / facility_daily_capacity / salon_customer_notes は
 *   PR #53（feat/salon-board）所有のテーブル。当該ブランチに CREATE TABLE migration
 *   （20260602_booking_suspensions / 20260602_daily_capacity / 20260602_customer_notes）と
 *   アプリコードが存在するが、main 未マージのため main 視点では migration-less に見える。
 *   2026-06-03 時点で本番に先行適用済み（各 0 行）。PR #53 が main へマージされたら
 *   migrationTables に含まれるため、本リストの該当 3 行は削除すること（残すと無害だが陳腐化）。
 */
const KNOWN_PROD_ONLY: ReadonlySet<string> = new Set([
  'spatial_ref_sys',
  'facilities',
  'recruits',
  'blog_authors',
  'booking_menus',
  // PR #53 (feat/salon-board) 所有・main 未マージ → マージ時に削除
  'facility_booking_suspensions',
  'facility_daily_capacity',
  'salon_customer_notes',
]);

/**
 * 本番へ未適用と判明している migration 定義 RPC 関数。
 * テーブルの KNOWN_PENDING_DEPLOYMENT と同趣旨で、本番適用先送りの明示宣言（原則禁止）。
 * 2026-06-15 時点で空＝関数ドリフト 0（get_unique_customers [T20] は本番適用済み＝
 * database.types.ts に反映済みのため本リストから除去）。
 */
const KNOWN_PENDING_DEPLOYMENT_FUNCTIONS: ReadonlySet<string> = new Set([
  // 2026-06-21: change_booking_atomic（PR #218）は本番適用済み（Supabase SQL Editor で
  // 20260621000002/20260621000003 を実行・"Success" 確認）＝database.types.ts に反映済みのため
  // 本リストから除去。これで関数ドリフト 0。
]);

function migrationDefinedTables(): Set<string> {
  const tables = new Set<string>();
  // ファイル名昇順＝適用順。CREATE TABLE を add、DROP TABLE を delete として
  // 出現順に「ネット適用」した最終状態が「migration が本番に存在させるつもりのテーブル」。
  // これにより「CREATE したが後の migration で DROP したテーブル」（＝意図的削除）を
  // prod に在るべきとして誤検知しない（DROP を無視すると永久に未適用ドリフト誤報になる）。
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  // CREATE TABLE [IF NOT EXISTS] [public.]x → add / DROP TABLE [IF EXISTS] [public.]x → delete
  const re = /(CREATE|DROP) TABLE (?:IF (?:NOT )?EXISTS )?(?:public\.)?([a-z_][a-z0-9_]*)/gi;
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      if (/^drop$/i.test(m[1])) tables.delete(m[2]);
      else tables.add(m[2]);
    }
  }
  return tables;
}

function prodTablesFromTypes(): Set<string> {
  const src = readFileSync(TYPES_FILE, 'utf8');
  const lines = src.split('\n');
  const tables = new Set<string>();
  let inTables = false;
  for (const line of lines) {
    if (/^ {4}Tables: \{/.test(line)) { inTables = true; continue; }
    if (/^ {4}Views: \{/.test(line)) { inTables = false; continue; }
    if (!inTables) continue;
    // テーブル名キーは 6 スペースインデント（"      name: {"）
    const m = /^ {6}([a-z_][a-z0-9_]*): \{/.exec(line);
    if (m) tables.add(m[1]);
  }
  return tables;
}

/**
 * migration が定義する RPC 関数（= PostgREST 経由で呼べる関数）の名前集合。
 *
 * ★ トリガ関数（RETURNS TRIGGER）は除外する。
 *   トリガ関数は PostgREST に露出しないため database.types.ts の Functions セクションに
 *   一切現れず（実測: prevent_profile_privilege_escalation / update_*_updated_at 等 18 関数は
 *   全て NOT_IN_TYPES）、prod 側の ground truth が repo に存在しない。よって offline 突合の
 *   対象にできない（含めると恒久的に偽陽性になる）。同様に RLS ポリシーも types に現れないため
 *   本台帳の対象外（より深い検証は staging secret を使う schema-invariants.contract.test.ts が担う）。
 *
 * 判定: CREATE [OR REPLACE] FUNCTION <name> ... RETURNS <type> の最初の RETURNS を見て
 *   TRIGGER 以外を RPC 関数とみなす（非貪欲マッチで引数内の括弧付き型にも頑健）。
 */
function migrationDefinedRpcFunctions(): Set<string> {
  const rpc = new Set<string>();
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
  const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-z_][a-z0-9_]*)\b[\s\S]*?\bRETURNS\s+(\w+)/gi;
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      if (!/^trigger$/i.test(m[2])) rpc.add(m[1]);
    }
  }
  return rpc;
}

/**
 * 本番に実在する関数（database.types.ts の Functions セクション = PostgREST 露出関数）。
 * public スキーマだけでなく graphql_public / PostGIS 拡張由来の関数も含むが、
 * 「migration 関数が prod に在るか」の片方向検査では余剰 prod 関数は無害なので許容する。
 * （prod-only 方向は PostGIS 等が数百関数を持ち込みノイズが大きいため対象外）。
 */
function prodFunctionsFromTypes(): Set<string> {
  const src = readFileSync(TYPES_FILE, 'utf8');
  const lines = src.split('\n');
  const fns = new Set<string>();
  let inFns = false;
  for (const line of lines) {
    if (/^ {4}Functions: \{/.test(line)) { inFns = true; continue; }
    if (/^ {4}Enums: \{/.test(line)) { inFns = false; continue; }
    if (!inFns) continue;
    const m = /^ {6}([a-z_][a-z0-9_]*): \{/.exec(line);
    if (m) fns.add(m[1]);
  }
  return fns;
}

describe('migration ↔ prod スキーマ ドリフト台帳', () => {
  const migrationTables = migrationDefinedTables();
  const prodTables = prodTablesFromTypes();
  const migrationRpcFunctions = migrationDefinedRpcFunctions();
  const prodFunctions = prodFunctionsFromTypes();

  test('パース健全性: 両ソースから十分なテーブル数を取得できている', () => {
    // 正規表現破綻による空集合での誤 PASS を防ぐサニティチェック。
    expect(migrationTables.size).toBeGreaterThan(50);
    expect(prodTables.size).toBeGreaterThan(40);
  });

  test('migration が定義するテーブルは本番に存在する（未適用ドリフトの検知）', () => {
    const missing = [...migrationTables]
      .filter((t) => !prodTables.has(t))
      .sort();
    const unexpected = missing.filter((t) => !KNOWN_PENDING_DEPLOYMENT.has(t));

    if (unexpected.length > 0) {
      throw new Error(
        '本番へ未適用の migration 定義テーブルを検知しました（catch-up apply 漏れ）。\n' +
          '本番へ適用し database.types.ts を再生成するか、暫定的に KNOWN_PENDING_DEPLOYMENT へ\n' +
          '追記してください（後者は本番適用先送りの明示宣言・原則禁止）:\n  ' +
          unexpected.join('\n  ')
      );
    }
    expect(unexpected).toEqual([]);
  });

  test('KNOWN_PENDING_DEPLOYMENT は陳腐化していない（適用済みなら削除を促す）', () => {
    // 本番へ適用済みなのに台帳へ残っているテーブルを検知し、台帳の掃除を促す。
    const staleAlreadyDeployed = [...KNOWN_PENDING_DEPLOYMENT]
      .filter((t) => prodTables.has(t))
      .sort();
    if (staleAlreadyDeployed.length > 0) {
      throw new Error(
        '以下は本番へ適用済み（database.types.ts に存在）です。\n' +
          'KNOWN_PENDING_DEPLOYMENT から削除してドリフト台帳を最新化してください:\n  ' +
          staleAlreadyDeployed.join('\n  ')
      );
    }
    expect(staleAlreadyDeployed).toEqual([]);
  });

  test('本番にだけ存在する migration-less テーブルが新たに増えていない（手動 prod 作成の検知）', () => {
    const prodOnly = [...prodTables]
      .filter((t) => !migrationTables.has(t))
      .sort();
    const unexpected = prodOnly.filter((t) => !KNOWN_PROD_ONLY.has(t));

    if (unexpected.length > 0) {
      throw new Error(
        'migration を持たない本番テーブルを新たに検知しました（out-of-band 手動作成の疑い）。\n' +
          '対応する migration を追加するか、既知残存なら KNOWN_PROD_ONLY へ追記してください:\n  ' +
          unexpected.join('\n  ')
      );
    }
    expect(unexpected).toEqual([]);
  });

  test('パース健全性: RPC関数・prod関数を十分な数取得できている', () => {
    // 正規表現破綻による空集合での誤 PASS を防ぐサニティチェック。
    // RPC関数は migration 内に10件前後、prod関数は PostGIS 込みで数百件存在する。
    expect(migrationRpcFunctions.size).toBeGreaterThan(5);
    expect(prodFunctions.size).toBeGreaterThan(20);
  });

  test('migration が定義する RPC 関数は本番に存在する（未適用ドリフトの検知）', () => {
    // テーブル同様、トリガでなく PostgREST 露出する RPC 関数の本番未適用を検知する。
    // 例: 新規 RPC を migration で追加したが本番へ catch-up apply し忘れたケース。
    const missing = [...migrationRpcFunctions]
      .filter((f) => !prodFunctions.has(f))
      .sort();
    const unexpected = missing.filter((f) => !KNOWN_PENDING_DEPLOYMENT_FUNCTIONS.has(f));

    if (unexpected.length > 0) {
      throw new Error(
        '本番へ未適用の migration 定義 RPC 関数を検知しました（catch-up apply 漏れ）。\n' +
          '本番へ適用し database.types.ts を再生成するか、暫定的に\n' +
          'KNOWN_PENDING_DEPLOYMENT_FUNCTIONS へ追記してください（後者は本番適用先送りの明示宣言・原則禁止）:\n  ' +
          unexpected.join('\n  ')
      );
    }
    expect(unexpected).toEqual([]);
  });

  test('KNOWN_PENDING_DEPLOYMENT_FUNCTIONS は陳腐化していない（適用済みなら削除を促す）', () => {
    const staleAlreadyDeployed = [...KNOWN_PENDING_DEPLOYMENT_FUNCTIONS]
      .filter((f) => prodFunctions.has(f))
      .sort();
    if (staleAlreadyDeployed.length > 0) {
      throw new Error(
        '以下は本番へ適用済み（database.types.ts に存在）です。\n' +
          'KNOWN_PENDING_DEPLOYMENT_FUNCTIONS から削除してドリフト台帳を最新化してください:\n  ' +
          staleAlreadyDeployed.join('\n  ')
      );
    }
    expect(staleAlreadyDeployed).toEqual([]);
  });
});
