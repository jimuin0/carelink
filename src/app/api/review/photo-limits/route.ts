import { verifyAuthUser } from '@/lib/auth-verification';
import { NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { withRoute, authUnavailable } from '@/lib/with-route';
import { readReviewPhotoLimits } from '@/lib/review-photo-limits';

export const dynamic = 'force-dynamic';
export const GET = withRoute(async () => {
  const auth = await createServerSupabaseAuthClient();
  const verification = await verifyAuthUser(auth.auth);
  if (verification.state === 'unavailable') return authUnavailable('review-photo-limits-auth', '/api/review/photo-limits');
  const user = verification.state === 'verified' ? verification.user : null;
  if (!user) return NextResponse.json({ error: '写真投稿にはログインが必要です' }, { status: 401 });
  const limits = await readReviewPhotoLimits(createServiceRoleClient());
  return NextResponse.json(limits ?? { error: '写真の保存設定を確認できません。入力と元写真を保持して、時間をおいて再確認してください。' },
    { status: limits ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}, { csrf: false, rateLimit: { limiter: null, limit: 20, windowMs: 60_000, prefix: 'review-photo-limits' }, sentryTag: 'review-photo-limits' });
