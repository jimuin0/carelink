import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();

  // Verify ownership — both "not found" and "wrong owner" return 404 to prevent ID enumeration
  const { data: existing } = await admin
    .from('job_applications')
    .select('facility_id, status')
    .eq('id', params.id)
    .single();

  const { data: membership } = existing
    ? await admin
        .from('facility_members')
        .select('role')
        .eq('facility_id', existing.facility_id)
        .eq('user_id', user.id)
        .single()
    : { data: null };

  if (!existing || !membership) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { status, referral_fee_yen, notes } = await req.json().catch(() => ({}));

  const VALID_STATUSES = [
    'pending', 'reviewing', 'interview_scheduled', 'interview_done',
    'offer_made', 'hired', 'rejected', 'withdrawn',
  ];
  if (status && !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (status) updates.status = status;
  if (referral_fee_yen !== undefined) updates.referral_fee_yen = typeof referral_fee_yen === 'number' ? Math.max(0, referral_fee_yen) : null;
  if (notes !== undefined) updates.notes = typeof notes === 'string' ? notes.slice(0, 2000) : null;
  if (status === 'hired' && existing.status !== 'hired') {
    updates.hired_at = new Date().toISOString();
  }

  const { data: application, error } = await admin
    .from('job_applications')
    .update(updates)
    .eq('id', params.id)
    .select('*, job_postings(title)')
    .single();

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  return NextResponse.json({ application });
}
