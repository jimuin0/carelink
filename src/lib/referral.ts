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
 * points_awarded の CAS（false→true を単一 UPDATE で確定）により、複数の完了経路・複数回の完了でも
 * 二重付与しない（0 行更新＝未紹介 or 付与済みで早期 return）。付与 insert が失敗した場合は
 * referral_uses が points_awarded=true のまま残るため、Sentry で可視化し運用復旧する
 * （referral 適用時の従来運用と同じ前提）。fire-and-forget で完了本体を妨げない。
 */
export async function awardReferralPointsOnCompletion(
  admin: SupabaseClient,
  userId: string,
): Promise<void> {
  // 未付与(points_awarded=false)の紹介記録を CAS で確定する。1経路のみ 1 行を取得できる。
  const { data: claimed, error: claimErr } = await admin
    .from('referral_uses')
    .update({ points_awarded: true })
    .eq('referred_user_id', userId)
    .eq('points_awarded', false)
    .select('referrer_user_id');
  if (claimErr) {
    safeCaptureException(claimErr, 'referral-award-claim');
    return;
  }
  if (!claimed || claimed.length === 0) return; // 未紹介、または既に付与済み

  const referrerId = (claimed[0] as { referrer_user_id: string }).referrer_user_id;
  const [refRes, selfRes] = await Promise.all([
    admin.from('user_points').insert({ user_id: referrerId, points: 500, reason: '紹介ボーナス' }),
    admin.from('user_points').insert({ user_id: userId, points: 300, reason: '紹介コード利用ボーナス' }),
  ]);
  if (refRes.error || selfRes.error) {
    // referral_uses は points_awarded=true 済み。付与失敗は Sentry で可視化し運用復旧する。
    safeCaptureException(refRes.error ?? selfRes.error, 'referral-award-points');
  }
}
