import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { notFound } from 'next/navigation';
import { verifyAuthUser } from '@/lib/auth-verification';
import AccessVerificationUnavailable from '@/components/admin/AccessVerificationUnavailable';

export const dynamic = 'force-dynamic';

export default async function RegistrationsLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabaseAuthClient().catch(() => null);
  if (!supabase) return <AccessVerificationUnavailable />;
  const verification = await verifyAuthUser(supabase.auth);
  if (verification.state === 'unavailable') return <AccessVerificationUnavailable />;
  if (verification.state !== 'verified') notFound();
  const user = verification.user;

  const permission = await supabase
    .from('profiles')
    .select('is_platform_admin')
    .eq('id', user.id)
    .single().then(result => result, () => null);
  if (!permission) return <AccessVerificationUnavailable />;
  const { data: profile, error } = permission;
  if (error) return <AccessVerificationUnavailable />;
  if (profile?.is_platform_admin !== true) notFound();

  return <>{children}</>;
}
