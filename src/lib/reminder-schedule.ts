/**
 * 予約リマインドの送信時刻の単一ソース（2026年10月22日 新設）。
 *
 * 【神原さん決定（2026年10月22日）】リマインドは【1日1回・朝9時（JST）だけ】送る。
 * 以前の booking-reminder cron は毎時起動のたびに対象日を計算して未送信分を送っていたため、
 * 実際の送信は「日付が変わった直後の run（JST 0:05）」になり、深夜にリマインドが届いていた。
 *
 * cron 自体は毎時のまま動かす（cron_logs の鮮度監視＝/api/health と cron-heartbeat が
 * 1 時間間隔を前提にしているため）。送信の計画を立てるのは JST 9 時台の run（09:05）だけで、
 * それ以外の run は送信前 claim の回収と「送達結果不明」の監視だけを行い 'skipped' を記録する。
 *
 * 文面（メール・LINE）に載せる説明もここに置く。時刻と説明が別々の場所にあると、
 * 片方だけ変えたときに「9時に送ると書いてあるのに別の時刻に届く」状態を作るため。
 */

/** リマインドを送る JST の時（0〜23）。 */
export const REMINDER_SEND_HOUR_JST = 9;

/** 与えた時刻の JST における「時」（0〜23）。 */
export function jstHour(now: Date): number {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).getUTCHours();
}

/** この run でリマインドの送信を計画してよいか（JST 9 時台の run だけ true）。 */
export function isReminderSendHour(now: Date): boolean {
  return jstHour(now) === REMINDER_SEND_HOUR_JST;
}

/** リマインドメール（前日・3日前・7日前すべて）に載せる送信基準の説明。 */
export const REMINDER_EMAIL_TIMING_NOTE =
  '本メールは、当日朝9時の時点でご予約いただいているお客様にお送りしています。';

/** LINE リマインドに載せる同じ説明（LINE は短く）。 */
export const REMINDER_LINE_TIMING_NOTE = '※当日朝9時の時点のご予約をもとにお送りしています。';
