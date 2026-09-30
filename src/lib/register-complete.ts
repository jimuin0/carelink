import { createServiceRoleClient } from '@/lib/supabase-server';
import { verifySalonClaim } from '@/lib/salon-claim';
import { alertCaughtError } from '@/lib/alert';

export interface RegisteredSalonSummary {
  status: 'confirmed';
  id: string;
  name: string;
  type: string;
  area: string;
}

export type RegisteredSalonResult = RegisteredSalonSummary | {
  status: 'unverified' | 'not_found' | 'unavailable';
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Receipt IDs are references, not permission to read an unpublished application.
// Check the signed browser claim before issuing any service-role query.
export async function resolveRegisteredSalon(id: string | undefined, claim?: string): Promise<RegisteredSalonResult> {
  if (!id || !UUID_RE.test(id) || !claim || verifySalonClaim(claim) !== id) {
    return { status: 'unverified' };
  }
  try {
    const supabase = createServiceRoleClient();
    const { data: salon, error } = await supabase
      .from('salons')
      .select('facility_name, business_type, address')
      .eq('id', id)
      .maybeSingle();

    if (error) throw new Error('Registration receipt lookup failed');
    if (!salon) return { status: 'not_found' };

    return {
      status: 'confirmed',
      id,
      name: salon.facility_name || '',
      type: salon.business_type || '',
      area: salon.address || '',
    };
  } catch {
    // Do not forward provider errors that may contain application data.
    alertCaughtError('register-complete', new Error('Registration receipt lookup unavailable'), '/register/complete');
    return { status: 'unavailable' };
  }
}
