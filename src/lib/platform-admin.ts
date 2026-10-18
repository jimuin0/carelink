import { readAuthorization } from './authorization-read';
import { NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { createServerSupabaseAuthClient } from './supabase-server-auth';
import { verifyAuthUser } from './auth-verification';
import { authUnavailable } from './with-route';

/** Fresh platform privilege is required; null is an authoritative denial.
 * Dependency failures return a response that every caller must propagate. */
export async function requirePlatformAdmin(): Promise<User | null | NextResponse> {
  try {
    const supabase = await createServerSupabaseAuthClient();
    const identity = await verifyAuthUser(supabase.auth);
    if (identity.state === 'unavailable') return authUnavailable('platform-admin-access', '/api/admin');
    if (identity.state === 'unauthenticated') return null;
    const { data: profile, error } = await readAuthorization(supabase
      .from('profiles').select('is_platform_admin').eq('id', identity.user.id).maybeSingle());
    if (error) return authUnavailable('platform-admin-access', '/api/admin');
    if (profile?.is_platform_admin !== true) return null;
    return identity.user;
  } catch {
    return authUnavailable('platform-admin-access', '/api/admin');
  }
}
