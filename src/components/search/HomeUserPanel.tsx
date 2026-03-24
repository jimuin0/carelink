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
      <div className="border border-gray-300">
        <div className="px-3 py-3">
          <div className="h-4 bg-gray-100 animate-pulse mb-2" />
          <div className="h-8 bg-gray-100 animate-pulse" />
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="border border-gray-300">
        <div className="px-3 py-2 border-b border-gray-200 bg-[#f7f5f0]">
          <p className="text-xs text-gray-600">ようこそ、ゲストさん</p>
        </div>
        <div className="px-3 py-3 space-y-2">
          <Link
            href={`/auth/login?redirect=${encodeURIComponent(pathname)}`}
            className="block w-full text-center py-1.5 bg-sky-600 text-white text-xs hover:bg-sky-700 transition-colors"
          >
            ログインする
          </Link>
          <Link
            href="/auth/signup"
            className="block w-full text-center py-1.5 border border-gray-300 text-xs text-gray-700 hover:bg-gray-50 transition-colors"
          >
            新規会員登録（無料）
          </Link>
        </div>
      </div>
    );
  }

  const displayName = user.user_metadata?.display_name || 'ユーザー';

  return (
    <div className="border border-gray-300">
      <div className="px-3 py-2 border-b border-gray-200 bg-[#f7f5f0]">
        <p className="text-xs text-gray-600">ようこそ、<span className="font-bold text-gray-800">{displayName}</span>さん</p>
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
            className={`flex items-center justify-between px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 transition-colors ${i < arr.length - 1 ? 'border-b border-gray-200' : ''}`}
          >
            <span>{item.label}</span>
            <span className="text-gray-400 text-xs">&rsaquo;</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
