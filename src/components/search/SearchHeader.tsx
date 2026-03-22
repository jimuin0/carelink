'use client';

import Link from 'next/link';
import { useState } from 'react';
import { businessTypes } from '@/lib/constants';

export default function SearchHeader() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-gray-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          <Link href="/search" className="text-xl font-bold text-primary">
            CareLink
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1">
            {businessTypes.map((type) => (
              <Link
                key={type}
                href={`/search?type=${encodeURIComponent(type)}`}
                className="text-gray-600 hover:text-primary text-sm px-3 py-1.5 rounded-full hover:bg-sky-50 transition-colors"
              >
                {type}
              </Link>
            ))}
          </nav>

          {/* Mobile hamburger */}
          <button
            className="md:hidden p-2 min-h-[44px] min-w-[44px] flex items-center justify-center"
            onClick={() => setIsOpen(!isOpen)}
            aria-label="メニュー"
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
          className={`md:hidden overflow-hidden transition-all duration-300 ease-in-out ${
            isOpen ? 'max-h-80 opacity-100' : 'max-h-0 opacity-0'
          }`}
        >
          <nav className="pb-4 border-t border-gray-100 pt-3 flex flex-col gap-1">
            {businessTypes.map((type) => (
              <Link
                key={type}
                href={`/search?type=${encodeURIComponent(type)}`}
                className="text-gray-600 hover:text-primary text-sm px-3 py-2 rounded-lg hover:bg-sky-50 transition-colors"
                onClick={() => setIsOpen(false)}
              >
                {type}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </header>
  );
}
