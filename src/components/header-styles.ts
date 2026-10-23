/**
 * 2 つのヘッダー（一般の Header.tsx と検索サイト側の search/SearchHeader.tsx）が共有する見た目の単一ソース
 * （デザイン統一フェーズ1・2026年10月23日）。
 *
 * why: LayoutSwitch.tsx がページによってヘッダーを切り替えるため、トップ→お問い合わせ→掲載案内と
 *   移動するだけでロゴが 20px⇄24px、ヘッダーの高さが 56px⇄64px、右側のリンクが 13px の丸ボタン⇄16px の
 *   素の文字と入れ替わっていた（本番の監査で実測）。部品を統合するのは影響範囲が大きいので、
 *   このフェーズでは見た目の値だけをここに寄せ、両方から参照させる。
 *
 * 高さは 56px（h-14）に揃える。施設ページのタブ（facility/TabNavigation.tsx の sticky top-14）が
 * 検索サイト側ヘッダーの 56px を前提にしているため、こちらへ寄せる。
 *
 * ロゴ（<Link href="/">）の className はここに置かず、各ヘッダーに同じ文字列を直書きしている。
 * src/__tests__/ecru-theme-single-source.test.ts がソース上のロゴの class を直接検査するため。
 * 2 つのロゴが同じ文字列であることは src/__tests__/header-consistency.test.ts が固定する。
 *
 * コントラスト（白地）: gray-600 #4B5563 7.56:1 ／ gray-500 #6B7280 4.83:1 ／
 *   hover の --primary #0369A1 は sky-50 #F0F9FF の上で 5.57:1。
 */

/** ヘッダーの行（高さ 56px）。 */
export const HEADER_BAR = 'flex items-center justify-between h-14';

/** デスクトップの主なリンク（丸い面の hover）。 */
export const HEADER_NAV_LINK =
  'text-gray-600 hover:text-primary text-[13px] px-3 py-1.5 rounded-full hover:bg-sky-50 transition-colors whitespace-nowrap';

/** デスクトップの「掲載の案内」。枠付きで主なリンクと区別する。 */
export const HEADER_LISTING_LINK =
  'ml-1 text-primary text-[13px] font-medium px-3 py-1.5 rounded-full border border-sky-200 hover:bg-sky-50 transition-colors whitespace-nowrap';

/** 右端の区切り（店舗ログイン・アカウント）の箱。 */
export const HEADER_ACCOUNT_GROUP = 'ml-2 pl-2 border-l border-gray-200 shrink-0 flex items-center gap-2';

/** 店舗ログイン（一般のお客様には不要な導線なので弱いトーン）。タップ領域は 44px。 */
export const HEADER_STORE_LOGIN_LINK =
  'inline-flex min-h-11 items-center text-gray-500 hover:text-primary text-xs whitespace-nowrap transition-colors';

/** スマホのメニューの各リンク。 */
export const HEADER_MOBILE_LINK =
  'flex min-h-11 items-center text-gray-600 hover:text-primary text-sm px-3 rounded-lg hover:bg-sky-50 transition-colors';

/** スマホのメニューの「掲載の案内」（区切り線の下に置く）。 */
export const HEADER_MOBILE_LISTING_LINK =
  'flex min-h-11 items-center text-primary font-medium text-sm px-3 mt-1 border-t border-gray-100 hover:bg-sky-50 transition-colors';

/** スマホのメニューの店舗ログイン（弱いトーン）。 */
export const HEADER_MOBILE_STORE_LOGIN_LINK =
  'flex min-h-11 items-center text-gray-500 hover:text-primary text-xs px-3 transition-colors';
