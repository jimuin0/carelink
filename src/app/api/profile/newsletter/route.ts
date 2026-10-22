import { NextResponse } from 'next/server';
import { z } from 'zod';
import { mutationRateLimit } from '@/lib/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { withRoute, serverError } from '@/lib/with-route';

export const dynamic = 'force-dynamic';

/**
 * マイページ「お知らせメール（クーポン・キャンペーン情報など）を受け取る」の切り替え。
 * PUT /api/profile/newsletter  { receive: boolean }
 *
 * 🔴 ブラウザから profiles.email_unsubscribed を書き換えるだけでは、メールの配信停止リンクが
 * 作った newsletter_subscriptions の抑止行が残り、「再開しました」と表示されるのに
 * ニュースレターが二度と届かなかった（抑止行は本人から見えず、書き込み権も無い）。
 * 切り替えは service_role 専用の set_newsletter_preference_atomic で、profiles の旗と
 * 本人の確認済みログインメールの抑止行を 1 トランザクションでまとめて行う
 * （migration 20261022180000_newsletter_preference_atomic.sql）。
 */
const bodySchema = z.object({ receive: z.boolean() }).strict();
const receiptSchema = z.object({ success: z.literal(true), receive: z.boolean() });

export const PUT = withRoute(async (request, ctx) => {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  const { data, error } = await createServiceRoleClient().rpc('set_newsletter_preference_atomic', {
    p_user_id: ctx.user!.id,
    p_receive: parsed.data.receive,
  });
  if (error) {
    if (error.message === 'NEWSLETTER_PREFERENCE_PROFILE_MISSING') {
      return NextResponse.json({ error: 'プロフィールを確認できません。設定は変更されていません。再読み込みしても解消しない場合はお問い合わせください。' }, { status: 409 });
    }
    return serverError('profile-newsletter', new Error('Newsletter preference update failed', { cause: error }), '/api/profile/newsletter', '設定の変更に失敗しました');
  }
  const receipt = receiptSchema.safeParse(data);
  if (!receipt.success || receipt.data.receive !== parsed.data.receive) {
    return serverError('profile-newsletter-receipt', new Error('Invalid newsletter preference receipt'), '/api/profile/newsletter', '設定の変更結果を確認できません。再読み込みして確認してください');
  }
  return NextResponse.json({ success: true, receive: receipt.data.receive });
}, {
  csrf: true,
  requireAuth: true,
  rateLimit: { limiter: mutationRateLimit, limit: 10, windowMs: 60_000, prefix: 'profile-newsletter' },
  sentryTag: 'profile-newsletter',
});
