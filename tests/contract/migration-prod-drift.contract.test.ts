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
 *     - profiles に role / is_platform_admin 欠落 → supabase/migrations/20260324_profiles_admin_columns.sql で補完。
 *     - 20260417_nps_surveys / 20260417_reports の date_trunc(..., timestamptz) 部分 index が
 *       非 IMMUTABLE で失敗 → AT TIME ZONE 'UTC' 付与で IMMUTABLE 化（UTC 月/日境界で決定的）。
 *   新規 migration は「本番適用 → 型再生成」をワンセットで完了させること。このリストへの追加は原則禁止。
 */
const KNOWN_PENDING_DEPLOYMENT: ReadonlySet<string> = new Set([]);

/**
 * 本番に実在するが migration を持たない「残存テーブル」。
 * spatial_ref_sys は PostGIS のシステムテーブル（拡張機能が作成）。
 * features / job_postings は現行アプリが利用中だが migration 不在（要追補・別タスク）。
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
  'features',
  'job_postings',
  'facilities',
  'recruits',
  'blog_authors',
  'booking_menus',
  // PR #53 (feat/salon-board) 所有・main 未マージ → マージ時に削除
  'facility_booking_suspensions',
  'facility_daily_capacity',
  'salon_customer_notes',
]);

function migrationDefinedTables(): Set<string> {
  const tables = new Set<string>();
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
  const re = /CREATE TABLE (?:IF NOT EXISTS )?([a-z_][a-z0-9_]*)/gi;
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      tables.add(m[1]);
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

describe('migration ↔ prod スキーマ ドリフト台帳', () => {
  const migrationTables = migrationDefinedTables();
  const prodTables = prodTablesFromTypes();

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
});
