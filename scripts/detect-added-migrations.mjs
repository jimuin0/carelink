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
 * 【検出方式: ステータス列挙 → 木の集合差分（プロパティベース）へ (#575 直後に修正)】
 *   旧実装は `git diff --name-status` を1行ずつ読み、status フィールドが `A`
 *   （新規追加）の行だけを migration として拾っていた。これには実害のある穴がある:
 *   migration ディレクトリの外から `supabase/migrations/` へ **リネームで入ってきた**
 *   ファイル（status=R）や **コピーで入ってきた**ファイル（status=C）は、diff 上では
 *   "A" ではなく "R"/"C" として現れるため、旧ロジックでは一切検出されず、本番への
 *   手動適用が黙って忘れられる。しかも「A/R/C を列挙して拾う」形で直しても、次に
 *   git が生成しうる別のステータス文字（将来の git バージョンや設定次第で増減しうる）
 *   が同じ穴を再び開ける。ステータス文字の列挙は「書いた時点の git の振る舞い」を
 *   固定するだけで、次に増えるものを守らない。
 *
 *   そこで検出を「新規 migration とは何か」という**性質**で定義し直した:
 *     HEAD のツリーに存在し、base のツリーには存在しない migration ファイル。
 *   この定義はファイルがどう HEAD 側に現れたか（add / rename-in / copy-in のいずれか）
 *   を一切問わない。add・rename-in・copy-in は性質上すべて「HEAD にあって base に
 *   ない」を満たすので自動的に拾われ、逆に modify（両方に存在）・delete（base だけに
 *   存在）は性質上すべて自動的に除外される。ステータス文字の分岐が消えるため、
 *   将来 git 側の diff 表現が増えても穴が開かない。
 *
 *   入力は `git diff --name-status` ではなく `git ls-tree -r --name-only <ref> --
 *   supabase/migrations/` の出力（base 側・head 側それぞれ）。集合差分は
 *   `newMigrations()` が計算する。
 *
 * 【scripts/ に置く理由】
 *   jest.config.js の collectCoverageFrom は `src/lib/**` と `src/app/api/**` のみを
 *   対象とし `scripts/**` を含まない（branches=100% ゲート対象外）。検出ロジックを
 *   `src/lib/` に置くと分岐カバレッジ100%が必須になり、CI ワークフロー用の薄い
 *   ヘルパにその負担を強いることになる。既存の `scripts/schema-diff.mjs` と同じ
 *   置き場所に倣う（`src/lib/__tests__/schema-diff-allow.test.ts` が動的 import で
 *   テストする形と同じパターンをここでも使う）。
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
 * `git ls-tree -r --name-only <ref> -- supabase/migrations/` の生テキストから、
 * その ref のツリーに存在する migration ファイルのパス集合を返す（重複排除・ソート済み）。
 *
 * 【path の引用符について（未実行・意図的な仮定）】
 *   git は `core.quotePath`（既定 true）の下で、パスに特殊文字（非ASCII・タブ等）が
 *   含まれると `"..."` 形式でクォート＋エスケープして出力することがある。本プロジェクトの
 *   migration ファイル名は `YYYYMMDDHHMMSS_snake_case.sql` の ASCII のみなので、
 *   通常の運用では起こらない。万一クォートされたパスが渡ってきても、`isMigrationPath`
 *   の `startsWith(MIGRATIONS_DIR_PREFIX)` チェックが `"supabase/migrations/...` の
 *   ような形（先頭にダブルクォートが付く）に一致せず単純に弾かれるだけなので、
 *   誤って migration と認識される事故（false positive）にはならない。シェル的な
 *   アンクォート処理はあえて実装しない（過剰実装・別の攻撃面を増やすだけで、
 *   本ゲートの安全側＝見逃さないより誤検知しないほうを壊しかねない）。
 */
export function migrationsInTree(lsTreeText) {
  if (!lsTreeText) return [];
  const lines = lsTreeText.split('\n');
  const set = new Set();
  for (const rawLine of lines) {
    if (typeof rawLine !== 'string') continue;
    const line = rawLine.replace(/\r$/, '').trim();
    if (line.length === 0) continue;
    if (!isMigrationPath(line)) continue;
    set.add(line);
  }
  return Array.from(set).sort();
}

/**
 * base ツリーに存在せず、HEAD ツリーには存在する migration ファイルを返す
 * （＝「新規に本番へ手動適用が必要な migration」）。
 *
 * ステータス文字（A/R/C/…）を一切見ない集合差分のため、add・rename-in・copy-in の
 * いずれであっても機械的に検出される。逆に「両方に存在＝変更」「base のみ＝削除」は
 * 性質上ここに現れない。
 *
 * 【意図した安全側の挙動: migrations 内リネーム】
 *   `supabase/migrations/old.sql` → `supabase/migrations/renamed.sql` のような
 *   ディレクトリ内リネームでは、`renamed.sql` は base ツリーに存在しないため
 *   「新規」として報告される（`old.sql` 側は削除として扱われ、この関数の対象外）。
 *   既に一度 PR で適用リマインドを経た migration をリネームするのは通常の運用では
 *   起こりにくく稀なケースであり、それを「新規」として再度リマインドしても
 *   過剰通知（安全側）に留まる。日次の schema-drift-check（フィンガープリント方式）
 *   はファイル名ではなくスキーマの実体を見るため、このケースで誤って 🔴 を出すことは
 *   ない。見逃す（under-report）よりリマインドし過ぎる（over-report）ほうが安全という
 *   本ゲートの設計方針に合致する。
 */
export function newMigrations(baseLsTreeText, headLsTreeText) {
  const baseSet = new Set(migrationsInTree(baseLsTreeText));
  const headMigrations = migrationsInTree(headLsTreeText);
  return headMigrations.filter((path) => !baseSet.has(path));
}
