import type { Metadata } from 'next';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { redirect } from 'next/navigation';
import MyPageNav from '@/components/mypage/MyPageNav';
import { verifyAuthUser } from '@/lib/auth-verification';
import AccessVerificationUnavailable from '@/components/admin/AccessVerificationUnavailable';
import { OFFER_STATE, hiddenMypageHrefs, type MypageOfferableFeature } from '@/lib/feature-toggles';

const HELD_TABLES: Record<MypageOfferableFeature, 'user_packages' | 'user_subscriptions'> = {
  packages: 'user_packages',
  subscriptions: 'user_subscriptions',
};

/**
 * 回数券・月額プランは「今はなし」（2026年10月23日 神原さん判断）。ナビからは外すが、
 * 既に持っている人には出し続ける（提供を止めても、持っているものが見えなくなってはいけない）。
 * 提供中の機能は数えない（ナビに常に出すので問い合わせ不要）。
 * 数えられなかったときは「持っている」側に倒す＝導線を残す（見えなくなるより、案内だけの
 * ページが開くほうが害が小さい）。RLS は本人行の SELECT を許している（*_own_read / *_own）。
 */
async function readHeldFeatures(
  supabase: Awaited<ReturnType<typeof createServerSupabaseAuthClient>>,
  userId: string,
): Promise<Record<MypageOfferableFeature, boolean>> {
  const features = Object.keys(HELD_TABLES) as MypageOfferableFeature[];
  const entries = await Promise.all(features.map(async (feature): Promise<[MypageOfferableFeature, boolean]> => {
    if (OFFER_STATE[feature]) return [feature, true];
    try {
      const { count, error } = await supabase
        .from(HELD_TABLES[feature])
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);
      return [feature, Boolean(error) || count == null || count > 0];
    } catch {
      return [feature, true];
    }
  }));
  return Object.fromEntries(entries) as Record<MypageOfferableFeature, boolean>;
}

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

  const held = await readHeldFeatures(supabase, verification.user.id);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <MyPageNav hiddenHrefs={hiddenMypageHrefs(held)} />
        {children}
      </div>
    </div>
  );
}
