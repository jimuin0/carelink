/**
 * 予約ステータスの単一 source of truth。
 *
 * 以前はラベル・色定義がプロジェクト内 13 箇所に散在し、画面ごとに
 * confirmed が緑 / ピンク / sky とバラバラだった。本モジュールに集約し、
 * 全表示箇所がここを参照することで画面間の不整合を恒久的に防ぐ。
 *
 * 純粋モジュール（React 非依存）。メール HTML やラベルのみ必要な箇所からも
 * import できる。色相（hue）と文脈別クラスを分離し、ピル / ガント枠 /
 * ガント塗り / バナーの 4 文脈それぞれに正しい配色を返す。
 *
 * 注意: 文脈別クラスは「完全なリテラル文字列」で定義する（文字列連結で
 * 組み立てない）。Tailwind の content スキャン（tailwind.config.ts に
 * ./src/lib/** を追加済み）がここを走査して purge から守るため。
 */

export type BookingStatus =
  | 'pending'
  | 'confirmed'
  | 'completed'
  | 'cancelled'
  | 'cancel_fee_paid'
  | 'no_show';

export type StatusHue = 'amber' | 'sky' | 'gray' | 'red' | 'orange';

/** canon ラベル（フル表記に統一） */
export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  pending: '確認待ち',
  confirmed: '確定',
  completed: '完了',
  cancelled: 'キャンセル',
  cancel_fee_paid: 'キャンセル料支払済',
  no_show: '無断キャンセル',
};

/** canon 色相。confirmed=sky は顧客予約画面（BookingFlow）と同じ青に統一 */
export const BOOKING_STATUS_HUE: Record<BookingStatus, StatusHue> = {
  pending: 'amber',
  confirmed: 'sky',
  completed: 'gray',
  cancelled: 'red',
  cancel_fee_paid: 'orange',
  no_show: 'red',
};

/** 未知ステータス時のフォールバック色相 */
const FALLBACK_HUE: StatusHue = 'gray';

/** ステータス→表示ラベル（未知値はそのまま返す） */
export function bookingStatusLabel(status: string): string {
  return BOOKING_STATUS_LABEL[status as BookingStatus] ?? status;
}

/** ステータス→色相（未知値は gray） */
export function bookingStatusHue(status: string): StatusHue {
  return BOOKING_STATUS_HUE[status as BookingStatus] ?? FALLBACK_HUE;
}

/** ピル型チップ（一覧・詳細の小バッジ） */
const CHIP_CLASS: Record<StatusHue, string> = {
  amber: 'bg-amber-100 text-amber-800 border border-amber-300',
  sky: 'bg-sky-100 text-sky-800 border border-sky-300',
  gray: 'bg-gray-100 text-gray-700 border border-gray-300',
  red: 'bg-red-100 text-red-800 border border-red-300',
  orange: 'bg-orange-100 text-orange-800 border border-orange-300',
};

/** ガント枠線チップ（schedule のスタッフ×時間軸） */
const GANTT_CLASS: Record<StatusHue, string> = {
  amber: 'bg-amber-100 border-amber-400 text-amber-900',
  sky: 'bg-sky-100 border-sky-400 text-sky-900',
  gray: 'bg-gray-200 border-gray-400 text-gray-700',
  red: 'bg-red-100 border-red-400 text-red-800',
  orange: 'bg-orange-100 border-orange-400 text-orange-900',
};

/** ガント塗りつぶし白文字（calendar の月表示チップ） */
const SOLID_CLASS: Record<StatusHue, string> = {
  amber: 'bg-amber-400 text-white',
  sky: 'bg-sky-500 text-white',
  gray: 'bg-gray-300 text-gray-600',
  red: 'bg-red-400 text-white',
  orange: 'bg-orange-400 text-white',
};

/** 大バナー（予約詳細のステータス見出し）。text と bg を分離 */
const BANNER_CLASS: Record<StatusHue, { text: string; bg: string }> = {
  amber: { text: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' },
  sky: { text: 'text-sky-700', bg: 'bg-sky-50 border-sky-200' },
  gray: { text: 'text-gray-500', bg: 'bg-gray-50 border-gray-200' },
  red: { text: 'text-red-700', bg: 'bg-red-50 border-red-200' },
  orange: { text: 'text-orange-700', bg: 'bg-orange-50 border-orange-200' },
};

/** ピル型チップの Tailwind クラス */
export function statusChipClass(status: string): string {
  return CHIP_CLASS[bookingStatusHue(status)];
}

/** ガント枠線チップの Tailwind クラス */
export function statusGanttClass(status: string): string {
  return GANTT_CLASS[bookingStatusHue(status)];
}

/** ガント塗りつぶしチップの Tailwind クラス */
export function statusSolidClass(status: string): string {
  return SOLID_CLASS[bookingStatusHue(status)];
}

/** 大バナーの Tailwind クラス（text / bg） */
export function statusBannerClass(status: string): { text: string; bg: string } {
  return BANNER_CLASS[bookingStatusHue(status)];
}
