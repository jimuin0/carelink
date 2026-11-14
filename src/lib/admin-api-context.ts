import { readAuthorization } from './authorization-read';
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from './supabase-server-auth';
import { createServiceRoleClient } from './supabase-server';
import { UUID_REGEX } from './constants';
import { AUTH_UNAVAILABLE_BODY, verifyAuthUser } from './auth-verification';
import { adminForbidden, adminUnauthenticated } from './admin-denial';

type AdminApiContext = { userId: string; facilityId: string };
// 未ログインだけが 401、ログイン済みで所属・権限が無いものは 403（点検 A205）。
const unauthenticated = () => adminUnauthenticated();
const denied = () => adminForbidden();
const unavailable = () => NextResponse.json(AUTH_UNAVAILABLE_BODY, { status: 503, headers: { 'Cache-Control': 'no-store' } });

/** Service-role callers may proceed only with unambiguous verified identity
 * and membership. Never accept provider data alongside an error. */
export async function getAdminApiContext(
  request: NextRequest, staffId?: string,
): Promise<AdminApiContext | NextResponse> {
  try {
    const supabase = await createServerSupabaseAuthClient();
    const identity = await verifyAuthUser(supabase.auth);
    if (identity.state === 'unavailable') return unavailable();
    if (identity.state === 'unauthenticated') return unauthenticated();

    const rawFacilityId = request.nextUrl.searchParams.get('facility_id');
    if (!rawFacilityId || !UUID_REGEX.test(rawFacilityId)) return denied();
    // DB（uuid 型）は小文字で返すので、照合の前に揃える（大文字の指定を 503 にしない・B2-18）。
    const facilityId = rawFacilityId.toLowerCase();
    const membership = await readAuthorization(supabase.from('facility_members').select('facility_id')
      .eq('user_id', identity.user.id).eq('facility_id', facilityId)
      .in('role', ['owner', 'admin']).maybeSingle());
    if (membership.error !== null) return unavailable();
    if (membership.data === null) return denied();
    if (membership.data?.facility_id !== facilityId) return unavailable();

    if (staffId !== undefined) {
      staffId = staffId.toLowerCase();
      const staff = await readAuthorization(createServiceRoleClient().from('staff_profiles').select('id')
        .eq('id', staffId).eq('facility_id', facilityId).maybeSingle());
      if (staff.error !== null) return unavailable();
      if (staff.data === null) return denied();
      if (staff.data?.id !== staffId) return unavailable();
    }
    return { userId: identity.user.id, facilityId };
  } catch {
    return unavailable();
  }
}
