import { isAuthApiError, isAuthSessionMissingError, type User } from '@supabase/supabase-js';

export const AUTH_UNAVAILABLE_BODY = {
  code: 'AUTH_UNAVAILABLE',
  error: 'ログイン状態を確認できません。時間をおいて、同じ操作を再確認してください。',
};
export const AUTH_VERIFICATION_TIMEOUT_MS = 5000;

export type AuthVerification =
  | { state: 'verified'; user: User }
  | { state: 'unauthenticated' }
  | { state: 'unavailable' };

const INVALID_SESSION_CODES = new Set([
  'bad_jwt', 'session_not_found', 'session_expired',
  'refresh_token_not_found', 'refresh_token_already_used', 'user_not_found',
]);

/** Only an authoritative successful getUser result can grant access.
 * Unknown errors are NOT evidence of logout. Never inspect/log error messages.
 */
export function classifyAuthVerification(result: unknown): AuthVerification {
  if (!result || typeof result !== 'object' || !('data' in result)) {
    return { state: 'unavailable' };
  }
  const { data } = result;
  const error = 'error' in result ? result.error : undefined;
  if (!data || typeof data !== 'object' || !('user' in data)) return { state: 'unavailable' };
  if (error != null) {
    if (data.user !== null) return { state: 'unavailable' };
    if (isAuthSessionMissingError(error) && error.status === 400) return { state: 'unauthenticated' };
    if (isAuthApiError(error) && [400, 401, 403].includes(error.status) &&
        error.code !== undefined && INVALID_SESSION_CODES.has(error.code)) {
      return { state: 'unauthenticated' };
    }
    return { state: 'unavailable' };
  }
  if (data.user === null) return { state: 'unauthenticated' };
  if (typeof data.user !== 'object' || !('id' in data.user) ||
      typeof data.user.id !== 'string' || data.user.id.length === 0) return { state: 'unavailable' };
  return { state: 'verified', user: data.user as User };
}

export async function verifyAuthUser(auth: { getUser: () => Promise<unknown> }): Promise<AuthVerification> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = Date.now() + AUTH_VERIFICATION_TIMEOUT_MS;
  try {
    const response = await Promise.race([
      auth.getUser(),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), AUTH_VERIFICATION_TIMEOUT_MS); }),
    ]);
    return Date.now() >= deadline ? { state: 'unavailable' } : classifyAuthVerification(response);
  } catch {
    return { state: 'unavailable' };
  } finally {
    clearTimeout(timer);
  }
}
