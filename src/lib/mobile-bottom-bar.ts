/**
 * 検索サイト側（LayoutSwitch の isSearchSite）で、画面下部に固定表示されるバーを決める単一ソース
 * （2026年10月22日）。
 *
 * 以前は下部ナビ分の逃げ（pb-14）を <main> に付けていたが、フッター（SearchFooter）は <main> の
 * 外・後ろにある。そのため一番下までスクロールしても、フッター最終行の
 * 「プライバシーポリシー／利用規約／特定商取引法に基づく表記」が下部ナビ（施設詳細では予約バー）の
 * 下に隠れたまま押せなかった（本番・iPhone 13 で実測）。逃げはフッター自身に付ける。
 *
 * - 'nav'     … MobileBottomNav（lg 未満だけ表示。高さは globals.css の --mobile-nav-height）
 * - 'booking' … 施設詳細の StickyBookingBar（.sticky-bar。全幅で表示。残席表示や案内文の折り返しで
 *               高さが変わるため、逃げは上限の --booking-bar-clearance で取る）
 * - 'none'    … どちらも出ない（施設の予約画面・ブログ・スタッフ個別ページなど）
 */
export type MobileBottomBar = 'nav' | 'booking' | 'none';

export function mobileBottomBarFor(pathname: string): MobileBottomBar {
  if (!pathname.startsWith('/facility/')) return 'nav';
  if (pathname.endsWith('/staff') || pathname.endsWith('/catalog')) return 'nav';
  // 施設詳細（/facility/<slug>）だけが StickyBookingBar を出す。
  if (/^\/facility\/[^/]+$/.test(pathname)) return 'booking';
  return 'none';
}

/**
 * 下部ナビの上に「絞り込み」ボタン（MobileFilterButton・ナビの 1.5rem 上・高さ約 44px）が浮くページ。
 * ボタンは右寄せで、同じく右寄せのフッター最終行（特定商取引法に基づく表記）に重なるため、
 * フッターの逃げをボタンの上端まで伸ばす。ボタンを描くページを増やしたらここにも足す
 * （src/lib/__tests__/mobile-bottom-bar.test.ts が描いているページとの一致を検査する）。
 */
export const FILTER_BUTTON_PATHS: readonly string[] = ['/search'];

// Tailwind が拾えるよう、クラスは完全な文字列で書く（globals.css は ../lib も走査する）。
const FOOTER_CLEARANCE: Record<MobileBottomBar, string> = {
  nav: 'pb-[var(--mobile-nav-height)] lg:pb-0',
  booking: 'pb-[var(--booking-bar-clearance)]',
  none: '',
};
const FOOTER_CLEARANCE_WITH_FILTER_BUTTON = 'pb-[calc(var(--mobile-nav-height)+4.5rem)] lg:pb-0';

/** フッターの下端に付ける逃げ（固定バー・浮いているボタンと同じ高さ）。 */
export function footerClearanceClass(pathname: string): string {
  if (FILTER_BUTTON_PATHS.includes(pathname)) return FOOTER_CLEARANCE_WITH_FILTER_BUTTON;
  return FOOTER_CLEARANCE[mobileBottomBarFor(pathname)];
}

/**
 * 画面下端に固定されるバーの目印は `data-bottom-fixed` 属性。下部ナビ（MobileBottomNav・
 * AdminMobileNav）と施設詳細の予約バー（StickyBookingBar）に付けている。
 * Cookie 同意バナーはこれらの上に出す（重なるとナビや「今すぐ予約する」が押せなくなる）。
 * `.sticky-bar` は属性を付け忘れた予約バーでも従来どおり避けるための保険。
 */
const BOTTOM_FIXED_SELECTOR = '[data-bottom-fixed], .sticky-bar';

/**
 * 表示中の下部固定バーのうち、いちばん高いものの高さ（px）。無ければ 0。
 * lg:hidden などで非表示のバー（高さ 0）は数えない。
 */
export function bottomFixedBarsHeight(root: ParentNode = document): number {
  let max = 0;
  root.querySelectorAll(BOTTOM_FIXED_SELECTOR).forEach((el) => {
    const { height } = el.getBoundingClientRect();
    if (height > max) max = height;
  });
  return max;
}
