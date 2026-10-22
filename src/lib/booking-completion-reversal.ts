import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 来店ポイント取消は booking_points_atomic が履歴を消さず補償行で原子的に保存する。
 * 紹介ボーナス（紹介者500pt・被紹介者300pt）も、完了した予約が1件も残らなくなったときに
 * 同じtransactionで補償行を入れて取り消す（トリガ booking_referral_bonus_reversal）。
 */
export async function reverseCompletionSideEffects(_admin: SupabaseClient, _bookingId: string): Promise<void> {
  // Retained compatibility helper; no second write after the status transaction.
}
