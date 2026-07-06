import type { Metadata } from 'next';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { redirect } from 'next/navigation';
import MyPageNav from '@/components/mypage/MyPageNav';

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
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <MyPageNav />
        {children}
      </div>
    </div>
  );
}
