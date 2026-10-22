import { redirect } from 'next/navigation';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { verifyAuthUser } from '@/lib/auth-verification';
import { DEFAULT_REDIRECT } from '@/lib/safe-redirect';
import { landingPathFor } from '@/lib/post-login-landing';

// 戻り先を指定せずにログイン・登録した人の振り分け（lib/post-login-landing.ts）。
// 店舗を管理できるアカウントは /admin、それ以外は /mypage。判定はサーバー側だけで行う。
export const dynamic = 'force-dynamic';

export default async function AuthLandingPage() {
  let destination = DEFAULT_REDIRECT;
  try {
    const supabase = await createServerSupabaseAuthClient();
    const verification = await verifyAuthUser(supabase.auth);
    if (verification.state === 'unauthenticated') destination = '/auth/login';
    else if (verification.state === 'verified') destination = await landingPathFor(supabase, verification.user.id);
  } catch {
    // 確認できないときは来院者側へ倒す（/mypage は自身で「確認できません」を表示する）。
  }
  redirect(destination);
}
