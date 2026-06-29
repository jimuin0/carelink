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
  | 'arrived'
  | 'completed'
  | 'cancelled'
  | 'cancel_fee_paid'
  | 'no_show';

export type StatusHue = 'amber' | 'sky' | 'emerald' | 'gray' | 'red' | 'orange';

/** canon ラベル（フル表記に統一） */
export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  pending: '確認待ち',
  confirmed: '確定',
  arrived: '受付',
  completed: '完了',
  cancelled: 'キャンセル',
  cancel_fee_paid: 'キャンセル料支払済',
  no_show: '無断キャンセル',
};

/**
 * 予約ステータスの正準集合（全7値・bookings.status の DB CHECK 制約と一致）。
 *
 * 「有効な status の全一覧」が必要な箇所（Booking 型・一覧フィルタ・公開 API のフィルタ検証）は
 * 必ずここを参照する。以前は同じ集合が types/index.ts（5値）・admin/bookings（6値）・
 * BookingsSearchForm（5値）・api/v1/bookings（4値）と各所で別々にハードコードされ、arrived /
 * cancel_fee_paid / no_show が箇所ごとに欠落するドリフトが発生していた（一覧で特定状態を絞り込め
 * ない・公開 API が有効な status を 400 で拒否する等）。canon ラベル（Record<BookingStatus> で
 * 全キーをコンパイラが強制）のキーから導出することで、値集合の重複定義とドリフトを構造的に無くす。
 */
export const BOOKING_STATUSES = Object.keys(BOOKING_STATUS_LABEL) as BookingStatus[];

/** canon 色相。confirmed=sky は顧客予約画面（BookingFlow）と同じ青に統一。arrived=emerald は
 *  来店中を確定(sky)・完了(gray)と視覚的に区別する。 */
export const BOOKING_STATUS_HUE: Record<BookingStatus, StatusHue> = {
  pending: 'amber',
  confirmed: 'sky',
  arrived: 'emerald',
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
  emerald: 'bg-emerald-100 text-emerald-800 border border-emerald-300',
  gray: 'bg-gray-100 text-gray-700 border border-gray-300',
  red: 'bg-red-100 text-red-800 border border-red-300',
  orange: 'bg-orange-100 text-orange-800 border border-orange-300',
};

/** ガント枠線チップ（schedule のスタッフ×時間軸） */
const GANTT_CLASS: Record<StatusHue, string> = {
  amber: 'bg-amber-100 border-amber-400 text-amber-900',
  sky: 'bg-sky-100 border-sky-400 text-sky-900',
  emerald: 'bg-emerald-100 border-emerald-400 text-emerald-900',
  gray: 'bg-gray-200 border-gray-400 text-gray-700',
  red: 'bg-red-100 border-red-400 text-red-800',
  orange: 'bg-orange-100 border-orange-400 text-orange-900',
};

/** ガント塗りつぶし白文字（calendar の月表示チップ） */
const SOLID_CLASS: Record<StatusHue, string> = {
  amber: 'bg-amber-400 text-white',
  sky: 'bg-sky-500 text-white',
  emerald: 'bg-emerald-500 text-white',
  gray: 'bg-gray-300 text-gray-600',
  red: 'bg-red-400 text-white',
  orange: 'bg-orange-400 text-white',
};

/** 大バナー（予約詳細のステータス見出し）。text と bg を分離 */
const BANNER_CLASS: Record<StatusHue, { text: string; bg: string }> = {
  amber: { text: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' },
  sky: { text: 'text-sky-700', bg: 'bg-sky-50 border-sky-200' },
  emerald: { text: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' },
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

/**
 * ステータス遷移マシンの単一 source of truth（UI / API 共有）。
 *
 * ここを唯一の真実とし、API（/api/admin/booking-status）の遷移可否検証と、
 * 管理画面の予約詳細のステータス変更ボタン表示の両方が参照する。以前は API 側だけが
 * この遷移表を持ち、UI は全ステータスをボタン化して「押させてから API で 400 を返す」
 * 設計だった。その結果：
 *   - cancel_fee_paid（Stripe webhook 専用の金銭由来状態）は validStatuses に無く常に 400
 *   - pending（どの状態からも遷移先に無い）も常に 400
 * という「どの予約でも 100% 失敗する死にボタン」が UI に出ていた。さらに completed 予約で
 * 「キャンセル」を押す等、状態依存で無効な操作も押せてしまっていた。本表を共有し、現在状態から
 * 到達可能なステータスだけをボタン化することで、UI と API の遷移ルール不整合を恒久的に無くす。
 *
 * 設計意図（route.ts から移設）:
 *   - cancelled → confirmed（キャンセル済の再アクティベートで顧客に再請求）を防ぐ
 *   - completed → confirmed（完了ポイントの再付与）を防ぐ
 *   - arrived（受付＝来店中）は confirmed と completed の中間。受付スキップ（confirmed→completed）も許可。
 *   - completed → no_show は誤完了の訂正のみ許可。no_show → cancelled も訂正用に許可。
 */
export const ALLOWED_STATUS_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['arrived', 'completed', 'cancelled', 'no_show'],
  arrived: ['completed', 'cancelled', 'no_show'],
  completed: ['no_show'],
  cancelled: [],
  cancel_fee_paid: [], // 終端（webhook 専用の到達状態。ここから手動遷移は無い）
  no_show: ['cancelled'],
};

/** 現在のステータスから手動で遷移可能なステータス一覧（未知値は空配列）。 */
export function getAllowedStatusTransitions(status: string): BookingStatus[] {
  return ALLOWED_STATUS_TRANSITIONS[status as BookingStatus] ?? [];
}
