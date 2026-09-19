import type { SupabaseClient } from '@supabase/supabase-js';
import { safeCaptureException } from './safe';

/**
 * 被紹介者の初回予約完了時に紹介ボーナス（紹介者 500pt・被紹介者 300pt）を付与する。
 *
 * 背景（A-7 根治）: 紹介コードの適用（POST /api/referral）で即時付与していたため、実来店を伴わず
 * 捨てアカウントを量産してコードを適用するだけで、紹介者に 500pt/件 を無限発行できた
 * （1pt=1円で予約時に換金可能）。付与ゲートを「被紹介者の実予約完了」に移すことで、
 * 悪用に実来店・支払いのコストを課し金銭悪用を根絶する。予約完了の副作用は
 * applyCompletionSideEffects（lib/booking-completion）に集約されており、全完了経路
 * （complete / booking-checkout / booking-status）から本関数が1箇所で発火する。
 *
 * ポイントを先に冪等INSERTし、最後に points_awarded=false→true を更新する。途中の一方だけ
 * 成功しても、user_points の紹介ボーナス一意制約で再試行時に既存行を成功扱いできるため、
 * points_awarded=true の先行確定による永久ポイント欠落を防ぐ。
 */
export async function awardReferralPointsOnCompletion(
  admin: SupabaseClient,
  userId: string,
  bookingId?: string,
): Promise<void> {
  const { data: referralUse, error: referralUseErr } = await admin
    .from('referral_uses')
    .select('referrer_user_id')
    .eq('referred_user_id', userId)
    .eq('points_awarded', false)
    .maybeSingle();
  if (referralUseErr) {
    safeCaptureException(referralUseErr, 'referral-award-claim');
    throw new Error(`referral_uses read failed: ${referralUseErr.message}`);
  }
  if (!referralUse) return; // 未紹介、または既に付与済み

  const referrerId = (referralUse as { referrer_user_id: string }).referrer_user_id;
  const [refRes, selfRes] = await Promise.all([
    admin.from('user_points').insert({ user_id: referrerId, points: 500, reason: '紹介ボーナス', ...(bookingId ? { booking_id: bookingId } : {}) }),
    admin.from('user_points').insert({ user_id: userId, points: 300, reason: '紹介コード利用ボーナス', ...(bookingId ? { booking_id: bookingId } : {}) }),
  ]);
  const pointError = [refRes.error, selfRes.error].find((error) => error && error.code !== '23505');
  if (pointError) {
    safeCaptureException(pointError, 'referral-award-points');
    throw new Error(`referral points insert failed: ${pointError.message}`);
  }

  const { error: markErr } = await admin.from('referral_uses')
    .update({ points_awarded: true })
    .eq('referred_user_id', userId)
    .eq('points_awarded', false);
  if (markErr) {
    safeCaptureException(markErr, 'referral-award-mark');
    throw new Error(`referral_uses mark failed: ${markErr.message}`);
  }
}
