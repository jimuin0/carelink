import { readAuthorization } from './authorization-read';
import { NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { createServerSupabaseAuthClient } from './supabase-server-auth';
import { verifyAuthUser } from './auth-verification';
import { authUnavailable } from './with-route';
import { adminForbidden, adminUnauthenticated } from './admin-denial';

type PlatformAdminResolution = User | 'unauthenticated' | 'forbidden' | NextResponse;

/** 未ログインと「ログイン済みだが運営権限が無い」を区別して返す（判定はここだけ）。 */
async function resolvePlatformAdmin(): Promise<PlatformAdminResolution> {
  try {
    const supabase = await createServerSupabaseAuthClient();
    const identity = await verifyAuthUser(supabase.auth);
    if (identity.state === 'unavailable') return authUnavailable('platform-admin-access', '/api/admin');
    if (identity.state === 'unauthenticated') return 'unauthenticated';
    const { data: profile, error } = await readAuthorization(supabase
      .from('profiles').select('is_platform_admin').eq('id', identity.user.id).maybeSingle());
    if (error) return authUnavailable('platform-admin-access', '/api/admin');
    if (profile?.is_platform_admin !== true) return 'forbidden';
    return identity.user;
  } catch {
    return authUnavailable('platform-admin-access', '/api/admin');
  }
}

/** Fresh platform privilege is required; null is an authoritative denial.
 * Dependency failures return a response that every caller must propagate.
 * 画面（layout・page）は null を 404 にする。API は requirePlatformAdminApi を使う。 */
export async function requirePlatformAdmin(): Promise<User | null | NextResponse> {
  const result = await resolvePlatformAdmin();
  return result === 'unauthenticated' || result === 'forbidden' ? null : result;
}

/**
 * 管理 API 用。拒否は応答にして返す：未ログイン＝401、ログイン済みで権限なし＝403（点検 A205）。
 * 呼び出し側は `if (user instanceof NextResponse) return user;` だけ書けばよい。
 */
export async function requirePlatformAdminApi(init: { headers?: HeadersInit; body?: Record<string, unknown> } = {}): Promise<User | NextResponse> {
  const result = await resolvePlatformAdmin();
  if (result === 'unauthenticated') return adminUnauthenticated(init);
  if (result === 'forbidden') return adminForbidden(init);
  return result;
}
