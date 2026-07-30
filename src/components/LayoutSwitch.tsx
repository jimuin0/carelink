'use client';

import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import SearchHeader from '@/components/search/SearchHeader';
import SearchFooter from '@/components/search/SearchFooter';
import { isValidPrefectureSlug } from '@/lib/seo-constants';

const MobileBottomNav = dynamic(() => import('@/components/search/MobileBottomNav'), { ssr: false });
const AiChatbot = dynamic(() => import('@/components/AiChatbot'), { ssr: false });

/**
 * @param aiEnabled ANTHROPIC_API_KEY が設定されているか。サーバ（layout.tsx）で評価して渡す。
 *   未設定のまま AI チャットボットを出すと、客が開いて 503（AIサービスに接続できませんでした）を
 *   踏む。実際に本番でその状態だった（2026年7月30日 実測）。判定理由は lib/integration-availability.ts。
 */
export default function LayoutSwitch({ children, aiEnabled }: { children: React.ReactNode; aiEnabled: boolean }) {
  const pathname = usePathname();

  // Admin has its own layout
  if (pathname.startsWith('/admin')) {
    return <main className="flex-1">{children}</main>;
  }

  // Check if path starts with a prefecture slug (e.g. /tokyo, /osaka/hair-salon)
  const firstSegment = pathname.split('/')[1] || '';
  const isPrefecturePage = isValidPrefectureSlug(firstSegment);

  const isSearchSite = pathname === '/' || pathname.startsWith('/search') || pathname.startsWith('/facility') || pathname.startsWith('/mypage') || pathname.startsWith('/auth') || pathname.startsWith('/ranking') || pathname.startsWith('/feature') || isPrefecturePage;

  if (isSearchSite) {
    return (
      <>
        <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[200] focus:bg-white focus:px-4 focus:py-2 focus:rounded-lg focus:shadow-lg focus:text-sky-600 focus:font-bold focus:text-sm">メインコンテンツへスキップ</a>
        <SearchHeader />
        <main id="main-content" className="flex-1 pb-14 lg:pb-0">{children}</main>
        <SearchFooter />
        <MobileBottomNav />
        {aiEnabled && <AiChatbot />}
      </>
    );
  }

  return (
    <>
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[200] focus:bg-white focus:px-4 focus:py-2 focus:rounded-lg focus:shadow-lg focus:text-sky-600 focus:font-bold focus:text-sm">メインコンテンツへスキップ</a>
      <Header />
      <main id="main-content" className="flex-1">{children}</main>
      <Footer />
    </>
  );
}
