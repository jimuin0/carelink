'use client';

import Link from 'next/link';
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import { isEcruShopPath } from '@/lib/shop-theme';
import {
  HEADER_ACCOUNT_GROUP,
  HEADER_BAR,
  HEADER_LISTING_LINK,
  HEADER_MOBILE_LINK,
  HEADER_MOBILE_LISTING_LINK,
  HEADER_MOBILE_STORE_LOGIN_LINK,
  HEADER_NAV_LINK,
  HEADER_STORE_LOGIN_LINK,
} from '@/components/header-styles';

const AuthButton = dynamic(() => import('@/components/auth/AuthButton'), { ssr: false });

export default function Header({ shopPage = false }: { shopPage?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();
  // 🔴 店舗向けページ（/register・/register/complete）はくすみ系のテーマ（globals.css の .theme-ecru）で描く。
  // ヘッダーはそのページの器の外＝レイアウト側に在るため、ページ内で変数を上書きしても届かない。
  // ここで同じクラスを付けて、地色・罫線・hover をテーマ側の色に寄せる。色の値はここに書かない。
  // 判定は src/lib/shop-theme.ts が単一ソース（フッターも同じ判定を見る）。
  //
  // ⚠️ ロゴは --logo（ブランド色）で描き、テーマでは塗り替えない（2026年10月23日 神原さん決定）。
  // 以前はテーマの --primary に追従させていたため、/register でだけロゴがくすみローズになり、
  // 同じサービスのロゴに見えなかった。
  //
  // ⚠️ 透明度（bg-[...]/95）は付けない。Tailwind は CSS 変数の色に alpha を合成できず、
  // 無効な色になって【ヘッダーが透明になる】（実機の computed style で rgba(0,0,0,0) を確認）。
  const isShopPage = shopPage || isEcruShopPath(pathname);

  // 店舗向けページでは、来院者向けの導線（サロンを探す・会員登録・ログイン・施設掲載）を出さない。
  // 掲載を検討している店舗に必要なのは、既に掲載中の店舗が管理画面へ入る入口だけ。
  if (isShopPage) {
    return (
      <header className="theme-ecru sticky top-0 z-50 border-b border-(--ecru-line) bg-(--ecru-bg)">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className={HEADER_BAR}>
            {/* ロゴの大きさ・高さは検索サイト側の SearchHeader と同じ（src/components/header-styles.ts）。 */}
            <Link href="/" className="text-xl font-bold text-(--logo) shrink-0">
              CareLink
            </Link>
            <Link
              href="/auth/login?redirect=/admin"
              className="inline-flex min-h-[44px] items-center px-2 text-sm font-medium text-(--ecru-text) underline-offset-4 hover:underline whitespace-nowrap"
            >
              店舗ログイン
            </Link>
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-50 backdrop-blur-sm border-b bg-white/95 border-gray-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className={HEADER_BAR}>
          <Link href="/" className="text-xl font-bold text-(--logo) shrink-0">
            CareLink
          </Link>

          {/* Desktop nav（リンクの見た目は SearchHeader と共通: src/components/header-styles.ts） */}
          <nav className="hidden sm:flex items-center gap-1 ml-4 min-w-0" aria-label="メインナビゲーション">
            <Link href="/search" className={HEADER_NAV_LINK}>
              サロンを探す
            </Link>
            <Link href="/contact" className={HEADER_NAV_LINK}>
              お問い合わせ
            </Link>
            <Link href="/register" className={HEADER_LISTING_LINK}>
              施設掲載
            </Link>
            {/* 【2026年7月28日・神原さん判断で追加】掲載中の店舗オーナーが管理画面へ入る導線を
                ヘッダーに常設する。従来は未ログイン時に店舗用の入口が一切無く、ログイン後も
                アイコンメニューを開かないと「管理画面」リンクに気づけなかった。
                redirect=/admin を付けるのでログイン後そのまま管理画面に着地する。
                ログイン済みの場合でも常時表示でよい（2026年8月20日 訂正）:
                middleware.ts が /auth/login への到達自体を「ページの HTML / RSC ペイロード
                生成より前」に 307 で /mypage（?redirect 尊重後は redirect 先）へ差し替えるため、
                /auth/login/page.tsx 側の useEffect（既存セッション検知）は一度もマウントされない
                （旧コメントの想定は成立しない）。 */}
            <div className={HEADER_ACCOUNT_GROUP}>
              <Link href="/auth/login?redirect=/admin" className={HEADER_STORE_LOGIN_LINK}>
                店舗ログイン
              </Link>
              <Link href="/auth/signup" className={HEADER_NAV_LINK}>
                会員登録
              </Link>
              <AuthButton />
            </div>
          </nav>

          {/* Mobile: auth + hamburger */}
          <div className="sm:hidden flex items-center gap-1">
            <AuthButton />
          </div>
          <button
            type="button"
            className="sm:hidden p-2 min-h-[44px] min-w-[44px] flex items-center justify-center"
            onClick={() => setIsOpen(!isOpen)}
            aria-label="メニュー"
            aria-expanded={isOpen}
          >
            <svg className="w-6 h-6 transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {isOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>

        {/* Mobile menu */}
        <div
          className={`sm:hidden overflow-hidden transition-all duration-300 ease-in-out ${
            isOpen ? 'max-h-80 opacity-100' : 'max-h-0 opacity-0'
          }`}
        >
          <nav className="pb-4 border-t border-gray-100 pt-3 flex flex-col gap-1" aria-label="モバイルナビゲーション">
            <Link
              href="/search"
              className={HEADER_MOBILE_LINK}
              onClick={() => setIsOpen(false)}
            >
              サロンを探す
            </Link>
            <Link
              href="/auth/signup"
              className={HEADER_MOBILE_LINK}
              onClick={() => setIsOpen(false)}
            >
              会員登録（無料）
            </Link>
            <Link
              href="/contact"
              className={HEADER_MOBILE_LINK}
              onClick={() => setIsOpen(false)}
            >
              お問い合わせ
            </Link>
            <Link
              href="/register"
              className={HEADER_MOBILE_LISTING_LINK}
              onClick={() => setIsOpen(false)}
            >
              施設掲載はこちら
            </Link>
            {/* デスクトップと同じく、掲載中の店舗オーナー向けの管理画面入口。 */}
            <Link
              href="/auth/login?redirect=/admin"
              className={HEADER_MOBILE_STORE_LOGIN_LINK}
              onClick={() => setIsOpen(false)}
            >
              店舗ログイン
            </Link>
          </nav>
        </div>
      </div>
    </header>
  );
}
