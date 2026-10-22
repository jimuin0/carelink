/**
 * 店舗向けの画面（くすみ系＝globals.css の `.theme-ecru` で描くページ）の判定。
 *
 * ヘッダー（Header.tsx）・フッター（LayoutSwitch.tsx → ShopFooter.tsx）が同じ判定を見る。
 * 判定を各所に直書きすると、ページを足したときに「本文だけ くすみ色・ヘッダーだけ青」の
 * 食い違いが起きる（実際に /register/complete でヘッダーだけ青に戻っていた）。
 *
 * /register/recover は本文がまだ既定の配色なので含めない（ヘッダーだけ色を変えると逆に浮く）。
 */
export const ECRU_SHOP_PATHS: readonly string[] = ['/register', '/register/complete'];

export function isEcruShopPath(pathname: string | null | undefined): boolean {
  return pathname != null && ECRU_SHOP_PATHS.includes(pathname);
}
