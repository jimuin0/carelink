import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { checkCsrf } from '@/lib/csrf';
import { UUID_REGEX } from '@/lib/constants';

async function getFacilityIds(userId: string): Promise<string[]> {
  const admin = createServiceRoleClient();
  const { data } = await admin
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', userId)
    .in('role', ['owner', 'admin']);
  return (data ?? []).map((m) => m.facility_id as string);
}

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (await checkRateLimit(null, ip, 20, 60_000, 'job-applications-get')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const facilityIds = await getFacilityIds(user.id);
  if (facilityIds.length === 0) return NextResponse.json({ error: 'No facility' }, { status: 403 });

  const admin = createServiceRoleClient();
  // 【2026年7月10日 恒久根治】error を検査せず常に成功として空配列にフォールバックしていたため、
  // DB障害時も「応募0件」と偽装表示していた。error を明示的に検査し、真の失敗は500で可視化する。
  const { data: applications, error } = await admin
    .from('job_applications')
    .select('*, job_postings(title)')
    .in('facility_id', facilityIds)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

  return NextResponse.json({ applications: applications ?? [] });
}

// Public POST: submit application
export async function POST(req: NextRequest) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const ip = getClientIp(req);
  if (await checkRateLimit(null, ip, 5, 60_000, 'job-apply')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const body = await req.json().catch(() => ({}));
  const { job_posting_id, facility_id, applicant_name, applicant_email, applicant_phone, cover_letter } = body;

  if (!facility_id || !applicant_name || !applicant_email) {
    return NextResponse.json({ error: 'facility_id, applicant_name, applicant_email required' }, { status: 400 });
  }
  if (!UUID_REGEX.test(facility_id)) return NextResponse.json({ error: 'Invalid facility_id' }, { status: 400 });
  if (job_posting_id && !UUID_REGEX.test(job_posting_id)) return NextResponse.json({ error: 'Invalid job_posting_id' }, { status: 400 });

  // Basic email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(applicant_email)) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
  }

  const admin = createServiceRoleClient();

  // Check if already applied
  // job_posting_id が未指定（一般応募）のとき .eq('job_posting_id', null) は PostgREST 上
  // `job_posting_id=eq.null` に翻訳され SQL の NULL 行に一致しない（col = NULL は常に偽）。
  // その結果、一般応募の重複チェックが常にすり抜け二重応募を許してしまうため、
  // null のときは .is() で IS NULL 判定に切り替える。
  let dupQuery = admin
    .from('job_applications')
    .select('id')
    .eq('facility_id', facility_id)
    .eq('applicant_email', applicant_email);
  dupQuery = job_posting_id
    ? dupQuery.eq('job_posting_id', job_posting_id)
    : dupQuery.is('job_posting_id', null);
  const { data: existing } = await dupQuery.limit(1);

  if (existing && existing.length > 0) {
    return NextResponse.json({ error: 'Already applied' }, { status: 409 });
  }

  // Check if user is logged in
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: application, error } = await admin
    .from('job_applications')
    .insert({
      job_posting_id: job_posting_id || null,
      facility_id,
      applicant_user_id: user?.id || null,
      applicant_name: applicant_name.slice(0, 100),
      applicant_email,
      applicant_phone: applicant_phone?.slice(0, 20) || null,
      cover_letter: cover_letter?.slice(0, 2000) || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: '応募の保存に失敗しました' }, { status: 500 });
  return NextResponse.json({ application }, { status: 201 });
}
