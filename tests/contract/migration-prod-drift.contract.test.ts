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
 * 列レベルドリフトの既知例外（`table.column`）。
 * migration が列を定義しているが database.types.ts に現れない正当ケースのみをここへ。
 * 例: パーサが拾えない特殊DDL・後続migrationで実質無効化された列・prod introspection に
 * 出ない種別の列。新規追加は「型再生成漏れの先送り」になり得るため原則禁止（理由必須）。
 * 2026年6月22日 初版＝空（列ドリフト 0）。
 */
const KNOWN_COLUMN_DRIFT: ReadonlySet<string> = new Set([]);

/**
 * 本番(types)に実在するが migration が定義しない「migration-less 残存列」（`table.column`）。
 * テーブル単位の KNOWN_PROD_ONLY と同趣旨の列版。本番へ out-of-band 追加され、
 * repo の migration では fresh-apply（supabase start）で再現できない列。これを許可リスト化し、
 * 「新たに増えた migration-less 列」（手動 prod 列追加 or migration 追補漏れ）を発症前検知する。
 *
 * ★ このリストは「本番一致の冪等 migration を追補して空にする」のが最終目標（列ドリフト 0）。
 *   新規追加は本番適用先送りの明示宣言であり原則禁止（理由必須）。
 *
 * 2026年6月29日 初版＝52列。2026-06-02 の本番 catch-up apply 以前から本番に存在する
 *   旧世代の列群（database.types.ts は prod introspection 生成のため本番実態を反映＝正、
 *   migration 側が追いついていない）。bookings.source/payjp_charge_id は #296 で追補済みのため
 *   本リストには含めない。各列の本番 DDL を取得し冪等 ADD COLUMN を追補して順次削除する。
 */
const KNOWN_PROD_ONLY_COLUMNS: ReadonlySet<string> = new Set([
  'blog_posts.author_name_id',
  'blog_posts.category',
  'blog_posts.coupon_id',
  'blog_posts.image_urls',
  'blog_posts.scheduled_at',
  'coupons.duration_minutes',
  'coupons.image_submission',
  'coupons.image_url',
  'coupons.presentation_timing',
  'coupons.search_category1',
  'coupons.search_category2',
  'coupons.usage_condition',
  'facility_menus.is_published',
  'facility_menus.photo_url',
  'facility_menus.price_ask',
  'facility_menus.price_show_tilde',
  'facility_menus.reservable',
  'facility_menus.search_category',
  'facility_menus.subcategory',
  'facility_photos.coupon_id',
  'facility_photos.genre',
  'facility_photos.image_submission',
  'facility_photos.is_published',
  'facility_photos.search_category',
  'facility_photos.title',
  'facility_profiles.business_hours_text',
  'facility_profiles.design_color',
  'facility_profiles.design_template',
  'facility_profiles.directions',
  'facility_profiles.equipment',
  'facility_profiles.genres',
  'facility_profiles.header_photo_url',
  'facility_profiles.logo_url',
  'facility_profiles.menu_remarks',
  'facility_profiles.owner_message',
  'facility_profiles.owner_name',
  'facility_profiles.owner_photo_url',
  'facility_profiles.owner_title',
  'facility_profiles.parking_text',
  'facility_profiles.payment_other',
  'facility_profiles.remarks',
  'facility_profiles.staff_breakdown',
  'facility_reviews.booking_id',
  'facility_reviews.is_pickup',
  'facility_reviews.replied_at',
  'facility_reviews.reply',
  'facility_reviews.staff_id',
  'facility_reviews.visit_date',
  'review_helpful.id',
  'staff_profiles.nomination_fee',
  'webhook_retry_queue.claimed_at',
  'webhook_retry_queue.delivered_at',
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

/**
 * migration が定義する「テーブル→列名集合」。CREATE TABLE の列＋ALTER ADD COLUMN を加え、
 * DROP COLUMN / RENAME COLUMN を反映する。ファイル名昇順で処理して後続migrationの削除/改名を尊重。
 * 制約行（CONSTRAINT/PRIMARY/FOREIGN/UNIQUE/CHECK/EXCLUDE/LIKE）は列ではないため除外。
 */
function migrationDefinedColumns(): Map<string, Set<string>> {
  const cols = new Map<string, Set<string>>();
  const add = (table: string, col: string) => {
    if (!cols.has(table)) cols.set(table, new Set());
    cols.get(table)!.add(col);
  };
  const drop = (table: string, col: string) => { cols.get(table)?.delete(col); };
  const CONSTRAINT_KW = /^(constraint|primary|foreign|unique|check|exclude|like)\b/i;
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');

    // CREATE TABLE [IF NOT EXISTS] [public.]<name> ( ... ) — 括弧バランスで本体抽出
    const createRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi;
    let cm: RegExpExecArray | null;
    while ((cm = createRe.exec(sql)) !== null) {
      const table = cm[1];
      let depth = 1, rawBody = '';
      for (let i = createRe.lastIndex; i < sql.length && depth > 0; i++) {
        const ch = sql[i];
        if (ch === '(') depth++;
        else if (ch === ')') { depth--; if (depth === 0) break; }
        rawBody += ch;
      }
      // コメント（-- 行末 / ブロック）を除去。これらに含まれるカンマで列分割が壊れるのを防ぐ。
      const body = rawBody.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
      // トップレベルのカンマで列定義に分割。NUMERIC(2,1)/CHECK(...) のネスト括弧と、
      // DEFAULT '{"a":0,"b":0}' 等の単一引用符文字列内のカンマを分割境界にしない。
      const parts: string[] = [];
      let buf = '', d = 0, inStr = false;
      for (const ch of body) {
        if (ch === "'") inStr = !inStr;
        else if (!inStr && ch === '(') d++;
        else if (!inStr && ch === ')') d--;
        if (!inStr && ch === ',' && d === 0) { parts.push(buf); buf = ''; } else buf += ch;
      }
      if (buf.trim()) parts.push(buf);
      for (const part of parts) {
        const t = part.trim();
        if (!t || CONSTRAINT_KW.test(t)) continue;
        const nameM = /^"?([a-z_][a-z0-9_]*)"?/i.exec(t);
        if (nameM) add(table, nameM[1].toLowerCase());
      }
    }

    // ALTER TABLE <table> <...statement...>; を1文ごとに捕捉し、文内の
    // ADD/DROP/RENAME COLUMN を全て反映する。
    // ★ 旧実装は「ALTER TABLE 直後の1列」しか拾えず、1文で複数列を扱う
    //   「ALTER TABLE x ADD COLUMN a, ADD COLUMN b」形式の2列目以降を取りこぼしていた
    //   （例: 20260324000001 の profiles.is_platform_admin が未捕捉＝逆方向検査で偽陽性化）。
    //   コメント中の "ADD COLUMN" や ";" に惑わされないよう、コメント除去後の文字列で走査する。
    const stripped = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const alterRe = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?([a-z_][a-z0-9_]*)([\s\S]*?);/gi;
    let alt: RegExpExecArray | null;
    while ((alt = alterRe.exec(stripped)) !== null) {
      const table = alt[1];
      const stmt = alt[2];
      let x: RegExpExecArray | null;
      const addColRe = /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?/gi;
      while ((x = addColRe.exec(stmt)) !== null) add(table, x[1].toLowerCase());
      const dropColRe = /DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?/gi;
      while ((x = dropColRe.exec(stmt)) !== null) drop(table, x[1].toLowerCase());
      const renColRe = /RENAME\s+COLUMN\s+"?([a-z_][a-z0-9_]*)"?\s+TO\s+"?([a-z_][a-z0-9_]*)"?/gi;
      while ((x = renColRe.exec(stmt)) !== null) { drop(table, x[1].toLowerCase()); add(table, x[2].toLowerCase()); }
    }
  }
  return cols;
}

/** database.types.ts の各テーブル Row セクションの列名集合（本番に実在する列＝introspection 生成）。 */
function prodColumnsFromTypes(): Map<string, Set<string>> {
  const src = readFileSync(TYPES_FILE, 'utf8');
  const lines = src.split('\n');
  const out = new Map<string, Set<string>>();
  let cur: string | null = null;
  let inRow = false;
  for (const line of lines) {
    const t = /^ {6}([a-z_][a-z0-9_]*): \{$/.exec(line);
    if (t && !inRow) { cur = t[1]; continue; }
    if (cur && /^ {8}Row: \{$/.test(line)) { inRow = true; out.set(cur, new Set()); continue; }
    if (inRow) {
      if (/^ {8}\}/.test(line)) { inRow = false; cur = null; continue; }
      const c = /^ {10}([a-z_][a-z0-9_]*)\??: /.exec(line);
      if (c && cur) out.get(cur)!.add(c[1].toLowerCase());
    }
  }
  return out;
}

describe('migration ↔ prod スキーマ ドリフト台帳', () => {
  const migrationTables = migrationDefinedTables();
  const prodTables = prodTablesFromTypes();
  const migrationRpcFunctions = migrationDefinedRpcFunctions();
  const prodFunctions = prodFunctionsFromTypes();
  const migrationColumns = migrationDefinedColumns();
  const prodColumns = prodColumnsFromTypes();

  test('パース健全性: 両ソースから十分なテーブル数を取得できている', () => {
    // 正規表現破綻による空集合での誤 PASS を防ぐサニティチェック。
    expect(migrationTables.size).toBeGreaterThan(50);
    expect(prodTables.size).toBeGreaterThan(40);
  });

  test('パース健全性: migration/types から十分な列数を取得できている', () => {
    const totalMig = [...migrationColumns.values()].reduce((s, set) => s + set.size, 0);
    const totalProd = [...prodColumns.values()].reduce((s, set) => s + set.size, 0);
    expect(totalMig).toBeGreaterThan(200);
    expect(totalProd).toBeGreaterThan(200);
  });

  // 列レベルドリフト検知（テーブル/関数名だけの従来ゲートが見逃す穴を塞ぐ）。
  // 背景: 2026年6月22日 監査で facility_profiles の8列が migration/本番に在るのに
  //   database.types.ts へ未反映（cast で tsc を素通り）だった。テーブル単位の従来テストでは
  //   検知できなかったため、列単位の前方ドリフト（migration 列 ⊄ types 列）を恒久検知する。
  test('migration が定義する列は database.types.ts に存在する（列レベル未反映ドリフトの検知）', () => {
    const drift: string[] = [];
    for (const [table, cols] of migrationColumns) {
      if (KNOWN_PROD_ONLY.has(table)) continue;     // migration-less 残存テーブルは table-level テストが担当
      const typeCols = prodColumns.get(table);
      if (!typeCols) continue;                        // types に無いテーブルは未適用ドリフト側で検知
      for (const col of cols) {
        const key = `${table}.${col}`;
        if (!typeCols.has(col) && !KNOWN_COLUMN_DRIFT.has(key)) drift.push(key);
      }
    }
    drift.sort();
    if (drift.length > 0) {
      throw new Error(
        'migration が定義する列が database.types.ts に未反映です（列追加後の型再生成漏れ＝2026年6月22日の8列ドリフトと同型）。\n' +
          '本番から database.types.ts を再生成（or 該当列を追記）し schema-snapshot を再生成してください。\n' +
          '正当な例外のみ KNOWN_COLUMN_DRIFT へ理由付きで追記:\n  ' +
          drift.join('\n  ')
      );
    }
    expect(drift).toEqual([]);
  });

  test('KNOWN_COLUMN_DRIFT は陳腐化していない（反映済みなら削除を促す）', () => {
    const stale = [...KNOWN_COLUMN_DRIFT].filter((key) => {
      const [table, col] = key.split('.');
      return prodColumns.get(table)?.has(col);
    }).sort();
    expect(stale).toEqual([]);
  });

  // 逆方向の列ドリフト検知（本番にあって migration に無い列）。
  // 背景: 2026年6月28日 admin E2E の「Could not find the 'source' column of 'bookings'」調査で、
  //   本番に out-of-band 追加され migration が定義しない列が bookings 以外にも多数あること
  //   （fresh-apply が本番を再現できない）が判明。従来の列検査は前方向（migration⊆types）のみで
  //   この逆方向を見逃していた。本番一致の冪等 migration 追補で順次 KNOWN_PROD_ONLY_COLUMNS を空にする。
  test('本番(types)にあって migration が定義しない列が新たに増えていない（out-of-band 列追加の発症前検知）', () => {
    const drift: string[] = [];
    for (const [table, typeCols] of prodColumns) {
      if (KNOWN_PROD_ONLY.has(table)) continue;       // migration-less 残存テーブルは table-level テストが担当
      const mig = migrationColumns.get(table);
      if (!mig) continue;                              // migration に無いテーブルは未適用/テーブルレベルで検知
      for (const col of typeCols) {
        const key = `${table}.${col}`;
        if (!mig.has(col) && !KNOWN_PROD_ONLY_COLUMNS.has(key)) drift.push(key);
      }
    }
    drift.sort();
    if (drift.length > 0) {
      throw new Error(
        '本番(database.types.ts)に在るが migration が定義しない列を新たに検知しました\n' +
          '（out-of-band 列追加 or migration 追補漏れ＝fresh-apply が本番を再現できない）。\n' +
          '本番に一致する冪等 migration（ALTER TABLE … ADD COLUMN IF NOT EXISTS …）を追加するか、\n' +
          '既知残存なら KNOWN_PROD_ONLY_COLUMNS へ理由付きで追記してください:\n  ' +
          drift.join('\n  ')
      );
    }
    expect(drift).toEqual([]);
  });

  test('KNOWN_PROD_ONLY_COLUMNS は陳腐化していない（migration 追補済みなら削除を促す）', () => {
    const drained = [...KNOWN_PROD_ONLY_COLUMNS].filter((key) => {
      const [table, col] = key.split('.');
      return migrationColumns.get(table)?.has(col);
    }).sort();
    if (drained.length > 0) {
      throw new Error(
        '以下は migration が定義済み（catch-up 完了）です。\n' +
          'KNOWN_PROD_ONLY_COLUMNS から削除して列ドリフト台帳を最新化してください:\n  ' +
          drained.join('\n  ')
      );
    }
    expect(drained).toEqual([]);
  });

  test('KNOWN_PROD_ONLY_COLUMNS の各エントリは types に実在する（綴り誤り/陳腐化の検知）', () => {
    const notInTypes = [...KNOWN_PROD_ONLY_COLUMNS].filter((key) => {
      const [table, col] = key.split('.');
      return !prodColumns.get(table)?.has(col);
    }).sort();
    expect(notInTypes).toEqual([]);
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
