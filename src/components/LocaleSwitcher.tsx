'use client';

import { useState, useRef, useEffect } from 'react';
import { LOCALE_LABELS, LOCALE_FLAGS, SUPPORTED_LOCALES, type Locale, LOCALE_COOKIE_KEY } from '@/lib/i18n';

export default function LocaleSwitcher() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<Locale>('ja');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Read current locale from cookie
    const match = document.cookie.match(new RegExp(`${LOCALE_COOKIE_KEY}=([^;]+)`));
    if (match && SUPPORTED_LOCALES.includes(match[1] as Locale)) {
      setCurrent(match[1] as Locale);
    }
  }, []);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleSelect = (locale: Locale) => {
    // Set cookie (1 year)
    document.cookie = `${LOCALE_COOKIE_KEY}=${locale};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax`;
    setCurrent(locale);
    setOpen(false);
    // Reload to apply locale changes
    window.location.reload();
  };

  if (current === 'ja' && !open) {
    // Show compact version when default Japanese
    return (
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors px-2 py-1 rounded-lg hover:bg-gray-100"
          aria-label="言語を変更"
        >
          <span>🌐</span>
          <span className="hidden sm:inline">{LOCALE_FLAGS[current]} {LOCALE_LABELS[current]}</span>
        </button>
        {open && <Menu current={current} onSelect={handleSelect} />}
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
        aria-label="Change language"
      >
        <span>{LOCALE_FLAGS[current]}</span>
        <span>{LOCALE_LABELS[current]}</span>
        <svg className={`w-3 h-3 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <Menu current={current} onSelect={handleSelect} />}
    </div>
  );
}

function Menu({ current, onSelect }: { current: Locale; onSelect: (l: Locale) => void }) {
  return (
    <div className="absolute right-0 top-full mt-1 bg-white rounded-xl border border-gray-100 shadow-lg py-1 z-50 min-w-[140px]">
      {SUPPORTED_LOCALES.map((locale) => (
        <button
          key={locale}
          type="button"
          onClick={() => onSelect(locale)}
          className={`w-full text-left flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 transition-colors ${
            locale === current ? 'text-sky-600 font-bold' : 'text-gray-700'
          }`}
        >
          <span>{LOCALE_FLAGS[locale]}</span>
          <span>{LOCALE_LABELS[locale]}</span>
          {locale === current && (
            <svg className="w-3 h-3 ml-auto text-sky-500" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          )}
        </button>
      ))}
    </div>
  );
}
