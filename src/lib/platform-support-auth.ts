import type { User } from '@supabase/supabase-js';
import { createServerSupabaseAuthClient } from './supabase-server-auth';
import { verifyAuthUser } from './auth-verification';

type SupportVerification =
  | { state: 'verified'; user: User; name: string | null }
  | { state: 'unauthenticated' | 'forbidden' | 'unavailable' };

/** Fresh DB privilege only; neither facility membership nor env IDs grant it. */
export async function verifyPlatformSupportUser(): Promise<SupportVerification> {
  try {
    const supabase = await createServerSupabaseAuthClient();
    const verification = await verifyAuthUser(supabase.auth);
    if (verification.state !== 'verified') return verification;
    const { data: profile, error } = await supabase.from('profiles')
      .select('is_platform_admin, display_name').eq('id', verification.user.id).single();
    if (error) return { state: 'unavailable' };
    if (profile?.is_platform_admin !== true) return { state: 'forbidden' };
    return { state: 'verified', user: verification.user,
      name: typeof profile.display_name === 'string' ? profile.display_name : null };
  } catch {
    return { state: 'unavailable' };
  }
}
