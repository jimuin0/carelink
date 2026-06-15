/**
 * 日付ユーティリティ（最下層・他の lib に依存しない純粋関数）。
 *
 * admin-date.ts と validations-booking.ts の双方から参照されるため、
 * どちらかに置くと循環依存（admin-date → validations-booking → admin-date）になる。
 * それを避けるため、依存を持たない独立モジュールに切り出して単一ソースとする。
 */

/**
 * YYYY-MM-DD が「形式が正しく、かつ実在する暦日」であれば true。
 * 正規表現は形式しか見ず 2026-02-30 等の不正日を通してしまう（JS の ISO パースは
 * 2026-02-30 を 2026-03-02 に黙ってロールオーバーする）ため、round-trip で実在性を検証する。
 */
export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
