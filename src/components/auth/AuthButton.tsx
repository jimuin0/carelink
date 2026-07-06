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
  const [isFacilityMember, setIsFacilityMember] = useState(false);

  // 施設オーナー/スタッフが自分の管理画面(/admin)へ辿り着く導線がヘッダーに一切無く、
  // URLを直接知らないと迷子になっていた(2026年7月6日・神原さん指摘)。facility_members
  // に自分が所属していれば「管理画面」リンクを表示する。
  const checkFacilityMembership = (userId: string) => {
    const supabase = createBrowserSupabaseClient();
    supabase
      .from('facility_members')
      .select('facility_id')
      .eq('user_id', userId)
      .limit(1)
      .then(({ data }) => setIsFacilityMember(!!data && data.length > 0));
  };

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();

    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      setLoading(false);
      if (user) checkFacilityMembership(user.id);
    }).catch(() => setLoading(false));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) checkFacilityMembership(session.user.id);
      else setIsFacilityMember(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // 開いているポップアップメニューを ESC で閉じられるようにする（WAI-ARIA APG の推奨）。
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

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

  const meta = user.user_metadata ?? {};
  const displayName =
    meta.display_name ||
    meta.full_name ||
    meta.name ||
    (user.email ? user.email.split('@')[0] : '') ||
    'ユーザー';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen(!menuOpen)}
        className="flex items-center gap-2 min-h-[44px] min-w-[44px] justify-center"
        aria-label="ユーザーメニュー"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <div className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 12c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm0 2c-3.33 0-10 1.67-10 5v3h20v-3c0-3.33-6.67-5-10-5z" />
          </svg>
        </div>
      </button>

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-xl shadow-lg border border-gray-100 py-2 z-50">
            <div className="px-4 py-2 border-b border-gray-100">
              <p className="text-sm font-medium text-gray-900 truncate">{displayName}</p>
            </div>
            {isFacilityMember && (
              <Link
                href="/admin"
                onClick={() => setMenuOpen(false)}
                className="flex items-center min-h-[44px] px-4 py-2 text-sm text-primary font-medium hover:bg-sky-50 active:bg-sky-100"
              >
                管理画面
              </Link>
            )}
            <Link
              href="/mypage"
              onClick={() => setMenuOpen(false)}
              className="flex items-center min-h-[44px] px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100"
            >
              マイページ
            </Link>
            <Link
              href="/mypage/favorites"
              onClick={() => setMenuOpen(false)}
              className="flex items-center min-h-[44px] px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100"
            >
              お気に入り
            </Link>
            <Link
              href="/mypage/profile"
              onClick={() => setMenuOpen(false)}
              className="flex items-center min-h-[44px] px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100"
            >
              プロフィール編集
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="flex items-center w-full min-h-[44px] text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 active:bg-red-100"
            >
              ログアウト
            </button>
          </div>
        </>
      )}
    </div>
  );
}
