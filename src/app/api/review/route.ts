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
import { findMedicalAdViolations } from '@/lib/medical-ad-guard';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { sendPushToFacilityOwners } from '@/lib/push';
import { sendNewReviewNotification } from '@/lib/email';
import { getFacilityNotificationSettings } from '@/lib/notification-settings';
import { safeCaptureException } from '@/lib/safe';
import { alertCaughtError } from '@/lib/alert';
import { serverError } from '@/lib/with-route';
import { isAllowedStorageUrl } from '@/lib/storage-url-guard';
import { verifyAuthUser } from '@/lib/auth-verification';
import { verifyReviewPhotos } from '@/lib/review-photo-verification';
import { adminFacilityHref } from '@/lib/admin-facility-url';

export const dynamic = 'force-dynamic';

const ratingAxis = z.number().int().min(1).max(5);

const reviewSchema = z.object({
  facility_id: z.string().uuid(),
  recaptcha_token: z.string().optional(),
  // .trim(): 前後空白を除去してから長さを検証・保存する（スペースのみの入力を弾く恒久対応）。
  reviewer_name: z.string().trim().min(1).max(50),
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
  // 投稿フォームが作る操作 ID（2026年10月23日）。送信結果が分からなかった投稿を同じ ID で
  // 送り直すと、前回の口コミが保存済みならそれを返し、新しい口コミは作らない（二重投稿なしのやり直し）。
  // 旧フォームは送らないので任意。
  operation_id: z.string().uuid().optional(),
});

const DUPLICATE_ERROR = '同じ施設への口コミは24時間に1回までです';
const OPERATION_INDEX = 'uq_facility_reviews_client_operation';

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

/** この操作 ID で保存済みの口コミ（無ければ null）。 */
async function findOperationReview(supabase: ServiceClient, operationId: string) {
  return supabase.from('facility_reviews').select('id, facility_id')
    .eq('client_operation_id', operationId).maybeSingle();
}

/** 前回の送信で保存済みだった口コミを返す（新しい口コミは作らない・店舗への通知も送り直さない）。 */
function replayed(id: string) {
  return NextResponse.json({ success: true, id, replayed: true });
}

/**
 * commit.unknown … INSERT を試みて結果が確定していない（応答の欠落・原因不明のエラー）。
 * これが false の応答だけが「この送信では保存していない」とクライアントに言える。
 */
async function submitReview(request: Request, commit: { unknown: boolean }) {
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
  // Compatibility evidence only; this header is not an identity credential.
  // Old photo forms cannot prove whether an omitted image was intentionally
  // unselected or silently lost. Keep their memory and refuse before mutation.
  if (request.headers.get('X-CareLink-Review-Consumer') !== '1') {
    return NextResponse.json({ code: 'REVIEW_CONSUMER_RELOAD_REQUIRED',
      error: 'この口コミ画面では写真と投稿結果の確認ができません。投稿は行っていません。入力を控えてから、口コミ投稿画面を開き直してください。' }, { status: 409 });
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

  const identity = await verifyAuthUser(authClient.auth);
  if (identity.state === 'unavailable') return NextResponse.json({ error: 'ログイン状態を確認できません。入力を保持して再確認してください。' }, { status: 503 });
  const user = identity.state === 'verified' ? identity.user : null;
  const operationId = parsed.data.operation_id ?? null;
  if (operationId) {
    const { data: earlier, error: earlierError } = await findOperationReview(supabase, operationId);
    if (earlierError) return serverError('review-operation-read', earlierError, '/api/review', '前回の投稿の受付状況を確認できません');
    if (earlier) {
      if (earlier.facility_id !== parsed.data.facility_id) {
        return NextResponse.json({ code: 'REVIEW_OPERATION_CONFLICT', error: '前回の投稿と施設が一致しません。画面を開き直してください。' }, { status: 409 });
      }
      return replayed(earlier.id);
    }
  }
  const photoState = await verifyReviewPhotos(supabase, user?.id ?? null, parsed.data.facility_id, parsed.data.photo_urls);
  if (photoState !== 'ready') return NextResponse.json({ error: '写真の保存・所有権を確認できません。入力と元写真を保持して再確認してください。' },
    { status: photoState === 'unavailable' ? 503 : 400 });

  // 【2026年10月22日 神原さん決定】公開する投稿者名は、投稿フォームに本人が入力した名前
  // （ニックネーム可）をそのまま使う。
  // 以前（2026年7月29日〜）はログイン済みユーザーの入力を profiles.display_name で黙って
  // 置き換えていた。フォームには「ニックネーム可」と書いてあるのに、公開ページには登録名
  // （多くは本名）が出てしまい、本人の意図しない実名公開になっていた。
  // なりすまし対策は名前の置き換えではなく表示側で行う：アカウントに紐づく投稿（user_id あり）は
  // public_reviews.is_member を通じて口コミ一覧に「会員」バッジが付く（user_id 自体は公開しない）。
  const effectiveReviewerName = parsed.data.reviewer_name;

  // 24h内に同一施設への投稿チェック（DB のトリガ lock_review_submission も同じ条件で確かめる）。
  // 同じ IP からの投稿に加え、ログイン中は同じアカウントからの投稿も数える（2026年10月23日）。
  // 以前は IP だけで判定していたため、ログイン中の会員が回線を切り替えるだけで、同じアカウントから
  // 「来店確認済み」の口コミを何件でも重ねられた。user_id 列は 2026年7月6日に追加済み
  // （以前ここにあった「user_id 列は存在しない」という説明は誤り）。未ログインは IP だけで判定する。
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const recentBy = (column: 'reviewer_ip' | 'user_id', value: string) => supabase
    .from('facility_reviews')
    .select('id')
    .eq('facility_id', parsed.data.facility_id)
    .eq(column, value)
    .gte('created_at', since)
    .limit(1);
  const recentChecks = await Promise.all([recentBy('reviewer_ip', ip), ...(user ? [recentBy('user_id', user.id)] : [])]);
  const recentError = recentChecks.find((check) => check.error)?.error;
  if (recentError) return serverError('review-duplicate-read', recentError, '/api/review', '投稿履歴を確認できません');
  if (recentChecks.some((check) => (check.data?.length ?? 0) > 0)) {
    return NextResponse.json({ code: 'REVIEW_RECENT_DUPLICATE', error: DUPLICATE_ERROR }, { status: 429 });
  }

  // 来店確認
  let isVerifiedVisit = false;
  if (user) {
    const { data: completedBooking, error: bookingError } = await supabase
      .from('bookings')
      .select('id')
      .eq('facility_id', parsed.data.facility_id)
      .eq('user_id', user.id)
      .eq('status', 'completed')
      .limit(1);
    if (bookingError) return serverError('review-visit-read', bookingError, '/api/review', '来店履歴を確認できません');
    isVerifiedVisit = (completedBooking?.length ?? 0) > 0;
  }

  const avg = Math.round(
    (parsed.data.rating_skill + parsed.data.rating_service + parsed.data.rating_atmosphere +
      parsed.data.rating_cleanliness + parsed.data.rating_explanation) / 5
  );

  // 【2026年7月28日】医療広告ガイドライン上の禁止表現（「必ず治る」「日本一」等）を含む
  // 口コミは is_flagged を立てて公開前に運営の審査へ回す。
  // 施設の PR 文言と違って投稿を拒否しないのは、来院者の善意の投稿を誤検知で弾かないため。
  // 医療機関では体験談の掲載自体が制限されるため、検知した口コミは必ず人が判断する。
  const medicalAdViolations = findMedicalAdViolations(parsed.data.comment);

  commit.unknown = true;
  const { data: review, error } = await supabase
    .from('facility_reviews')
    .insert({
      facility_id: parsed.data.facility_id,
      reviewer_name: effectiveReviewerName,
      rating: avg,
      rating_skill: parsed.data.rating_skill,
      rating_service: parsed.data.rating_service,
      rating_atmosphere: parsed.data.rating_atmosphere,
      rating_cleanliness: parsed.data.rating_cleanliness,
      rating_explanation: parsed.data.rating_explanation,
      comment: parsed.data.comment || null,
      photo_urls: parsed.data.photo_urls?.length ? parsed.data.photo_urls : null,
      reviewer_ip: ip,
      ...(medicalAdViolations.length > 0 ? { is_flagged: true,
        flag_reason: `医療広告ガイドラインの禁止表現: ${medicalAdViolations.map(v => v.term).join('、')}` } : {}),
      // facility_reviews.user_id は投稿者本人によるレビュー編集・削除の判定に使う
      // （2026年7月6日DDL追加、ALTER TABLE facility_reviews ADD COLUMN user_id）。
      ...(user ? { user_id: user.id, is_verified_visit: isVerifiedVisit } : {}),
      ...(operationId ? { client_operation_id: operationId } : {}),
    })
    .select('id')
    .single();

  if (error) {
    const duplicate = error.code === 'P0001' && error.message === 'REVIEW_RECENT_DUPLICATE';
    // 同じ操作 ID の送信が並んで届いた（前回の応答待ちの間に送り直した）。先に保存された方を返す。
    const operationTaken = error.code === '23505' && String(error.message).includes(OPERATION_INDEX);
    if (operationId && (duplicate || operationTaken)) {
      const { data: earlier } = await findOperationReview(supabase, operationId);
      if (earlier && earlier.facility_id === parsed.data.facility_id) return replayed(earlier.id);
    }
    if (duplicate) {
      // トリガが投稿を拒んだ＝このトランザクションは巻き戻っている（保存されていないことが確定）。
      commit.unknown = false;
      return NextResponse.json({ code: 'REVIEW_RECENT_DUPLICATE', error: DUPLICATE_ERROR }, { status: 429 });
    }
    return serverError('review-insert', error, '/api/review', '投稿に失敗しました');
  }

  // 投稿・来店確認済みポイント・審査投入はDBトリガーで同時に確定する。
  // エラー時は投稿も巻き戻る。通信結果不明のときは再投稿を案内しない。
  // 外部通知は保存後に待ち合わせる（DBの確定とは区別する）。
  const reviewSideEffects: Promise<unknown>[] = [];

  // 施設オーナーへの口コミ投稿 Push + メール（non-blocking）。Push は push_on_review、メールは
  // email_on_review で【別々に】制御する。以前は push_on_review が両方を囲っていたため、
  // 『口コミ投稿（Push通知）』を OFF にすると表記に無いメールまで黙って止まった（2026年10月23日 分離）。
  // 同じ画面の『新規予約（Push通知）』『キャンセル（Push通知）』も Push だけを止める。
  // 旧実装は口コミ投稿時に店への通知が一切無く、設定トグルが効かない飾りだった。
  try {
    const notif = await getFacilityNotificationSettings(parsed.data.facility_id);
    if (notif.pushOnReview) {
      reviewSideEffects.push(
        sendPushToFacilityOwners(parsed.data.facility_id, {
          title: '新しい口コミが投稿されました',
          body: `${effectiveReviewerName}様より★${avg}の口コミが届きました${medicalAdViolations.length > 0 ? '（運営の確認後に公開されます）' : ''}`,
          // 複数店舗を持つオーナーが別の店舗の口コミ画面を開かないよう、店舗を URL で指定する。
          url: adminFacilityHref('/admin/reviews', parsed.data.facility_id),
          tag: `review-${review.id}`,
        }).catch((e) => {
          console.error('[review] push failed', e);
          safeCaptureException(e, 'review-push');
          alertCaughtError('review-push', e, '/api/review');
        })
      );
    }
    if (notif.emailOnReview) {
      // role は push.ts(sendPushToFacilityOwners) と揃え owner に加え admin も対象にする
      // （2026年7月17日 恒久根治：admin ロールは Push は受け取るがメール通知は owner 限定のため
      // 受け取れない非対称があった）。
      const { data: ownerRows } = await supabase
        .from('facility_members')
        .select('user_id')
        .eq('facility_id', parsed.data.facility_id)
        .in('role', ['owner', 'admin']);
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
              reviewerName: effectiveReviewerName,
              rating: avg,
              comment: parsed.data.comment,
              facilityId: parsed.data.facility_id,
              pendingModeration: medicalAdViolations.length > 0,
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

export async function POST(request: Request) {
  const commit = { unknown: false };
  const response = await submitReview(request, commit);
  // Only a refusal whose commit is settled (before any INSERT, or a trigger
  // rollback) may say "not saved". An insert error can be a lost commit reply.
  if (!commit.unknown && !response.ok) response.headers.set('X-CareLink-Review-Commit', 'not-started');
  return response;
}
