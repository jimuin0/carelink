import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database-overrides';

export async function readPointsBalance(client: SupabaseClient<Database>, userId: string): Promise<number> {
  const { data, error } = await client.rpc('get_user_points_balance', { p_user_id: userId });
  if (error || typeof data !== 'number' || !Number.isSafeInteger(data)) {
    throw new Error('POINTS_BALANCE_UNAVAILABLE');
  }
  return data;
}
