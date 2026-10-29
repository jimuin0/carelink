import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { requirePlatformAdmin } from '@/lib/platform-admin';
import { listingFacilityIdentity } from '@/lib/listing-verification-review';
import { listingEvidenceOptions } from '@/lib/listing-verification-evidence';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { withRoute } from '@/lib/with-route';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
const documentRow = z.object({ id:z.uuid(),document_type:z.enum(listingEvidenceOptions.map(item => item.value) as [string,...string[]]),
  created_at:z.string(),submitted_by:z.uuid().nullable() }).strict();
const applicantRow = z.object({ id:z.uuid(),display_name:z.string(),email:z.string().nullable() }).strict();

/** Restricted to the platform operator; document contents require a separate audited download. */
export const GET = withRoute(async request => {
  const user = await requirePlatformAdmin();
  if (user instanceof NextResponse) return user;
  if (!user) return NextResponse.json({ error:'権限がありません' }, { status:403,headers });
  const id = z.uuid().safeParse(new URL(request.url).searchParams.get('facility_id'));
  if (!id.success) return NextResponse.json({ error:'施設を確認してください' }, { status:400,headers });
  try {
    const db = createServiceRoleClient() as SupabaseClient;
    const [facility,documents,approval] = await Promise.all([
      db.from('facility_profiles').select('name,prefecture,city,address').eq('id',id.data).maybeSingle(),
      db.from('listing_verification_documents').select('id,document_type,created_at,submitted_by')
        .eq('facility_id',id.data).order('created_at',{ ascending:true }).limit(20),
      db.from('listing_verification_approvals').select('facility_identity').eq('facility_id',id.data).maybeSingle(),
    ]);
    if (facility.error || documents.error || approval.error) throw new Error('lookup failed');
    if (!facility.data) return NextResponse.json({ error:'施設が見つかりません' }, { status:404,headers });
    const identity = listingFacilityIdentity.parse(facility.data);
    const rows = z.array(documentRow).max(20).parse(documents.data);
    const applicantIds = [...new Set(rows.flatMap(row => row.submitted_by ? [row.submitted_by] : []))];
    let applicants: z.infer<typeof applicantRow>[] = [];
    if (applicantIds.length) {
      const lookup = await db.from('profiles').select('id,display_name,email').in('id',applicantIds);
      if (lookup.error) throw new Error('applicant lookup failed');
      applicants = z.array(applicantRow).max(20).parse(lookup.data);
      if (applicantIds.some(id => !applicants.some(applicant => applicant.id === id))) throw new Error('applicant missing');
    }
    const listed = rows.map(row => {
      const applicant = applicants.find(candidate => candidate.id === row.submitted_by);
      return { id:row.id,document_type:row.document_type,created_at:row.created_at,
        applicantName:applicant?.display_name ?? null,applicantEmail:applicant?.email ?? null };
    });
    const approved = approval.data ? listingFacilityIdentity.safeParse(approval.data.facility_identity) : null;
    const currentApproval = !!approved?.success && Object.keys(identity).every(key =>
      identity[key as keyof typeof identity] === approved.data[key as keyof typeof identity]);
    return NextResponse.json({ identity,documents:listed,currentApproval }, { headers });
  } catch {
    return NextResponse.json({ error:'確認情報を読み込めませんでした' }, { status:503,headers });
  }
}, { requireAuth:false,sentryTag:'listing-verification-list' });
