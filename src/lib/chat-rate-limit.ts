import { createServiceRoleClient } from './supabase-server';

export const CHAT_DAILY_DEFAULT_LIMIT = 100;
export const CHAT_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
export type ChatLimitResult = 'allowed' | 'limited' | 'unavailable';

export function chatUsageCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** Paid calls cannot fall back to an instance-local, resettable counter. */
export async function checkChatLimit(key: string, limit: number, windowMs: number): Promise<ChatLimitResult> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let active = true;
  const deadline = Date.now() + 3000;
  try {
    const db = createServiceRoleClient();
    const operation = async () => {
      if (key === 'chat-daily:global') {
        const capability = await db.rpc('chat_quota_retention_version');
        if (capability.error || capability.data !== 1) throw new Error('chat quota retention unconfirmed');
      }
      // A delayed timer callback is not permission to start a new reservation.
      if (!active || Date.now() >= deadline) throw new Error('chat quota verification expired');
      return await db.rpc('check_rate_limit', { p_key: key, p_limit: limit, p_window_ms: windowMs });
    };
    const result = await Promise.race([
      operation(),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('chat quota unavailable')), 3000); }),
    ]);
    if (Date.now() >= deadline || result.error || typeof result.data !== 'boolean') return 'unavailable';
    return result.data ? 'limited' : 'allowed';
  } catch {
    return 'unavailable';
  } finally {
    active = false;
    clearTimeout(timeout);
  }
}

export function chatDailyLimit(raw: string | undefined): number | null {
  if (raw === undefined || raw === '') return CHAT_DAILY_DEFAULT_LIMIT;
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const limit = Number(raw);
  return Number.isSafeInteger(limit) && limit <= 100000 ? limit : null;
}
