import { isBeforeBookingStart } from './cancel-fee';

/**
 * 予約枠の長さと「もう始まった枠か」の規則（2026年10月23日 新設・単一ソース）。
 *
 * 予約画面（BookingFlow）・空き枠 API（/api/slots・/api/slots/week）・予約 API（/api/booking）・
 * 日時変更（/api/booking/[id]/change と変更画面）が同じ式を使う。式がずれると、画面で選べた枠を
 * サーバーが断る（または断るべき枠を通す）ため、ここ以外で計算しないこと。
 *
 * 【なぜ必要か】予約画面でメニューを足しても、先に選んだ枠（旧い終了時刻）が残ったまま予約でき、
 * 120分の内容が 60分の枠で保存されていた（後半の時間が他のお客様に再び売られる）。サーバーも
 * start < end しか見ていなかった。開始時刻を過ぎた当日の枠も、画面を開いたままにすると予約できた。
 */

/** 空き枠 RPC（get_available_slots）が受け付ける所要時間の範囲（分）。 */
export const BOOKING_DURATION_MIN_MINUTES = 15;
export const BOOKING_DURATION_MAX_MINUTES = 480;
/** 所要時間が未設定（null・0）のメニューは 60 分として扱う（予約画面の表示と同じ）。 */
export const MENU_DURATION_FALLBACK_MINUTES = 60;

/** 所要時間を空き枠 RPC の範囲に丸める（数値でなければ 60 分）。 */
export function clampBookingDuration(minutes: number): number {
  if (!Number.isFinite(minutes)) return MENU_DURATION_FALLBACK_MINUTES;
  return Math.min(Math.max(Math.trunc(minutes), BOOKING_DURATION_MIN_MINUTES), BOOKING_DURATION_MAX_MINUTES);
}

/**
 * 選んだメニューの合計所要時間（分）。予約画面が空き枠を取るときの長さと同じ値になる
 * （各メニューの duration_minutes の合計。未設定は 60 分。範囲は 15〜480 分に丸める）。
 */
export function bookingDurationForMenus(menus: readonly { duration_minutes?: number | null }[]): number {
  const total = menus.reduce((sum, m) => sum + (m.duration_minutes || MENU_DURATION_FALLBACK_MINUTES), 0);
  return clampBookingDuration(total);
}

/** "HH:MM" / "HH:MM:SS" を 0 時からの分にする（秒は切り捨て）。読めない値は NaN。 */
export function clockMinutes(time: string): number {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(time);
  if (!match) return Number.NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** 枠の長さ（分）。読めない時刻を含むときは NaN（どの所要時間とも一致しない）。 */
export function slotLengthMinutes(start: string, end: string): number {
  return clockMinutes(end) - clockMinutes(start);
}

/**
 * 日時変更で使う所要時間（分）。予約の今の長さ（start/end の差）を保つ。
 * 長さが読めない・0 以下の予約は 60 分として扱い、空き枠 RPC の範囲に丸める
 * （変更画面が空き枠を取る長さと、変更 API が受け付ける長さを同じにするため）。
 */
export function rescheduleDurationMinutes(start: string, end: string): number {
  const length = slotLengthMinutes(start, end);
  return clampBookingDuration(length > 0 ? length : MENU_DURATION_FALLBACK_MINUTES);
}

/**
 * 枠の開始時刻（JST）を過ぎたか（開始ちょうども過ぎた扱い）。空き枠 API が当日の開始済みの枠を
 * 出さない規則（slot_start > 現在時刻）と同じ。解釈できない日時は過ぎていない扱い＝最終判定は DB。
 */
export function hasSlotStarted(bookingDate: string, startTime: string, nowMs: number): boolean {
  return !isBeforeBookingStart(bookingDate, startTime, nowMs);
}

/** 開始時刻を過ぎた枠を予約・変更しようとしたとき（予約 RPC の BOOKING_SLOT_PASSED と同じ意味）。 */
export const BOOKING_SLOT_PASSED_MESSAGE = '選択した時間はすでに過ぎています。日時を選び直してください。';
/**
 * 枠の長さが、選んだメニューの所要時間（サーバーが DB から読んだ値）と合わないとき。
 * 予約画面は選び直したメニューに合わせて枠を外すので、画面から送った予約でこれが返るのは
 * 「画面を開いている間に店舗がメニューの所要時間を変えた」場合。画面はメニューを読み直してから
 * 日時を選び直してもらう（古い所要時間のまま取り直すと、どの枠を選んでも断られ続けるため）。
 */
export const BOOKING_DURATION_MISMATCH_MESSAGE = 'メニューの内容が更新されたため、選択した時間ではご予約できません。最新の内容で日時を選び直してください。';
/**
 * 指名なし（おまかせ）で、その時間に勤務するスタッフはいるが、誰も選んだメニューを担当できないとき
 * （menu_staff・予約 RPC の BOOKING_NO_CAPABLE_STAFF・migration 20261023180000）。
 * 以前は「この時間帯は既に予約が入っています」と、空いている時間なのに満席と案内していた。
 */
export const NO_CAPABLE_STAFF_MESSAGE = 'この時間に、選択したメニューを担当できるスタッフがいません。別の日時を選ぶか、メニューを選び直してください。';
/** 日時変更で、予約の所要時間と違う長さの時間を指定されたとき。 */
export const RESCHEDULE_DURATION_MISMATCH_MESSAGE = '予約の所要時間と合わない時間は指定できません。表示されている時間から選び直してください。';

/** この応答のあとは、枠を選び直してもらう（日時の選択を外して空き状況を取り直す）。 */
export function needsSlotReselection(error: string | null | undefined): boolean {
  return error === BOOKING_SLOT_PASSED_MESSAGE
    || error === BOOKING_DURATION_MISMATCH_MESSAGE
    || error === RESCHEDULE_DURATION_MISMATCH_MESSAGE;
}
