/**
 * メニュー担当スタッフ制(menu_staff)の単一 source of truth（HPB準拠・2026年7月15日導入）。
 *
 * 【意味論】menu_staff に行が【ある】メニューは、その行に列挙されたスタッフのみ施術可（担当制）。
 * 行が【無い】メニューは全スタッフ対応（後方互換・本番は現状 menu_staff 全0行のため挙動変化ゼロ）。
 * この規約は coupon_menus（#476/#479で導入したクーポン対象メニュー限定）と同型＝行の有無で
 * 「限定」か「無制限」かを切り替える。
 *
 * この関数群は src/components/booking/BookingFlow.tsx（クライアント・指名候補の絞込UI）と
 * src/app/api/booking/route.ts（サーバー・予約成立の最終防御＝権威）の両方から呼ばれる。
 * 二重実装によるドリフト（UIには出ない担当外スタッフが予約できてしまう等）を構造的に防ぐため、
 * 判定ロジックはこの1ファイルにのみ存在する。
 */

export interface MenuStaffRow {
  menu_id: string;
  staff_id: string;
}

/**
 * menu_staff 行配列から menuId -> 担当スタッフID配列 のマップを構築する純関数。
 * キーを持たないメニュー = 行なし = 無制限（全スタッフ対応）。呼び出し側はキーの有無で判定する。
 */
export function buildMenuStaffMap(rows: MenuStaffRow[]): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  rows.forEach((r) => {
    if (!map[r.menu_id]) map[r.menu_id] = [];
    map[r.menu_id].push(r.staff_id);
  });
  return map;
}

/**
 * 指名スタッフ(staffId)が選択中メニュー全てを担当できるか判定する純関数（サーバー・クライアント共用）。
 * 選択中メニューのうち1つでも「担当制(行あり)かつ対象外」があれば false（fail-closed）。
 * 行が無い(無制限)メニューは常に true 扱い。selectedMenuIds が空（メニュー未選択）は判定不要のため true。
 * staffId が null/undefined（おまかせ・指名なし）は判定不要のため true。
 */
export function isStaffCompatibleWithMenus(
  menuStaffMap: Record<string, string[]>,
  selectedMenuIds: string[],
  staffId: string | null | undefined,
): boolean {
  if (!staffId) return true;
  return selectedMenuIds.every((menuId) => {
    const allowed = menuStaffMap[menuId];
    if (!allowed || allowed.length === 0) return true;
    return allowed.includes(staffId);
  });
}

/**
 * 選択中メニューを全て担当できるスタッフのみを候補として絞り込む純関数（予約画面の指名セレクト・
 * 空き状況集計の対象スタッフ絞込の両方で使う）。selectedMenuIds が空（メニュー未選択）の場合は
 * 絞り込まず全員を返す（メニュー選択前に候補が消えるのを防ぐ）。
 */
export function filterEligibleStaff<T extends { id: string }>(
  allStaff: T[],
  menuStaffMap: Record<string, string[]>,
  selectedMenuIds: string[],
): T[] {
  if (selectedMenuIds.length === 0) return allStaff;
  return allStaff.filter((s) => isStaffCompatibleWithMenus(menuStaffMap, selectedMenuIds, s.id));
}
