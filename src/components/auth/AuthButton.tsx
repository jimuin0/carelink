'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import type { User } from '@supabase/supabase-js';
import { clearAccountLocalData, LOCAL_DATA_CLEAR_FAILED } from '@/lib/client-storage';
import { markClientCleanupNeeded, completeClientCleanupMarker } from '@/lib/client-cleanup-marker';

export default function AuthButton() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isFacilityMember, setIsFacilityMember] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutNotice, setLogoutNotice] = useState<{ cleanupOnly: boolean; message: string } | null>(null);
  const authGeneration = useRef(0);

  // 施設オーナー/スタッフが自分の管理画面(/admin)へ辿り着く導線がヘッダーに一切無く、
  // URLを直接知らないと迷子になっていた(2026年7月6日・神原さん指摘)。facility_members
  // に自分が所属していれば「管理画面」リンクを表示する。
  const checkFacilityMembership = (userId: string) => {
    const supabase = createBrowserSupabaseClient();
    const generation = authGeneration.current;
    void Promise.resolve(supabase
      .from('facility_members')
      .select('facility_id')
      .eq('user_id', userId)
      .limit(1))
      .then(({ data, error }) => { if (generation === authGeneration.current) setIsFacilityMember(!error && !!data && data.length > 0); })
      .catch(() => { if (generation === authGeneration.current) setIsFacilityMember(false); });
  };

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    const generation = ++authGeneration.current;

    supabase.auth.getUser().then(({ data: { user }, error }) => {
      if (generation !== authGeneration.current) return;
      if (error) throw new Error('User read unavailable');
      setUser(user);
      setLoading(false);
      if (user) checkFacilityMembership(user.id);
    }).catch(() => { if (generation === authGeneration.current) setLoading(false); });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      authGeneration.current++;
      setUser(session?.user ?? null);
      setLoading(false);
      if (session?.user) checkFacilityMembership(session.user.id);
      else setIsFacilityMember(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // pathname が変わったらメニューを閉じる。effect内の無条件setStateは React Compiler の
  // set-state-in-effect に検出されるため、React公式が推奨する「prop変化をrender中に検知して
  // 調整する」パターン（前回のpathnameとの比較）に置き換える。挙動は変わらない
  // （むしろ従来はeffect実行=1描画分遅れていたのが、同一描画内で閉じるためズレが無くなる）。
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setMenuOpen(false);
  }

  // 開いているポップアップメニューを ESC で閉じられるようにする（WAI-ARIA APG の推奨）。
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    let cleared = true;
    try { await clearAccountLocalData(); } catch { cleared = false; }
    try {
      const result = await createBrowserSupabaseClient().auth.signOut();
      if (result?.error !== null) throw new Error('Logout not confirmed');
      authGeneration.current++;
      setUser(null); setIsFacilityMember(false); setMenuOpen(false);
      try { markClientCleanupNeeded(); await clearAccountLocalData(); completeClientCleanupMarker(); cleared = true; }
      catch { cleared = false; }
      if (!cleared) {
        setLogoutNotice({ cleanupOnly: true, message: `ログアウトしましたが、${LOCAL_DATA_CLEAR_FAILED}` });
        return;
      }
      setLogoutNotice(null); router.push('/search'); router.refresh();
    } catch {
      setMenuOpen(false);
      setLogoutNotice({ cleanupOnly: false, message: `ログアウトを確認できませんでした。再試行するか、ログイン状態をご確認ください。${cleared ? '' : LOCAL_DATA_CLEAR_FAILED}` });
    } finally { setLoggingOut(false); }
  };

  const retryCleanup = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try { markClientCleanupNeeded(); await clearAccountLocalData(); completeClientCleanupMarker(); setLogoutNotice(null); router.push('/search'); router.refresh(); }
    catch { setLogoutNotice({ cleanupOnly: true, message: `ログアウトは完了していますが、${LOCAL_DATA_CLEAR_FAILED}` }); }
    finally { setLoggingOut(false); }
  };
  const notice = logoutNotice && <div role="alert" className="mt-2 max-w-sm rounded-sm border border-amber-300 bg-white p-3 text-xs text-gray-700">
    <p>{logoutNotice.message}</p>
    <button type="button" disabled={loggingOut} onClick={logoutNotice.cleanupOnly ? retryCleanup : handleLogout} className="mt-2 underline">
      {logoutNotice.cleanupOnly ? '端末の下書き削除を再試行' : 'ログアウトを再試行'}
    </button>
    <Link href="/auth/login" className="ml-3 underline">ログイン画面へ進む</Link>
  </div>;

  if (loading) {
    return <div className="w-8 h-8 rounded-full bg-gray-200 animate-pulse" />;
  }

  if (!user) {
    return (
      <div><Link
        href={`/auth/login?redirect=${encodeURIComponent(pathname)}`}
        className="text-sm text-gray-600 hover:text-primary px-3 py-1.5 rounded-full hover:bg-sky-50 transition-colors"
      >
        ログイン
      </Link>{notice}</div>
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
              disabled={loggingOut}
              className="flex items-center w-full min-h-[44px] text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 active:bg-red-100"
            >
              {loggingOut ? 'ログアウト中…' : 'ログアウト'}
            </button>
          </div>
        </>
      )}
      {notice}
    </div>
  );
}
