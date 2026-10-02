import type { Metadata } from 'next';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { redirect } from 'next/navigation';
import MyPageNav from '@/components/mypage/MyPageNav';
import { verifyAuthUser } from '@/lib/auth-verification';
import AccessVerificationUnavailable from '@/components/admin/AccessVerificationUnavailable';

export const metadata: Metadata = {
  title: { default: 'マイページ', template: '%s | マイページ | CareLink' },
  robots: { index: false, follow: false },
};

export default async function MyPageLayout({ children }: { children: React.ReactNode }) {
  let supabase;
  try {
    supabase = await createServerSupabaseAuthClient();
  } catch {
    return <AccessVerificationUnavailable title="マイページのログイン状態を確認できません" />;
  }
  const verification = await verifyAuthUser(supabase.auth);
  if (verification.state === 'unavailable') {
    return <AccessVerificationUnavailable title="マイページのログイン状態を確認できません" />;
  }

  if (verification.state === 'unauthenticated') {
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
