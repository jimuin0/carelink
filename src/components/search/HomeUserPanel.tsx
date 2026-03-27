'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import type { User } from '@supabase/supabase-js';

export default function HomeUserPanel() {
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    supabase.auth.getUser().then(({ data: { user: u } }) => {
      setUser(u);
      setLoading(false);
    }).catch(() => setLoading(false));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="bg-white rounded shadow-sm p-4">
        <div className="h-4 bg-gray-50 animate-pulse rounded mb-3" />
        <div className="h-9 bg-gray-50 animate-pulse rounded" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="bg-white rounded shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <p className="text-tiny text-gray-500 tracking-wide">ようこそ、ゲストさん</p>
        </div>
        <div className="px-4 py-4 space-y-2.5">
          <Link
            href={`/auth/login?redirect=${encodeURIComponent(pathname)}`}
            className="block w-full text-center py-2 bg-sky-600 text-white text-xs tracking-wider rounded hover:bg-sky-700 transition-colors"
          >
            ログインする
          </Link>
          <Link
            href="/auth/signup"
            className="block w-full text-center py-2 border border-gray-200 text-xs text-gray-500 rounded hover:bg-gray-50 transition-colors"
          >
            新規会員登録（無料）
          </Link>
        </div>
      </div>
    );
  }

  const displayName = user.user_metadata?.display_name || 'ユーザー';

  return (
    <div className="bg-white rounded shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <p className="text-tiny text-gray-500 tracking-wide">ようこそ、<span className="text-gray-700">{displayName}</span>さん</p>
      </div>
      <nav>
        {[
          { href: '/mypage', label: 'マイページ' },
          { href: '/mypage/favorites', label: 'お気に入り' },
          { href: '/mypage/profile', label: 'プロフィール編集' },
        ].map((item, i, arr) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center justify-between px-4 py-2.5 text-xs text-gray-600 hover:text-sky-700 hover:bg-sky-50/50 transition-colors ${i < arr.length - 1 ? 'border-b border-gray-100' : ''}`}
          >
            <span>{item.label}</span>
            <span className="text-gray-300 text-micro">&rsaquo;</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
