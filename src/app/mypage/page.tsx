import { notFound } from 'next/navigation';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import Link from 'next/link';
import RecentlyViewed from '@/components/facility/RecentlyViewed';

export default async function MyPageDashboard() {
  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', user.id)
    .single();

  const [{ count: favoriteCount }, { count: bookingCount }] = await Promise.all([
    supabase.from('favorites').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
    supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
  ]);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-sm p-6">
        <h1 className="text-xl font-bold mb-2">
          {profile?.display_name ?? 'ユーザー'}さん、こんにちは
        </h1>
        <p className="text-sm text-gray-500">マイページでは、お気に入りやプロフィールを管理できます。</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link href="/mypage/favorites" className="bg-white rounded-2xl shadow-sm p-6 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-pink-50 flex items-center justify-center">
              <svg className="w-6 h-6 text-pink-500" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
              </svg>
            </div>
            <div>
              <p className="text-2xl font-bold">{favoriteCount ?? 0}</p>
              <p className="text-sm text-gray-500">お気に入り施設</p>
            </div>
          </div>
        </Link>

        <Link href="/mypage/bookings" className="bg-white rounded-2xl shadow-sm p-6 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center">
              <svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <p className="text-2xl font-bold">{bookingCount ?? 0}</p>
              <p className="text-sm text-gray-500">予約履歴</p>
            </div>
          </div>
        </Link>

        <Link href="/mypage/profile" className="bg-white rounded-2xl shadow-sm p-6 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-sky-50 flex items-center justify-center">
              <svg className="w-6 h-6 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium">プロフィール</p>
              <p className="text-sm text-gray-500">登録情報を編集</p>
            </div>
          </div>
        </Link>
      </div>

      <RecentlyViewed />

      <div className="bg-white rounded-2xl shadow-sm p-6">
        <h2 className="font-bold mb-3">施設を探す</h2>
        <Link href="/search" className="text-sm text-primary hover:underline">
          施設検索ページへ
        </Link>
      </div>
    </div>
  );
}
