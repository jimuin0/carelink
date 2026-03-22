'use client';

import { usePathname } from 'next/navigation';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import SearchHeader from '@/components/search/SearchHeader';
import SearchFooter from '@/components/search/SearchFooter';

export default function LayoutSwitch({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Admin has its own layout
  if (pathname.startsWith('/admin')) {
    return <main className="flex-1">{children}</main>;
  }

  const isSearchSite = pathname.startsWith('/search') || pathname.startsWith('/facility') || pathname.startsWith('/mypage') || pathname.startsWith('/auth');

  if (isSearchSite) {
    return (
      <>
        <SearchHeader />
        <main className="flex-1">{children}</main>
        <SearchFooter />
      </>
    );
  }

  return (
    <>
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
    </>
  );
}
