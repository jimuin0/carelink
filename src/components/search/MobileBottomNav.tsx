'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const items = [
  {
    href: '/',
    label: 'ホーム',
    icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
  },
  {
    href: '/search',
    label: '検索',
    icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
  },
  {
    href: '/mypage/favorites',
    label: 'お気に入り',
    icon: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z',
  },
  {
    href: '/mypage',
    label: 'マイページ',
    icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  },
];

export default function MobileBottomNav() {
  const pathname = usePathname();

  // Don't show on facility detail pages (StickyBookingBar is there)
  if (pathname.startsWith('/facility/') && !pathname.endsWith('/staff') && !pathname.endsWith('/catalog')) {
    return null;
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 lg:hidden" aria-label="メインナビゲーション">
      <div className="flex">
        {items.map((item) => {
          const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex-1 flex flex-col items-center py-2 text-[10px] transition-colors ${
                isActive ? 'text-sky-500' : 'text-gray-400'
              }`}
            >
              <svg className="w-5 h-5 mb-0.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
              </svg>
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
