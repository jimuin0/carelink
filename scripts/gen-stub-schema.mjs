#!/usr/bin/env node
/**
 * 指定テーブルの CREATE TABLE 文を【本番と同じ列型で】生成して標準出力へ出す。
 *
 * 用途: `scripts/diagnose-*.sql`（本番の Dashboard に貼る調査用 SQL）を、本番へ貼る前に
 * 使い捨ての Postgres で実行して検証するためのスタブを作る。
 *
 *   node scripts/gen-stub-schema.mjs audit_logs facility_menus | psql -d scratch
 *   psql -d scratch -v ON_ERROR_STOP=1 -f scripts/diagnose-clobbered-images.sql
 *
 * 🔴 【なぜ「実型」でなければならないか＝実際に踏んだ事故】
 * 2026年8月11日、検証用スタブを【全列 text】で作って diagnose-clobbered-images.sql を通し、
 * 「実行検証済み」として本番へ渡した。本番では
 *   ERROR: 42883 operator does not exist: text = uuid   (a.record_id = m.id)
 * で落ちた。`audit_logs.record_id` は TEXT だが `facility_menus.id` は UUID であり、
 * 全列 text のスタブでは【この不一致が原理的に発生しない】。
 * `database.types.ts` も両方 `string` として出すため型では区別できない（CLAUDE.md 既知の罠）。
 * 型の正は `src/lib/schema-fingerprint.expected.json`（migration 群から機械生成）だけなので、
 * スタブは必ずそこから引く。
 *
 * 【制約】列と型だけを再現する。制約・FK・インデックス・RLS・トリガは再現しない
 * （SELECT 専用の調査 SQL を型検査するのが目的で、意味論の再現は目的ではない）。
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FINGERPRINT = join(ROOT, 'src/lib/schema-fingerprint.expected.json');

/**
 * フィンガープリントの `column|<table>.<column>|<type>|notnull=…|default=…|generated=…` 行から
 * { table: [[column, type], …] } を作る。
 */
export function parseColumns(lines) {
  const byTable = new Map();
  for (const line of lines) {
    if (typeof line !== 'string' || !line.startsWith('column|')) continue;
    const parts = line.split('|');
    // parts = ['column', '<table>.<column>', '<type>', …]
    const qualified = parts[1];
    const type = parts[2];
    const dot = qualified.indexOf('.');
    if (dot < 0 || !type) continue;
    const table = qualified.slice(0, dot);
    const column = qualified.slice(dot + 1);
    if (!byTable.has(table)) byTable.set(table, []);
    byTable.get(table).push([column, type]);
  }
  return byTable;
}

/**
 * 拡張(postgis)が入っていない使い捨て DB でも通るように、拡張が所有する型だけ text に落とす。
 * 型の忠実さが要るのは【調査 SQL が比較・結合に使う列】であって、これらの列ではない
 * （geography/geometry を診断 SQL で比較することはない）。落としたことは SQL コメントで見えるようにする。
 */
const EXTENSION_TYPE_RE = /^public\.(geography|geometry)\b/;

/** テーブル1本ぶんの CREATE TABLE 文。 */
export function buildCreateTable(table, columns) {
  // 置換の注記は列定義の【前の行】に置く。行末に書くと join(',\n') のカンマが
  // コメントに飲まれて次の列定義が構文エラーになる（実際に踏んだ）。
  const defs = columns.map(([c, t]) =>
    EXTENSION_TYPE_RE.test(t)
      ? `  -- 元の型: ${t}（拡張型のためスタブでは text に置換）\n  "${c}" text`
      : `  "${c}" ${t}`
  );
  return `CREATE TABLE "${table}" (\n${defs.join(',\n')}\n);`;
}

export function generate(lines, tables) {
  const byTable = parseColumns(lines);
  const missing = tables.filter((t) => !byTable.has(t));
  if (missing.length) {
    throw new Error(`unknown table(s) in fingerprint: ${missing.join(', ')}`);
  }
  return tables.map((t) => buildCreateTable(t, byTable.get(t))).join('\n\n');
}

// CLI として呼ばれたときだけ実行する（テストからは import して純関数を検証する）。
if (process.argv[1] && process.argv[1].endsWith('gen-stub-schema.mjs')) {
  const tables = process.argv.slice(2);
  if (tables.length === 0) {
    process.stderr.write('usage: node scripts/gen-stub-schema.mjs <table> [<table> …]\n');
    process.exit(2);
  }
  const lines = JSON.parse(readFileSync(FINGERPRINT, 'utf8'));
  process.stdout.write(generate(lines, tables) + '\n');
}
