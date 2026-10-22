import type { SupabaseClient } from '@supabase/supabase-js';
import { safeCaptureException } from './safe';
import { alertCaughtError } from './alert';

/** 紹介CASと両者への既存ボーナスを一つのtransactionで保存。
 * 紹介者が退会済みなら被紹介者の300ptだけを付与して確定する（以前は退会済みアカウントのロックで
 * 毎回失敗し、被紹介者に付与されないまま完了のたびに警報が鳴り続けた）。
 * 失敗は未付与のまま可視化し、本人・所属を再検証する完了APIのreplayで安全に復旧できる。
 */
export async function awardReferralPointsOnCompletion(admin: SupabaseClient, userId: string): Promise<void> {
  try {
    const { data, error } = await admin.rpc('award_referral_points_atomic', { p_user_id: userId });
    if (error) throw error;
    if (typeof data !== 'boolean') throw new Error('referral transaction result not confirmed');
  } catch (error) {
    safeCaptureException(error, 'referral-award-points');
    alertCaughtError('referral-award-points', error, 'booking-completion');
  }
}
