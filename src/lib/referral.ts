import type { SupabaseClient } from '@supabase/supabase-js';
import { safeCaptureException } from './safe';
import { alertCaughtError } from './alert';

/** 紹介CASと両者への既存ボーナスを一つのtransactionで保存。
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
