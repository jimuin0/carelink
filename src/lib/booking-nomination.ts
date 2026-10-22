/**
 * 予約の「指名」の扱いの単一ソース。
 *
 * おまかせ（指名なし）の予約も、同じスタッフへの二重予約を防ぐため予約 RPC が空いている担当者を
 * 割り当てて bookings.staff_id に保存する（2026年10月22日）。staff_id が入っているだけでは
 * 「お客様が指名した」とは言えないので、bookings.staff_auto_assigned（true＝指名なしで割り当て）で区別する。
 *
 * 区別を落とすと、指名していないお客様の再予約にその担当者が指名として入り指名料がかかる、
 * 店舗の画面で指名とフリーが見分けられない、といった誤りになる。
 */
export type NominationFields = { staff_id: string | null; staff_auto_assigned?: boolean | null };

/** お客様（電話予約なら店舗）がスタッフを指名した予約か。割り当てだけの予約は false。 */
export function isNominatedBooking(booking: NominationFields): boolean {
  return !!booking.staff_id && booking.staff_auto_assigned !== true;
}

/**
 * 「もう一度予約する」の遷移先クエリ。メニューは引き継ぎ、スタッフは指名した予約のときだけ引き継ぐ
 * （予約画面は staff_id を指名として選択し、指名料を加算するため）。
 */
export function rebookSearchParams(booking: NominationFields & { menu_id: string | null }): URLSearchParams {
  const query = new URLSearchParams();
  if (booking.menu_id) query.set('menu_id', booking.menu_id);
  if (isNominatedBooking(booking)) query.set('staff_id', booking.staff_id as string);
  return query;
}

/** 担当欄の表示。担当者が無ければ「指名なし」、割り当てなら「指名なし（担当: 名前）」、指名なら名前。 */
export function bookingStaffLabel(staffName: string | null | undefined, autoAssigned: boolean | null | undefined): string {
  if (!staffName) return '指名なし';
  return autoAssigned === true ? `指名なし（担当: ${staffName}）` : staffName;
}
