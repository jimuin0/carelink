'use client';

// ヘッダーは全ページに出るうえ、業種一覧をデスクトップ/モバイルの2箇所で描画するため
// 先読み対象が最も多い。既定で先読みしない（理由と実測は components/BrowseLink.tsx）。
import Link from '@/components/BrowseLink';
import { useEffect, useId, useRef, useState } from 'react';
import { businessTypes } from '@/lib/constants';
import AuthButton from '@/components/auth/AuthButton';
import dynamic from 'next/dynamic';
import { businessTypeLabel } from '@/lib/business-type-label';
const LocaleSwitcher = dynamic(() => import('@/components/LocaleSwitcher'), { ssr: false });

/** 施設の掲載を考えている店舗向けの入口（一般のヘッダー Header.tsx と同じ行き先）。 */
export const SHOP_LISTING_HREF = '/register';
export const SHOP_LISTING_LABEL = '掲載をお考えの方';

/**
 * デスクトップの「業種から探す」。業種 8 つを横に並べると 1280px でもヘッダーが 2px はみ出して
 * 横スクロールが出ていた（2026年10月23日 本番で scrollWidth 1282 を実測）ので、1 つの
 * 開閉ボタンにまとめる。開閉の仕組みはディスクロージャ（button＋aria-expanded）で、
 * 外側のクリック・Esc・フォーカスが外れたときに閉じる。
 */
function BusinessTypeMenu() {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div
      ref={wrapperRef}
      className="relative"
      onBlur={(event) => {
        if (!wrapperRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1 text-[13px] px-3 py-1.5 rounded-full transition-colors whitespace-nowrap ${
          open ? 'bg-sky-50 text-primary' : 'text-gray-600 hover:text-primary hover:bg-sky-50'
        }`}
      >
        業種から探す
        <svg className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div id={panelId} className="absolute left-0 top-full mt-2 w-60 rounded-xl border border-gray-100 bg-white p-2 shadow-lg z-10">
          <ul className="flex flex-col">
            {businessTypes.map((type) => (
              <li key={type}>
                <Link
                  href={`/search?type=${encodeURIComponent(type)}`}
                  onClick={() => setOpen(false)}
                  className="block rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-sky-50 hover:text-primary transition-colors"
                >
                  {businessTypeLabel(type)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function SearchHeader() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-sm border-b border-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          <Link href="/" className="text-xl font-bold text-primary shrink-0">
            CareLink
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1 ml-4 min-w-0" aria-label="メインナビゲーション">
            <BusinessTypeMenu />
            <Link
              href="/search/area"
              className="text-gray-600 hover:text-primary text-[13px] px-3 py-1.5 rounded-full hover:bg-sky-50 transition-colors whitespace-nowrap"
            >
              エリアから探す
            </Link>
            {/* 掲載を考えている店舗の入口（2026年10月23日）。トップ・検索・施設ページはこの
                ヘッダーを使うので、一般の Header だけに置くと検索側から来た店舗が辿り着けない。 */}
            <Link
              href={SHOP_LISTING_HREF}
              className="ml-1 text-primary text-[13px] font-medium px-3 py-1.5 rounded-full border border-sky-200 hover:bg-sky-50 transition-colors whitespace-nowrap"
            >
              {SHOP_LISTING_LABEL}
            </Link>
            {/* 【2026年7月28日・神原さん判断で追加】掲載中の店舗オーナーの管理画面入口。
                トップ(/)・検索・施設ページはこの SearchHeader を使うため、来訪者向けの
                Header 側だけに置くと、トップから来た店舗オーナーが辿り着けないままになる。
                一般のお客様には不要な導線なので、業種ナビより弱いトーンで置く。
                redirect=/admin によりログイン後そのまま管理画面へ着地する。 */}
            <div className="ml-2 pl-2 border-l border-gray-200 shrink-0 flex items-center gap-2">
              <Link
                href="/auth/login?redirect=/admin"
                className="text-gray-500 hover:text-primary text-[12px] whitespace-nowrap transition-colors"
              >
                店舗ログイン
              </Link>
              <LocaleSwitcher />
              <AuthButton />
            </div>
          </nav>

          {/* Mobile hamburger */}
          <div className="flex items-center gap-2 md:hidden">
            <AuthButton />
          </div>

          <button
            type="button"
            className="md:hidden p-2 min-h-[44px] min-w-[44px] flex items-center justify-center"
            onClick={() => setIsOpen(!isOpen)}
            aria-label="メニュー"
            aria-expanded={isOpen}
            aria-controls="mobile-nav"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
          id="mobile-nav"
          className={`md:hidden transition-all duration-300 ease-in-out ${
            isOpen ? 'max-h-[calc(100dvh-7.5rem)] overflow-y-auto opacity-100' : 'max-h-0 overflow-hidden opacity-0'
          }`}
        >
          <nav aria-label="モバイルメニュー" className="pb-4 border-t border-gray-100 pt-3 flex flex-col gap-1">
            {businessTypes.map((type) => (
              <Link
                key={type}
                href={`/search?type=${encodeURIComponent(type)}`}
                className="text-gray-600 hover:text-primary text-sm px-3 py-2 rounded-lg hover:bg-sky-50 transition-colors"
                onClick={() => setIsOpen(false)}
              >
                {businessTypeLabel(type)}
              </Link>
            ))}
            <Link
              href="/search/area"
              className="text-gray-600 hover:text-primary text-sm px-3 py-2 rounded-lg hover:bg-sky-50 transition-colors"
              onClick={() => setIsOpen(false)}
            >
              エリアから探す
            </Link>
            {/* 店舗向けの入口（掲載の案内と、掲載中の店舗の管理画面）。区切って置く。 */}
            <Link
              href={SHOP_LISTING_HREF}
              className="text-primary font-medium text-sm px-3 py-2 mt-1 border-t border-gray-100 hover:bg-sky-50 transition-colors"
              onClick={() => setIsOpen(false)}
            >
              {SHOP_LISTING_LABEL}
            </Link>
            {/* デスクトップと同じく店舗オーナー向けの管理画面入口（弱いトーンで置く）。 */}
            <Link
              href="/auth/login?redirect=/admin"
              className="text-gray-500 hover:text-primary text-xs px-3 py-2 transition-colors"
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
