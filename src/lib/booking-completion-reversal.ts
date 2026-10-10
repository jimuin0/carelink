import type { SupabaseClient } from '@supabase/supabase-js';

/** 来店ポイント取消は booking_points_atomic が履歴を消さず補償行で原子的に保存する。 */
export async function reverseCompletionSideEffects(_admin: SupabaseClient, _bookingId: string): Promise<void> {
  // Retained compatibility helper; no second write after the status transaction.
}
