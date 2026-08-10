#!/usr/bin/env node
/**
 * PR（マージ/PR-time gate）で新規追加された migration ファイルを検出する純関数群。
 *
 * 【なぜ要るか】
 *   このプロジェクトは DDL を Supabase SQL editor で手動適用する運用（migration は
 *   auto-apply されない）。migration が merge されたのに本番へ適用し忘れると、
 *   デプロイ済みコードが本番に存在しないスキーマへ黙って依存し続ける。
 *   別途の日次監視（schema-drift-check cron）が最終的に 🔴 で検知するが、それは
 *   最大24時間後。本モジュールは PR 作成/更新の**その瞬間**に「これから本番へ
 *   手動適用が必要な migration」を人に見せるための検出ロジック。
 *
 * 【scripts/ に置く理由】
 *   jest.config.js の collectCoverageFrom は `src/lib/**` と `src/app/api/**` のみを
 *   対象とし `scripts/**` を含まない（branches=100% ゲート対象外）。検出ロジックを
 *   `src/lib/` に置くと分岐カバレッジ100%が必須になり、CI ワークフロー用の薄い
 *   ヘルパにその負担を強いることになる。既存の `scripts/schema-diff.mjs` と同じ
 *   置き場所に倣う（`src/lib/__tests__/schema-diff-allow.test.ts` が動的 import で
 *   テストする形と同じパターンをここでも使う）。
 *
 * 入力は `git diff --name-status <base>...<head>` の生テキスト。
 */

/** migration ディレクトリのプレフィックス（末尾スラッシュ込み）。 */
export const MIGRATIONS_DIR_PREFIX = 'supabase/migrations/';

/**
 * path が「本ゲートの対象となる migration ファイル」か。
 * `supabase/migrations/` 直下の `*.sql` のみを対象とする（ネストしたサブディレクトリ
 * ―― 例: `supabase/migrations/shadow/x.sql` のような将来の構成 ―― は対象外）。
 */
export function isMigrationPath(path) {
  if (typeof path !== 'string' || path.length === 0) return false;
  if (!path.startsWith(MIGRATIONS_DIR_PREFIX)) return false;
  const rest = path.slice(MIGRATIONS_DIR_PREFIX.length);
  if (rest.length === 0) return false;
  if (rest.includes('/')) return false;
  return rest.endsWith('.sql');
}

/**
 * `git diff --name-status` の1行を { status, path } にパースする。
 *   通常:            "A\tsupabase/migrations/x.sql"
 *   リネーム/コピー: "R100\told/path.sql\tnew/path.sql"（末尾フィールドを新パスとして扱う）
 * 解釈できない行は null を返す（空行・ヘッダ等を黙って無視する）。
 */
export function parseNameStatusLine(line) {
  if (typeof line !== 'string') return null;
  const trimmed = line.replace(/\r$/, '');
  if (trimmed.trim().length === 0) return null;
  const parts = trimmed.split('\t');
  if (parts.length < 2) return null;
  const statusField = parts[0].trim();
  if (statusField.length === 0) return null;
  const status = statusField[0];
  const path = parts[parts.length - 1];
  if (!path) return null;
  return { status, path };
}

/**
 * `git diff --name-status` の全文から、**新規追加(status=A)**された migration ファイル
 * のパスだけを抽出する。順序は入力の出現順を保つ。
 *
 * 変更(M)・削除(D)・リネーム(R)・コピー(C) は対象外 ―― 「これから本番へ新規に手動適用
 * する必要がある」ことを示すのは新規追加のみのため（既存 migration の変更は別ガード
 * (`schema-fingerprint` 等)の領分で、本ゲートが重複して騒ぐと誤報になる）。
 */
export function addedMigrations(nameStatusText) {
  if (!nameStatusText) return [];
  const lines = nameStatusText.split('\n');
  const result = [];
  for (const line of lines) {
    const parsed = parseNameStatusLine(line);
    if (!parsed) continue;
    if (parsed.status !== 'A') continue;
    if (!isMigrationPath(parsed.path)) continue;
    result.push(parsed.path);
  }
  return result;
}
