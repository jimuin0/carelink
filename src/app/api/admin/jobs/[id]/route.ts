import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { checkCsrf } from '@/lib/csrf';
import { mutationRateLimit, checkRateLimit } from '@/lib/rate-limit';
import { UUID_REGEX } from '@/lib/constants';
import { jobFormSchema } from '@/lib/jobs';

export const dynamic = 'force-dynamic';

async function authorize(jobId: string) {
  if (!UUID_REGEX.test(jobId)) return { error: NextResponse.json({ error: '不正なIDです' }, { status: 400 }) };

  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: '認証が必要です' }, { status: 401 }) };

  const { data: memberships } = await supabase
    .from('facility_members')
    .select('facility_id, role')
    .eq('user_id', user.id)
    .in('role', ['owner', 'admin']);

  const facilityIds = (memberships ?? []).map((m) => m.facility_id as string);
  if (facilityIds.length === 0) return { error: NextResponse.json({ error: '権限がありません' }, { status: 403 }) };

  const { data: job } = await supabase
    .from('facility_jobs')
    .select('*')
    .eq('id', jobId)
    .in('facility_id', facilityIds)
    .single();

  if (!job) return { error: NextResponse.json({ error: '求人が見つかりません' }, { status: 404 }) };
  return { supabase, job };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const result = await authorize(params.id);
    if ('error' in result) return result.error;
    return NextResponse.json({ job: result.job });
  } catch (e) {
    Sentry.captureException(e, { tags: { feature: 'admin-jobs-get' } });
    return NextResponse.json({ error: 'サーバーエラー' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const csrfError = checkCsrf(request);
    if (csrfError) return csrfError;

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
    if (await checkRateLimit(mutationRateLimit, ip, 30, 60_000, 'admin-jobs-update')) {
      return NextResponse.json({ error: '短時間に多くのリクエストがありました' }, { status: 429 });
    }

    const body = await request.json().catch(() => null);
    const parsed = jobFormSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: '入力値が不正です', issues: parsed.error.issues }, { status: 400 });
    }

    const result = await authorize(params.id);
    if ('error' in result) return result.error;
    const { supabase, job } = result;

    const v = parsed.data;
    const { data, error } = await supabase
      .from('facility_jobs')
      .update({
        title: v.title,
        job_type: v.job_type,
        employment_type: v.employment_type,
        salary_min: v.salary_min,
        salary_max: v.salary_max,
        salary_note: v.salary_note || null,
        description: v.description || null,
        requirements: v.requirements || null,
        benefits: v.benefits || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id)
      .eq('facility_id', job.facility_id)
      .select('*')
      .single();

    if (error) {
      Sentry.captureException(error, { tags: { feature: 'admin-jobs-update' } });
      return NextResponse.json({ error: '更新に失敗しました' }, { status: 500 });
    }
    return NextResponse.json({ job: data });
  } catch (e) {
    Sentry.captureException(e, { tags: { feature: 'admin-jobs-update' } });
    return NextResponse.json({ error: 'サーバーエラー' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const csrfError = checkCsrf(request);
    if (csrfError) return csrfError;

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
    if (await checkRateLimit(mutationRateLimit, ip, 20, 60_000, 'admin-jobs-delete')) {
      return NextResponse.json({ error: '短時間に多くのリクエストがありました' }, { status: 429 });
    }

    const result = await authorize(params.id);
    if ('error' in result) return result.error;
    const { supabase, job } = result;

    const { error } = await supabase
      .from('facility_jobs')
      .delete()
      .eq('id', job.id)
      .eq('facility_id', job.facility_id);

    if (error) {
      Sentry.captureException(error, { tags: { feature: 'admin-jobs-delete' } });
      return NextResponse.json({ error: '削除に失敗しました' }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    Sentry.captureException(e, { tags: { feature: 'admin-jobs-delete' } });
    return NextResponse.json({ error: 'サーバーエラー' }, { status: 500 });
  }
}
