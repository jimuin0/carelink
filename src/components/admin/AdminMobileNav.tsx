'use client';

import { useState } from 'react';
import Link from 'next/link';

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

export default function AdminMobileNav({ items }: { items: NavItem[] }) {
  const [showMore, setShowMore] = useState(false);
  const mainItems = items.slice(0, 4);
  const moreItems = items.slice(4);

  return (
    <>
      {/* More menu overlay */}
      {showMore && (
        <div className="lg:hidden fixed inset-0 z-50" onClick={() => setShowMore(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="absolute bottom-16 left-0 right-0 bg-white rounded-t-2xl shadow-xl p-4 max-h-[60vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 px-2">メニュー</p>
            <div className="grid grid-cols-4 gap-2">
              {moreItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setShowMore(false)}
                  className="flex flex-col items-center gap-1 p-3 rounded-xl hover:bg-sky-50 transition-colors"
                >
                  <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={item.icon} />
                  </svg>
                  <span className="text-micro text-gray-600 text-center">{item.label}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Bottom nav bar */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t z-40 flex justify-around py-2">
        {mainItems.map((item) => (
          <Link key={item.href} href={item.href} className="flex flex-col items-center gap-0.5 px-2 py-1">
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={item.icon} />
            </svg>
            <span className="text-micro text-gray-500">{item.label}</span>
          </Link>
        ))}
        <button type="button" onClick={() => setShowMore(!showMore)} className="flex flex-col items-center gap-0.5 px-2 py-1">
          <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" />
          </svg>
          <span className="text-micro text-gray-500">その他</span>
        </button>
      </nav>
    </>
  );
}
