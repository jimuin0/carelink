import { NextResponse } from 'next/server';
import { z } from 'zod';
import { mutationRateLimit } from '@/lib/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { withRoute, serverError } from '@/lib/with-route';

export const dynamic = 'force-dynamic';

/**
 * マイページ「お知らせメール（クーポン・キャンペーン情報など）を受け取る」の切り替え。
 * PUT /api/profile/newsletter  { receive: boolean }（初期表示は下の GET）
 *
 * 🔴 ブラウザから profiles.email_unsubscribed を書き換えるだけでは、メールの配信停止リンクが
 * 作った newsletter_subscriptions の抑止行が残り、「再開しました」と表示されるのに
 * ニュースレターが二度と届かなかった（抑止行は本人から見えず、書き込み権も無い）。
 * 切り替えは service_role 専用の set_newsletter_preference_atomic で、profiles の旗と
 * 本人の確認済みログインメールの抑止行を 1 トランザクションでまとめて行う
 * （migration 20261022220000_newsletter_preference_atomic.sql）。
 */
const bodySchema = z.object({ receive: z.boolean() }).strict();
const receiptSchema = z.object({ success: z.literal(true), receive: z.boolean() });
const stateSchema = z.object({ receive: z.boolean() });

/**
 * GET /api/profile/newsletter → { receive: boolean }（トグルの初期表示）
 *
 * 🔴 profiles.email_unsubscribed だけでは「実際に届くか」が分からない。アカウント作成【前】に
 * 配信停止リンクで止めた宛先は、profiles の行がまだ無かったので旗が立たず、抑止行だけが残る。
 * 旗だけで表示すると「受け取る」に見えたまま届かず、本人には直す手がかりも無い。
 * get_newsletter_preference は旗と、本人の確認済みログインメールの抑止行の両方から決める
 * （set_newsletter_preference_atomic が外せる宛先と同じなので、ON を 1 回押せば表示も配信も戻る）。
 */
export const GET = withRoute(async (_request, ctx) => {
  const { data, error } = await createServiceRoleClient().rpc('get_newsletter_preference', {
    p_user_id: ctx.user!.id,
  });
  if (error) {
    if (error.message === 'NEWSLETTER_PREFERENCE_PROFILE_MISSING') {
      return NextResponse.json({ error: 'プロフィールを確認できません。再読み込みしても解消しない場合はお問い合わせください。' }, { status: 409 });
    }
    return serverError('profile-newsletter-get', new Error('Newsletter preference read failed', { cause: error }), '/api/profile/newsletter', '設定を取得できませんでした');
  }
  const state = stateSchema.safeParse(data);
  if (!state.success) {
    return serverError('profile-newsletter-get-state', new Error('Invalid newsletter preference state'), '/api/profile/newsletter', '設定を取得できませんでした');
  }
  return NextResponse.json({ receive: state.data.receive });
}, {
  csrf: false,
  requireAuth: true,
  rateLimit: { limiter: mutationRateLimit, limit: 30, windowMs: 60_000, prefix: 'profile-newsletter-get' },
  sentryTag: 'profile-newsletter-get',
});

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
