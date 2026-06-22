/**
 * CSV 1セルを安全に文字列化する共有ヘルパ。
 *
 * - 数式インジェクション対策: 先頭が `= + - @ |` の値は `'` を前置して Excel/Sheets が
 *   数式として実行しないようにする（攻撃者が予約フォーム等に `=HYPERLINK(...)` 等を入れても無害化）。
 *   先頭の TAB(\t) / CR(\r) も Excel/Sheets が空白として剥がした上で続く数式を評価するため、
 *   トリガ文字として同様に無害化する（OWASP CSV Injection 準拠）。
 * - RFC4180 クォート: `,` / `"` / 改行(\n,\r) を含む値はダブルクォートで囲み、内部の `"` は `""` に。
 *
 * 顧客名簿エクスポート（CustomersManager）と会計CSV（accounting-export）で共用し、
 * 片方だけエスケープ漏れになる事故を構造的に防ぐ。
 */
export function csvEscape(val: string | number | null | undefined): string {
  const s = String(val ?? '');
  // Prefix formula-trigger characters to prevent CSV injection.
  // 先頭の TAB/CR も Excel/Sheets は空白除去後に続く数式を評価するため対象に含める。
  const safe = /^[=+\-@|\t\r]/.test(s) ? `'${s}` : s;
  if (safe.includes(',') || safe.includes('"') || safe.includes('\n') || safe.includes('\r')) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}
