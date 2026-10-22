import { dayLabels, dayOrder } from './constants';

/**
 * /admin/settings の「営業時間」欄の入力と検査（2026年10月23日）。
 *
 * 🔴 既定値で埋めない。以前は新しい店舗の全曜日に 09:00〜19:00 を入れて見せ、チェック1つで
 * その既定値が確定した（スタッフの勤務時間の下書きもそこから作られる）。店舗ごとに営業時間は違うので、
 * 黙った既定値は事実ではない（神原さん決定 2026年10月22日）。未入力は空欄のまま見せる。
 *
 * 🔴 入力した営業時間を黙って捨てない。以前は「確認」のチェックを入れない限り営業時間は保存内容から
 * 外され、それでも「施設情報を保存しました」と出ていた。営業時間を触ったら、それを確認とみなして保存し、
 * 保存できない入力（空欄・前後逆）なら保存全体を止めて理由を示す。
 */

export interface HoursWindow { open: string; close: string }
export type HoursDraft = Record<string, HoursWindow>;
export type SavedBusinessHours = Record<string, HoursWindow | null>;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const BLANK: HoursWindow = { open: '', close: '' };

function savedWindow(value: unknown): HoursWindow {
  if (!value || typeof value !== 'object') return { ...BLANK };
  const { open, close } = value as Record<string, unknown>;
  return {
    open: typeof open === 'string' ? open.slice(0, 5) : '',
    close: typeof close === 'string' ? close.slice(0, 5) : '',
  };
}

/** 保存済みの営業時間から入力欄の初期値を作る。保存されていない曜日は空欄（休みとも決めつけない）。 */
export function initialHoursForm(saved: unknown): { hours: HoursDraft; closedDays: string[] } {
  const record = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved as Record<string, unknown> : {};
  const hours: HoursDraft = {};
  const closedDays: string[] = [];
  for (const day of dayOrder) {
    const has = Object.prototype.hasOwnProperty.call(record, day);
    if (has && record[day] === null) closedDays.push(day);
    hours[day] = has ? savedWindow(record[day]) : { ...BLANK };
  }
  return { hours, closedDays };
}

export type HoursValidation = { ok: true; value: SavedBusinessHours } | { ok: false; message: string };

/** 保存できる7曜日の営業時間にする。1曜日でも欠け・前後逆があれば保存させない。 */
export function validateHoursForm(hours: HoursDraft, closedDays: readonly string[]): HoursValidation {
  const value: SavedBusinessHours = {};
  let openDays = 0;
  for (const day of dayOrder) {
    if (closedDays.includes(day)) { value[day] = null; continue; }
    const window = hours[day] ?? BLANK;
    if (!TIME.test(window.open) || !TIME.test(window.close)) {
      return { ok: false, message: `${dayLabels[day]}曜日の開店・閉店時間を入力してください（休みの曜日は「営業」のチェックを外してください）` };
    }
    if (window.close <= window.open) {
      return { ok: false, message: `${dayLabels[day]}曜日の閉店時間は開店時間より後にしてください` };
    }
    value[day] = { open: window.open, close: window.close };
    openDays++;
  }
  if (openDays === 0) return { ok: false, message: '営業する曜日を1日以上入力してください' };
  return { ok: true, value };
}

/**
 * 最初に時間を入れた営業日の時間を、他の営業日へ写す（7曜日を1つずつ入力する手間を省く）。
 * 写す元が無ければ null。
 */
export function copyFirstHoursToOpenDays(hours: HoursDraft, closedDays: readonly string[]): HoursDraft | null {
  const source = dayOrder.find(day => {
    const window = hours[day] ?? BLANK;
    return !closedDays.includes(day) && TIME.test(window.open) && TIME.test(window.close);
  });
  if (!source) return null;
  const next: HoursDraft = { ...hours };
  for (const day of dayOrder) {
    if (!closedDays.includes(day)) next[day] = { ...hours[source] };
  }
  return next;
}
