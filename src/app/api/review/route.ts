/**
 * レビュー投稿 API（v8.22）
 * POST /api/review
 * クライアントから直接Supabaseに書き込む代わりにAPIを経由してIPを記録
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkCsrf } from '@/lib/csrf';
import { mutationRateLimit, checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { verifyRecaptcha } from '@/lib/recaptcha';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { sendPushToFacilityOwners } from '@/lib/push';
import { sendNewReviewNotification } from '@/lib/email';
import { getFacilityNotificationSettings } from '@/lib/notification-settings';
import { safeCaptureException } from '@/lib/safe';
import { alertCaughtError } from '@/lib/alert';
import { isAllowedStorageUrl } from '@/lib/storage-url-guard';

export const dynamic = 'force-dynamic';

const ratingAxis = z.number().int().min(1).max(5);

const reviewSchema = z.object({
  facility_id: z.string().uuid(),
  recaptcha_token: z.string().optional(),
  reviewer_name: z.string().min(1).max(50),
  rating_skill: ratingAxis,
  rating_service: ratingAxis,
  rating_atmosphere: ratingAxis,
  rating_cleanliness: ratingAxis,
  rating_explanation: ratingAxis,
  comment: z.string().max(500).optional().nullable(),
  // 【2026年7月8日 恒久根治】従来は .url().startsWith('https://') のみで任意のHTTPS URLを許容して
  // おり、api/salons が実装する自Storage公開URLプレフィックス限定チェックより検証が緩かった。
  // next.config の remotePatterns（自Supabase Storage と images.unsplash.com のみ許可）に守られて
  // はいるが、許可済みホスト向けなら任意画像のホットリンクが可能で同水準の出所検証が欠けていた。
  // レビュー写真は review-photos バケットにのみアップロードされる（ReviewForm.tsx）契約のため、
  // そのバケットの公開URLプレフィックス以外は拒否する。
  photo_urls: z.array(z.string().url().startsWith('https://')).max(3).optional().nullable()
    .refine(
      (urls) => !urls || urls.every((u) => isAllowedStorageUrl(u, 'review-photos')),
      '不正な写真URLです'
    ),
});

export async function POST(request: Request) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(mutationRateLimit, ip, 5, 60_000, 'review')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: '入力内容が不正です' }, { status: 400 });
  }

  // reCAPTCHA v3 検証（fail-closed: secret設定時=本番はtoken必須）
  // ★ 旧実装は `if (token && secret)` でtoken省略時に検証全体を素通り（fail-open）させていた。
  //   recaptcha_token は zod で .optional() のため、攻撃者がtokenを送らないだけでBot検証を
  //   完全バイパスできた。secretが設定されている環境ではtokenを必須化し、欠如・検証失敗の
  //   双方を403で遮断する（発症前予防・fail-closed）。secret未設定の開発環境のみスキップ。
  if (process.env.RECAPTCHA_SECRET_KEY) {
    if (!parsed.data.recaptcha_token) {
      return NextResponse.json({ error: 'Bot検知: 時間をおいて再度お試しください' }, { status: 403 });
    }
    const captcha = await verifyRecaptcha(parsed.data.recaptcha_token, 'review', 0.4);
    if (!captcha.success) {
      return NextResponse.json({ error: 'Bot検知: 時間をおいて再度お試しください' }, { status: 403 });
    }
  }

  const cookieStore = await cookies();
  // auth.getUser() は anon key クライアントで行う（service role でも動作するが設計上分離）
  const authClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );
  const supabase = createServiceRoleClient();

  const { data: { user } } = await authClient.auth.getUser();

  // 24h内に同一施設への投稿チェック。
  // facility_reviews に user_id 列は存在しない（設計上一度も追加されていない）ため、
  // ログイン有無を問わず reviewer_ip で判定する（reviewer_ip は投稿時に常に保存される）。
  // 旧実装はログイン時に user_id で絞っており、存在しない列参照で 400 → 重複防止が無効だった。
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recent } = await supabase
    .from('facility_reviews')
    .select('id')
    .eq('facility_id', parsed.data.facility_id)
    .eq('reviewer_ip', ip)
    .gte('created_at', since)
    .limit(1);
  if (recent && recent.length > 0) {
    return NextResponse.json({ error: '同じ施設への口コミは24時間に1回までです' }, { status: 429 });
  }

  // 来店確認
  let isVerifiedVisit = false;
  if (user) {
    const { data: completedBooking } = await supabase
      .from('bookings')
      .select('id')
      .eq('facility_id', parsed.data.facility_id)
      .eq('user_id', user.id)
      .eq('status', 'completed')
      .limit(1);
    isVerifiedVisit = (completedBooking?.length ?? 0) > 0;
  }

  const avg = Math.round(
    (parsed.data.rating_skill + parsed.data.rating_service + parsed.data.rating_atmosphere +
      parsed.data.rating_cleanliness + parsed.data.rating_explanation) / 5
  );

  const { data: review, error } = await supabase
    .from('facility_reviews')
    .insert({
      facility_id: parsed.data.facility_id,
      reviewer_name: parsed.data.reviewer_name,
      rating: avg,
      rating_skill: parsed.data.rating_skill,
      rating_service: parsed.data.rating_service,
      rating_atmosphere: parsed.data.rating_atmosphere,
      rating_cleanliness: parsed.data.rating_cleanliness,
      rating_explanation: parsed.data.rating_explanation,
      comment: parsed.data.comment || null,
      photo_urls: parsed.data.photo_urls?.length ? parsed.data.photo_urls : null,
      reviewer_ip: ip,
      // facility_reviews.user_id は投稿者本人によるレビュー編集・削除の判定に使う
      // （2026年7月6日DDL追加、ALTER TABLE facility_reviews ADD COLUMN user_id）。
      ...(user ? { user_id: user.id, is_verified_visit: isVerifiedVisit } : {}),
    })
    .select('id')
    .single();

  if (error) {
    return NextResponse.json({ error: '投稿に失敗しました' }, { status: 500 });
  }

  // ポイント付与（fire-and-forget）— 来店確認済み(completed 予約あり)のユーザーに限る。
  // is_verified_visit が false の口コミにもポイントを付けると、来店実績ゼロのまま複数施設へ
  // 投稿して 50pt×施設数 を稼ぐポイントファーミング（換金可能）が成立する。付与を来店者限定に
  // することで、算出済みの来店確認フラグを実際のゲートとして機能させ、悪用を根本から断つ。
  // 監査D4: 従来は review.id 単位の dedup だったため、同一ユーザーが同一施設に二重投稿すると
  // review.id が異なり 50pt×2 のポイントファーミングが成立した（換金可能）。dedup キーを
  // 施設単位（user_id × facility_id）に変え、1ユーザー・1施設あたり口コミポイントは1回のみにする。
  // TOCTOU（select→insert 非原子）による同時二重投稿は、DB 側の部分 UNIQUE インデックス
  // uq_user_points_review（別途 SQL を神原さんへ提示）で最終的に閉じる。
  // レスポンス返却後に走らせる副作用（ポイント付与・Push・メール）をここに集約し、
  // return の直前に await Promise.allSettled でまとめて完了させる。
  // 【重要・2026年7月7日 本番実データで確定した恒久根治】
  //   従来は各副作用を Vercel の waitUntil() に渡す fire-and-forget だったが、Fluid Compute が
  //   無効の本番では関数がレスポンス返却直後に凍結され、waitUntil のバックグラウンド処理が
  //   一切完走していなかった。Resend の全送信履歴を照会したところ、ローンチ(2026年4月)以来
  //   waitUntil 経由の通知メール(口コミ通知・予約確認等)は1通も送信されておらず、cron
  //   (ニュースレター)と手動テストのみが配信されていた＝waitUntil 後処理が全滅していた。
  //   よってレスポンス前に await して確実に実行する(各 send は safeSend の 10s タイムアウトで
  //   保護され、失敗しても Promise.allSettled で握り、本体レスポンスは常に成功で返す)。
  const reviewSideEffects: Promise<unknown>[] = [];

  if (user && review && isVerifiedVisit) {
    const reviewReason = `口コミポイント:${parsed.data.facility_id}`;
    reviewSideEffects.push((async () => {
      const { data: existing, error: selectErr } = await supabase.from('user_points')
        .select('id')
        .eq('user_id', user.id)
        .eq('reason', reviewReason)
        .limit(1);
      if (selectErr) {
        console.error('[review] points dedup check failed', { userId: user.id, reviewId: review.id, err: selectErr });
        return;
      }
      if (!existing || existing.length === 0) {
        const { error: insertErr } = await supabase.from('user_points').insert({
          user_id: user.id,
          points: 50,
          reason: reviewReason,
        });
        if (insertErr) console.error('[review] points insert failed', { userId: user.id, reviewId: review.id, err: insertErr });
      }
    })());
  }

  // 施設オーナーへの口コミ投稿 Push + メール（non-blocking）。施設の通知設定 push_on_review で
  // 両方を共通制御する（設定画面のトグルが一つで足り、後から個別設定を増やす場合は容易に分離できる）。
  // 旧実装は口コミ投稿時に店への通知が一切無く、設定トグルが効かない飾りだった。
  try {
    const notif = await getFacilityNotificationSettings(parsed.data.facility_id);
    if (notif.pushOnReview) {
      reviewSideEffects.push(
        sendPushToFacilityOwners(parsed.data.facility_id, {
          title: '新しい口コミが投稿されました',
          body: `${parsed.data.reviewer_name}様より★${avg}の口コミが届きました`,
          url: '/admin/reviews',
          tag: `review-${review.id}`,
        }).catch((e) => {
          console.error('[review] push failed', e);
          safeCaptureException(e, 'review-push');
          alertCaughtError('review-push', e, '/api/review');
        })
      );

      const { data: ownerRows } = await supabase
        .from('facility_members')
        .select('user_id')
        .eq('facility_id', parsed.data.facility_id)
        .eq('role', 'owner');
      const ownerUserIds = Array.from(new Set((ownerRows ?? []).map((o) => o.user_id).filter(Boolean)));
      if (ownerUserIds.length > 0) {
        const { data: ownerProfiles } = await supabase.from('profiles').select('email').in('id', ownerUserIds);
        const ownerEmails = Array.from(new Set(
          ((ownerProfiles ?? []) as { email: string | null }[]).map((p) => p.email).filter(Boolean) as string[]
        ));
        const { data: facilityRow } = await supabase
          .from('facility_profiles')
          .select('name')
          .eq('id', parsed.data.facility_id)
          .single();
        for (const facilityEmail of ownerEmails) {
          reviewSideEffects.push(
            sendNewReviewNotification({
              facilityEmail,
              facilityName: facilityRow?.name ?? '',
              reviewerName: parsed.data.reviewer_name,
              rating: avg,
              comment: parsed.data.comment,
            }).then((ok) => {
              if (!ok) {
                const err = new Error('new review notification email send failed');
                safeCaptureException(err, 'review-email');
                alertCaughtError('review-email', err, '/api/review');
              }
            }).catch((e) => {
              safeCaptureException(e, 'review-email');
              alertCaughtError('review-email', e, '/api/review');
            })
          );
        }
      }
    }
  } catch (e) {
    console.error('[review] push/email setup failed', e);
    safeCaptureException(e, 'review-push-setup');
    alertCaughtError('review-push-setup', e, '/api/review');
  }

  // レスポンス返却前に副作用を確実に完了させる（上のコメント参照＝waitUntil 後処理が本番で
  // 全滅していた恒久根治）。allSettled なので個別失敗は本体レスポンス(200)に影響しない。
  await Promise.allSettled(reviewSideEffects);

  return NextResponse.json({ success: true, id: review.id });
}
