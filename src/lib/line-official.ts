/**
 * CareLink の LINE 公式アカウント（2026年11月27日 本人決定：店舗用）。
 * 店舗からの相談窓口（LINE 相談・src/lib/line-support-*）として使い、友だち追加の入口は
 * 店舗向けの画面（/register・管理画面のヘルプ）にだけ置く。来院者向けの画面には出さない
 * （来院者用のアカウントは別に用意する。src/__tests__/line-official-shop-only.test.ts が固定）。
 */
export const SHOP_LINE_BASIC_ID = '@549rbbyi';
export const SHOP_LINE_ADD_FRIEND_URL = `https://line.me/R/ti/p/${SHOP_LINE_BASIC_ID}`;
