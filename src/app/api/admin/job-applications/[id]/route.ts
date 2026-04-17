import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-service';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();

  // Verify ownership
  const { data: existing } = await admin
    .from('job_applications')
    .select('facility_id, status')
    .eq('id', params.id)
    .single();

  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: membership } = await admin
    .from('facility_members')
    .select('role')
    .eq('facility_id', existing.facility_id)
    .eq('user_id', user.id)
    .single();

  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { status, referral_fee_yen, notes } = await req.json();

  const VALID_STATUSES = [
    'pending', 'reviewing', 'interview_scheduled', 'interview_done',
    'offer_made', 'hired', 'rejected', 'withdrawn',
  ];
  if (status && !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (status) updates.status = status;
  if (referral_fee_yen !== undefined) updates.referral_fee_yen = referral_fee_yen;
  if (notes !== undefined) updates.notes = notes;
  if (status === 'hired' && existing.status !== 'hired') {
    updates.hired_at = new Date().toISOString();
  }

  const { data: application, error } = await admin
    .from('job_applications')
    .update(updates)
    .eq('id', params.id)
    .select('*, job_postings(title)')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ application });
}
