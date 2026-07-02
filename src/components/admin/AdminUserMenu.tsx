'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

/**
 * 管理画面ヘッダーのアカウントメニュー（ログアウト導線）。
 * admin レイアウトには従来ログアウト手段が無く、別アカウント（例: 鍼灸院）へ
 * 切り替えられなかった。顧客向け AuthButton と同じ signOut を admin 文脈でも
 * 使えるようにする。ログアウト後は /auth/login へ遷移し、別アカウントで
 * 再ログインできるようにする。
 */
export default function AdminUserMenu() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    supabase.auth
      .getUser()
      .then(({ data: { user } }) => setEmail(user?.email ?? null))
      .catch(() => setEmail(null));
  }, []);

  // ESC で閉じる（WAI-ARIA APG 推奨）。
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      const supabase = createBrowserSupabaseClient();
      await supabase.auth.signOut();
      setMenuOpen(false);
      router.push('/auth/login');
      router.refresh();
    } catch {
      // signOut が失敗してもログイン画面へ誘導する（そこで再ログインできる）。
      setLoggingOut(false);
      router.push('/auth/login');
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        className="flex items-center gap-1 text-gray-500 hover:text-sky-600 min-h-[44px]"
        aria-label="アカウントメニュー"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
        <span className="hidden xl:inline">アカウント</span>
      </button>

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-xl shadow-lg border border-gray-100 py-2 z-50">
            {email && (
              <div className="px-4 py-2 border-b border-gray-100">
                <p className="text-xs text-gray-400">ログイン中</p>
                <p className="text-sm font-medium text-gray-900 truncate">{email}</p>
              </div>
            )}
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="flex items-center w-full min-h-[44px] text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              {loggingOut ? 'ログアウト中…' : 'ログアウト'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
