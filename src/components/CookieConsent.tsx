'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem('cookie-consent');
    if (!consent) setVisible(true);
  }, []);

  const accept = () => {
    localStorage.setItem('cookie-consent', 'accepted');
    setVisible(false);
  };

  const decline = () => {
    localStorage.setItem('cookie-consent', 'declined');
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-gray-900/95 backdrop-blur text-white px-4 py-4 shadow-lg">
      <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center gap-3 sm:gap-6">
        <p className="text-sm text-gray-200 text-center sm:text-left">
          当サイトではサービス向上のためCookieを使用しています。詳しくは
          <Link href="/privacy" className="underline text-blue-300 hover:text-blue-200 mx-1">
            プライバシーポリシー
          </Link>
          をご覧ください。
        </p>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={decline}
            className="text-sm px-4 py-2 text-gray-300 hover:text-white transition-colors"
          >
            拒否する
          </button>
          <button
            onClick={accept}
            className="bg-white text-gray-900 font-bold text-sm px-6 py-2 rounded-full hover:bg-gray-100 transition-colors"
          >
            同意する
          </button>
        </div>
      </div>
    </div>
  );
}
