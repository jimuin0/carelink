import { getTodayString } from './validations-booking';

/**
 * 管理画面の日付ユーティリティ（純粋関数・単一ソース）。
 *
 * 「JST の今日」は CareLink 全体で getTodayString（validations-booking）に集約済みのため、
 * ここから委譲して管理画面側の参照先を一本化する。
 * 過去に admin/page.tsx が UTC 独自実装（new Date().toISOString()）で前日を表示する不具合が
 * あった（JST 0:00〜8:59 はサーバ UTC ではまだ前日）。独自実装を禁止しこの関数へ統一する。
 */

/** JST(UTC+9) の今日 YYYY-MM-DD。実装は getTodayString に集約（単一ソース）。 */
export function todayJst(): string {
  return getTodayString();
}

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

/**
 * ページ番号を [1, max(1, totalPages)] にクランプする。
 * ?page=999 等の範囲外を最終ページに丸め、取得0件の偽の空ページ表示を防ぐ。
 * 不正値・未指定は 1。
 */
export function clampPage(rawPage: string | undefined, totalPages: number): number {
  const parsed = parseInt(rawPage ?? '1', 10);
  const page = Number.isNaN(parsed) ? 1 : parsed;
  const max = Math.max(1, totalPages);
  if (page < 1) return 1;
  if (page > max) return max;
  return page;
}

/**
 * YYYY-MM-DD に days 日加算した YYYY-MM-DD を返す。
 * 文字列を UTC 0:00 として解釈し UTC 日付演算するため、実行環境の TZ に依存しない純粋関数。
 */
export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

/**
 * 2つの YYYY-MM-DD の暦日差（toYmd - fromYmd）を整数日で返す。
 * 両者を UTC 0:00 として解釈し**時刻成分を一切混ぜない**ため、TZ に依存しない。
 * 「予約日まであと何日か」を実時刻 Date.now() との差で求めると JST/UTC のズレで
 * 日数が 1 段ずれる（キャンセル料の料率が変わる金銭バグ）。本関数で暦日差に統一する。
 */
export function diffDays(fromYmd: string, toYmd: string): number {
  const from = new Date(`${fromYmd}T00:00:00Z`).getTime();
  const to = new Date(`${toYmd}T00:00:00Z`).getTime();
  return Math.round((to - from) / 86_400_000);
}

/** JST(UTC+9) の現在時刻を構成要素に分解（y, m=0-11, d）。内部用。 */
function jstNowParts(): { y: number; m: number; d: number } {
  const j = new Date(Date.now() + 9 * 3_600_000);
  return { y: j.getUTCFullYear(), m: j.getUTCMonth(), d: j.getUTCDate() };
}

/**
 * JST の「今日 + offsetDays」00:00 を UTC ISO 文字列で返す。
 * created_at 等の UTC タイムスタンプと `>=` 比較する日次境界に使う。
 * サーバ(UTC)で `new Date().getDate()` を使うと JST 0:00〜8:59 帯で前日になり集計が
 * 1 日ズレるため、本関数で JST 暦日の境界に統一する。
 */
export function jstDayStartIso(offsetDays: number): string {
  const { y, m, d } = jstNowParts();
  return new Date(Date.UTC(y, m, d + offsetDays, -9, 0, 0)).toISOString();
}

/**
 * JST の「今月 + offsetMonths」1日 00:00 を UTC ISO 文字列で返す。
 * 月次集計（MAU・月別推移・今月予約数）の境界に使う。サーバ(UTC)で月初を作ると
 * JST 月初の早朝に前月へズレるため、本関数で JST 月境界に統一する。
 */
export function jstMonthStartIso(offsetMonths: number): string {
  const { y, m } = jstNowParts();
  return new Date(Date.UTC(y, m + offsetMonths, 1, -9, 0, 0)).toISOString();
}

/** JST の「今月 + offsetMonths」の year と month(1-12) を返す（グラフ月ラベル用・年跨ぎ対応）。 */
export function jstMonthInfo(offsetMonths: number): { year: number; month: number } {
  const { y, m } = jstNowParts();
  const dt = new Date(Date.UTC(y, m + offsetMonths, 1));
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1 };
}
