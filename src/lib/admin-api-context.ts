import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from './supabase-server-auth';
import { createServiceRoleClient } from './supabase-server';
import { UUID_REGEX } from './constants';
import { AUTH_UNAVAILABLE_BODY, verifyAuthUser } from './auth-verification';

type AdminApiContext = { userId: string; facilityId: string };
const denied = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
    if (identity.state === 'unauthenticated') return denied();

    const facilityId = request.nextUrl.searchParams.get('facility_id');
    if (!facilityId || !UUID_REGEX.test(facilityId)) return denied();
    const membership = await supabase.from('facility_members').select('facility_id')
      .eq('user_id', identity.user.id).eq('facility_id', facilityId)
      .in('role', ['owner', 'admin']).maybeSingle();
    if (membership.error !== null) return unavailable();
    if (membership.data === null) return denied();
    if (membership.data?.facility_id !== facilityId) return unavailable();

    if (staffId !== undefined) {
      const staff = await createServiceRoleClient().from('staff_profiles').select('id')
        .eq('id', staffId).eq('facility_id', facilityId).maybeSingle();
      if (staff.error !== null) return unavailable();
      if (staff.data === null) return denied();
      if (staff.data?.id !== staffId) return unavailable();
    }
    return { userId: identity.user.id, facilityId };
  } catch {
    return unavailable();
  }
}
