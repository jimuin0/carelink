import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { checkCsrf } from '@/lib/csrf';
import { mutationRateLimit, checkRateLimit } from '@/lib/rate-limit';
import { jobFormSchema } from '@/lib/jobs';

export const dynamic = 'force-dynamic';

async function getOwnerFacilityIds() {
  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, facilityIds: [] as string[] };

  const { data: memberships } = await supabase
    .from('facility_members')
    .select('facility_id, role')
    .eq('user_id', user.id)
    .in('role', ['owner', 'admin']);

  const facilityIds = (memberships ?? []).map((m) => m.facility_id as string);
  return { supabase, user, facilityIds };
}

export async function GET() {
  try {
    const { supabase, user, facilityIds } = await getOwnerFacilityIds();
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    if (facilityIds.length === 0) return NextResponse.json({ jobs: [] });

    const { data, error } = await supabase
      .from('facility_jobs')
      .select('*')
      .in('facility_id', facilityIds)
      .order('created_at', { ascending: false });

    if (error) return NextResponse.json({ error: '取得に失敗しました' }, { status: 500 });
    return NextResponse.json({ jobs: data ?? [] });
  } catch (e) {
    Sentry.captureException(e, { tags: { feature: 'admin-jobs-list' } });
    return NextResponse.json({ error: 'サーバーエラー' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const csrfError = checkCsrf(request);
    if (csrfError) return csrfError;

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
    if (await checkRateLimit(mutationRateLimit, ip, 20, 60_000, 'admin-jobs')) {
      return NextResponse.json({ error: '短時間に多くのリクエストがありました' }, { status: 429 });
    }

    const body = await request.json().catch(() => null);
    const parsed = jobFormSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: '入力値が不正です', issues: parsed.error.issues }, { status: 400 });
    }

    const { supabase, user, facilityIds } = await getOwnerFacilityIds();
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    if (facilityIds.length === 0) return NextResponse.json({ error: '権限がありません' }, { status: 403 });

    const v = parsed.data;
    const insertRow = {
      facility_id: facilityIds[0],
      title: v.title,
      job_type: v.job_type,
      employment_type: v.employment_type,
      salary_min: v.salary_min,
      salary_max: v.salary_max,
      salary_note: v.salary_note || null,
      description: v.description || null,
      requirements: v.requirements || null,
      benefits: v.benefits || null,
    };

    const { data, error } = await supabase
      .from('facility_jobs')
      .insert(insertRow)
      .select('*')
      .single();

    if (error) {
      Sentry.captureException(error, { tags: { feature: 'admin-jobs-create' } });
      return NextResponse.json({ error: '作成に失敗しました' }, { status: 500 });
    }

    return NextResponse.json({ job: data }, { status: 201 });
  } catch (e) {
    Sentry.captureException(e, { tags: { feature: 'admin-jobs-create' } });
    return NextResponse.json({ error: 'サーバーエラー' }, { status: 500 });
  }
}
