'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import type { User } from '@supabase/supabase-js';

export default function AuthButton() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();

    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      setLoading(false);
    }).catch(() => setLoading(false));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const handleLogout = async () => {
    const supabase = createBrowserSupabaseClient();
    await supabase.auth.signOut();
    setMenuOpen(false);
    router.push('/search');
    router.refresh();
  };

  if (loading) {
    return <div className="w-8 h-8 rounded-full bg-gray-200 animate-pulse" />;
  }

  if (!user) {
    return (
      <Link
        href={`/auth/login?redirect=${encodeURIComponent(pathname)}`}
        className="text-sm text-gray-600 hover:text-primary px-3 py-1.5 rounded-full hover:bg-sky-50 transition-colors"
      >
        ログイン
      </Link>
    );
  }

  const displayName = user.user_metadata?.display_name || 'ユーザー';
  const initial = displayName.charAt(0);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen(!menuOpen)}
        className="flex items-center gap-2 min-h-[44px] min-w-[44px] justify-center"
        aria-label="ユーザーメニュー"
        aria-expanded={menuOpen}
      >
        <div className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center text-sm font-bold">
          {initial}
        </div>
      </button>

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-xl shadow-lg border border-gray-100 py-2 z-50">
            <div className="px-4 py-2 border-b border-gray-100">
              <p className="text-sm font-medium text-gray-900 truncate">{displayName}</p>
            </div>
            <Link
              href="/mypage"
              className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              マイページ
            </Link>
            <Link
              href="/mypage/favorites"
              className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              お気に入り
            </Link>
            <Link
              href="/mypage/profile"
              className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              プロフィール編集
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
            >
              ログアウト
            </button>
          </div>
        </>
      )}
    </div>
  );
}
