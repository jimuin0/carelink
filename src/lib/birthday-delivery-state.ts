import type { createServiceRoleClient } from './supabase-server';
type Database = ReturnType<typeof createServiceRoleClient>;

/** A stale pending row can be a lost provider acknowledgement. Never infer
 * delivery or automatically remove it; report it until an operator reconciles. */
export async function countBirthdayDeliveryHolds(db: Database, before: string): Promise<number | null> {
  try {
    const result = await db.from('birthday_notifications').select('user_id', { count: 'exact', head: true })
      .eq('delivery_state', 'pending').lt('notified_at', before);
    return result.error === null && typeof result.count === 'number' ? result.count : null;
  } catch { return null; }
}

/** A missing acknowledgement leaves the pending row intact for reconciliation. */
export async function markBirthdayDeliveryAccepted(db: Database, userId: string, year: number, claimTime: string): Promise<boolean> {
  try {
    const result = await db.from('birthday_notifications').update({ delivery_state: 'delivered' })
      .eq('user_id', userId).eq('year', year).eq('channel', 'email').eq('notified_at', claimTime).eq('delivery_state', 'pending').select('user_id');
    return result.error === null && Array.isArray(result.data) && result.data.length === 1 && result.data[0].user_id === userId;
  } catch { return false; }
}
