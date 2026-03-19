'use client';

import Link from 'next/link';
import { useState } from 'react';

export default function Header() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-gray-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="text-2xl font-bold" style={{ color: 'var(--primary)' }}>
            CareLink
          </Link>

          {/* Desktop nav */}
          <nav className="hidden sm:flex items-center gap-6">
            <Link
              href="/salon"
              className="text-gray-700 hover:text-primary font-medium transition-colors"
            >
              施設の方
            </Link>
            <Link
              href="/jobs"
              className="text-gray-700 hover:text-primary font-medium transition-colors"
            >
              求職者の方
            </Link>
          </nav>

          {/* Mobile hamburger */}
          <button
            className="sm:hidden p-2"
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
        {isOpen && (
          <nav className="sm:hidden pb-4 border-t border-gray-100 pt-4 flex flex-col gap-4">
            <Link
              href="/salon"
              className="text-gray-700 font-medium"
              onClick={() => setIsOpen(false)}
            >
              施設の方
            </Link>
            <Link
              href="/jobs"
              className="text-gray-700 font-medium"
              onClick={() => setIsOpen(false)}
            >
              求職者の方
            </Link>
          </nav>
        )}
      </div>
    </header>
  );
}
