'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

export default function StickySignupCta() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem('sticky-cta-dismissed')) return;
    const supabase = createBrowserSupabaseClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) setShow(true);
    }).catch(() => {});
  }, []);

  if (!show) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 sm:hidden bg-white border-t border-gray-200 shadow-[0_-2px_12px_rgba(0,0,0,0.08)] px-4 pt-3 pb-[calc(0.75rem_+_env(safe-area-inset-bottom))]">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-gray-500 mb-1.5">予約のたびにポイント還元。利用は完全無料。</p>
          <Link
            href="/auth/signup"
            className="flex items-center justify-center w-full py-2.5 bg-sky-600 active:bg-sky-700 text-white text-sm font-bold rounded-lg"
          >
            無料で会員登録する
          </Link>
        </div>
        <button
          type="button"
          onClick={() => {
            sessionStorage.setItem('sticky-cta-dismissed', '1');
            setShow(false);
          }}
          className="shrink-0 w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600 text-lg"
          aria-label="閉じる"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
