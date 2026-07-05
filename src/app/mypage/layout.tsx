import type { Metadata } from 'next';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const metadata: Metadata = {
  title: { default: 'マイページ', template: '%s | マイページ | CareLink' },
  robots: { index: false, follow: false },
};

export default async function MyPageLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/auth/login?redirect=/mypage');
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <nav className="flex gap-1 mb-6 overflow-x-auto pb-2">
          <Link
            href="/mypage"
            className="text-sm px-4 py-2 rounded-full bg-white border border-gray-200 text-gray-700 hover:bg-sky-50 hover:text-primary transition-colors whitespace-nowrap"
          >
            ダッシュボード
          </Link>
          <Link
            href="/mypage/favorites"
            className="text-sm px-4 py-2 rounded-full bg-white border border-gray-200 text-gray-700 hover:bg-sky-50 hover:text-primary transition-colors whitespace-nowrap"
          >
            お気に入り
          </Link>
          <Link
            href="/mypage/bookings"
            className="text-sm px-4 py-2 rounded-full bg-white border border-gray-200 text-gray-700 hover:bg-sky-50 hover:text-primary transition-colors whitespace-nowrap"
          >
            予約履歴
          </Link>
          <Link
            href="/mypage/points"
            className="text-sm px-4 py-2 rounded-full bg-white border border-gray-200 text-gray-700 hover:bg-sky-50 hover:text-primary transition-colors whitespace-nowrap"
          >
            ポイント
          </Link>
          <Link
            href="/mypage/coupons"
            className="text-sm px-4 py-2 rounded-full bg-white border border-gray-200 text-gray-700 hover:bg-sky-50 hover:text-primary transition-colors whitespace-nowrap"
          >
            クーポン
          </Link>
          <Link
            href="/mypage/packages"
            className="text-sm px-4 py-2 rounded-full bg-white border border-gray-200 text-gray-700 hover:bg-sky-50 hover:text-primary transition-colors whitespace-nowrap"
          >
            回数券
          </Link>
          <Link
            href="/mypage/subscriptions"
            className="text-sm px-4 py-2 rounded-full bg-white border border-gray-200 text-gray-700 hover:bg-sky-50 hover:text-primary transition-colors whitespace-nowrap"
          >
            月額プラン
          </Link>
          <Link
            href="/mypage/referral"
            className="text-sm px-4 py-2 rounded-full bg-white border border-gray-200 text-gray-700 hover:bg-sky-50 hover:text-primary transition-colors whitespace-nowrap"
          >
            友達招待
          </Link>
          <Link
            href="/mypage/staff"
            className="text-sm px-4 py-2 rounded-full bg-white border border-gray-200 text-gray-700 hover:bg-sky-50 hover:text-primary transition-colors whitespace-nowrap"
          >
            指名スタッフ
          </Link>
          <Link
            href="/mypage/profile"
            className="text-sm px-4 py-2 rounded-full bg-white border border-gray-200 text-gray-700 hover:bg-sky-50 hover:text-primary transition-colors whitespace-nowrap"
          >
            プロフィール
          </Link>
          {/* 監査対応: Googleカレンダー/LINE連携設定ページ(/mypage/settings)へのナビリンクが
              一切無く、URLを直接知らない限り到達できなかった（迷子導線）。 */}
          <Link
            href="/mypage/settings"
            className="text-sm px-4 py-2 rounded-full bg-white border border-gray-200 text-gray-700 hover:bg-sky-50 hover:text-primary transition-colors whitespace-nowrap"
          >
            連携設定
          </Link>
        </nav>
        {children}
      </div>
    </div>
  );
}
