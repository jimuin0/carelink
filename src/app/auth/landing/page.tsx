import { redirect } from 'next/navigation';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { verifyAuthUser } from '@/lib/auth-verification';
import { DEFAULT_REDIRECT } from '@/lib/safe-redirect';
import { landingPathFor } from '@/lib/post-login-landing';

// 戻り先を指定せずにログイン・登録した人の振り分け（lib/post-login-landing.ts）。
// 店舗を管理できるアカウントは /admin、店舗が無く引き継げる掲載申込があれば申込の続き、それ以外は /mypage。
// 判定はサーバー側だけで行う（引き継げる申込の確認は service role 専用の RPC）。
export const dynamic = 'force-dynamic';

export default async function AuthLandingPage() {
  let destination = DEFAULT_REDIRECT;
  try {
    const supabase = await createServerSupabaseAuthClient();
    const verification = await verifyAuthUser(supabase.auth);
    if (verification.state === 'unauthenticated') destination = '/auth/login';
    else if (verification.state === 'verified') {
      // service role が使えない環境でも、店舗オーナーの /admin への振り分けは止めない。
      let service: ReturnType<typeof createServiceRoleClient> | undefined;
      try { service = createServiceRoleClient(); } catch { service = undefined; }
      destination = await landingPathFor(supabase, verification.user.id, service);
    }
  } catch {
    // 確認できないときは来院者側へ倒す（/mypage は自身で「確認できません」を表示する）。
  }
  redirect(destination);
}
