import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import SalonBoard from './SalonBoard';

export const metadata: Metadata = {
  title: 'サロンボード',
};

export const dynamic = 'force-dynamic';

export default async function SalonBoardPage() {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: membership } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user.id)
    .in('role', ['owner', 'admin'])
    .limit(1)
    .single();
  if (!membership) notFound();

  return <SalonBoard facilityId={membership.facility_id} />;
}
