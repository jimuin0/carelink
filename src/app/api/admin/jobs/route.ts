import { NextRequest, NextResponse } from 'next/server';
import { safeCaptureException } from '@/lib/safe';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { checkCsrf } from '@/lib/csrf';
import { mutationRateLimit, checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { jobFormSchema } from '@/lib/jobs';

export const dynamic = 'force-dynamic';

async function getOwnerFacilityIds() {
  const supabase = await createServerSupabaseAuthClient();
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

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'admin-jobs-get')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
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
    safeCaptureException(e, 'admin-jobs-list');
    return NextResponse.json({ error: 'サーバーエラー' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const csrfError = checkCsrf(request);
    if (csrfError) return csrfError;

    const ip = getClientIp(request);
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

    const requestedFacilityId: string | undefined = (body as Record<string, unknown>)?.facility_id as string | undefined;
    if (!requestedFacilityId) return NextResponse.json({ error: 'facility_id が必要です' }, { status: 400 });
    if (!facilityIds.includes(requestedFacilityId)) return NextResponse.json({ error: '権限がありません' }, { status: 403 });

    const v = parsed.data;
    const insertRow = {
      facility_id: requestedFacilityId,
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
      safeCaptureException(error, 'admin-jobs-create');
      return NextResponse.json({ error: '作成に失敗しました' }, { status: 500 });
    }

    return NextResponse.json({ job: data }, { status: 201 });
  } catch (e) {
    safeCaptureException(e, 'admin-jobs-create');
    return NextResponse.json({ error: 'サーバーエラー' }, { status: 500 });
  }
}
