'use client';

import Link from 'next/link';
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';

const AuthButton = dynamic(() => import('@/components/auth/AuthButton'), { ssr: false });

export default function Header() {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();
  // 「施設掲載」がリロードが不要な軽微な訴求リンクとの誤解を招くよう text-xs で
  // 目立たせない意図だったが、他リンクとフォントサイズが不揃いに見え「なぜ大きさが
  // 違うのか」と混乱を招いた。加えて /salon に既にいる時にクリックしても遷移せず、
  // 「押せたのか」がUXとして分からなかった(2026年7月6日・神原さん指摘)。フォント
  // サイズを他リンクに揃え、現在地では aria-current でハイライトして押した意味を示す。
  const isOnSalon = pathname === '/salon';

  // 🔴 /register はくすみ系のテーマ（globals.css の .theme-ecru）で描いている。
  // ヘッダーはそのページの器の外＝レイアウト側に在るため、ページ内で --primary を上書きしても
  // 届かず、【ロゴだけ濃い青のまま】でアイボリーの面から浮いていた（実機で確認）。
  // ここで同じクラスを付けると、ロゴ・hover・現在地ハイライトが var(--primary) 経由で
  // まとめてテーマ側の色に寄る。色の値はここに書かない（globals.css が単一ソース）。
  //
  // ⚠️ 透明度（bg-[...]/95）は付けない。Tailwind は CSS 変数の色に alpha を合成できず、
  // 無効な色になって【ヘッダーが透明になる】（実機の computed style で rgba(0,0,0,0) を確認）。
  const usesEcruTheme = pathname === '/register';

  return (
    <header
      className={`sticky top-0 z-50 backdrop-blur border-b ${
        usesEcruTheme
          ? 'theme-ecru bg-[var(--ecru-bg)] border-[var(--ecru-line)]'
          : 'bg-white/95 border-gray-100'
      }`}
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="text-2xl font-bold text-primary">
            CareLink
          </Link>

          {/* Desktop nav */}
          <nav className="hidden sm:flex items-center gap-4" aria-label="メインナビゲーション">
            <Link
              href="/search"
              className="text-gray-700 hover:text-primary font-medium transition-colors"
            >
              サロンを探す
            </Link>
            <Link href="/contact" className="text-gray-700 hover:text-primary font-medium transition-colors">
              お問い合わせ
            </Link>
            <Link
              href="/salon"
              aria-current={isOnSalon ? 'page' : undefined}
              className={
                isOnSalon
                  ? 'text-primary font-bold transition-colors'
                  : 'text-gray-700 hover:text-primary font-medium transition-colors'
              }
            >
              施設掲載
            </Link>
            {/* 【2026年7月28日・神原さん判断で追加】掲載中の店舗オーナーが管理画面へ入る導線を
                ヘッダーに常設する。従来は未ログイン時に店舗用の入口が一切無く、ログイン後も
                アイコンメニューを開かないと「管理画面」リンクに気づけなかった。
                redirect=/admin を付けるのでログイン後そのまま管理画面に着地する。
                ログイン済みの場合は /auth/login が既存セッションを検知して即 /admin へ送る
                （src/app/auth/login/page.tsx の初回マウント時 replace）ため、常時表示でよい。 */}
            <div className="flex items-center gap-2 pl-2 border-l border-gray-200">
              <Link
                href="/auth/login?redirect=/admin"
                className="text-sm text-gray-500 hover:text-primary font-medium transition-colors whitespace-nowrap"
              >
                店舗ログイン
              </Link>
              <Link href="/auth/signup" className="text-sm text-gray-700 hover:text-primary font-medium transition-colors">
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
            isOpen ? 'max-h-64 opacity-100' : 'max-h-0 opacity-0'
          }`}
        >
          <nav className="pb-4 border-t border-gray-100 pt-4 flex flex-col gap-4" aria-label="モバイルナビゲーション">
            <Link
              href="/search"
              className="text-gray-700 font-medium hover:text-primary transition-colors"
              onClick={() => setIsOpen(false)}
            >
              サロンを探す
            </Link>
            <Link
              href="/auth/signup"
              className="text-gray-700 font-medium hover:text-primary transition-colors"
              onClick={() => setIsOpen(false)}
            >
              会員登録（無料）
            </Link>
            <Link
              href="/contact"
              className="text-gray-700 font-medium hover:text-primary transition-colors"
              onClick={() => setIsOpen(false)}
            >
              お問い合わせ
            </Link>
            <Link
              href="/salon"
              aria-current={isOnSalon ? 'page' : undefined}
              className={
                isOnSalon
                  ? 'text-primary font-bold transition-colors'
                  : 'text-gray-700 font-medium hover:text-primary transition-colors'
              }
              onClick={() => setIsOpen(false)}
            >
              施設掲載はこちら
            </Link>
            {/* デスクトップと同じく、掲載中の店舗オーナー向けの管理画面入口。 */}
            <Link
              href="/auth/login?redirect=/admin"
              className="text-gray-500 font-medium hover:text-primary transition-colors"
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
