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

export default function LayoutSwitch({ children }: { children: React.ReactNode }) {
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
        <AiChatbot />
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
