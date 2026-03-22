import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export default async function MyPageLayout({ children }: { children: React.ReactNode }) {
  const supabase = createServerSupabaseAuthClient();
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
            href="/mypage/profile"
            className="text-sm px-4 py-2 rounded-full bg-white border border-gray-200 text-gray-700 hover:bg-sky-50 hover:text-primary transition-colors whitespace-nowrap"
          >
            プロフィール
          </Link>
        </nav>
        {children}
      </div>
    </div>
  );
}
