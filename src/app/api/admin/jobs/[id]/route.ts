import { NextRequest, NextResponse } from 'next/server';
import { safeCaptureException } from '@/lib/safe';
import { alertCaughtError } from '@/lib/alert';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { checkCsrf } from '@/lib/csrf';
import { mutationRateLimit, checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { UUID_REGEX } from '@/lib/constants';
import { jobFormSchema } from '@/lib/jobs';
import { writeAuditLog } from '@/lib/audit-logger';

export const dynamic = 'force-dynamic';

async function authorize(jobId: string) {
  if (!UUID_REGEX.test(jobId)) return { error: NextResponse.json({ error: '不正なIDです' }, { status: 400 }) };

  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: '認証が必要です' }, { status: 401 }) };

  // facility_members は auth クライアント（RLS 束縛・自分のメンバーシップのみ）で取得
  const { data: memberships } = await supabase
    .from('facility_members')
    .select('facility_id, role')
    .eq('user_id', user.id)
    .in('role', ['owner', 'admin']);

  const facilityIds = (memberships ?? []).map((m) => m.facility_id as string);
  if (facilityIds.length === 0) return { error: NextResponse.json({ error: '権限がありません' }, { status: 403 }) };

  // facility_jobs は RLS ポリシーが「published 施設の公開 read のみ」のため、未公開施設の自社求人が
  // auth クライアントでは読めず 404 になる実バグがあった。jobs/route.ts と同様に
  // service role で読み取り、IDOR は facilityIds（auth 経由）による .in() で防止する。
  const admin = createServiceRoleClient();
  const { data: job } = await admin
    .from('facility_jobs')
    .select('*')
    .eq('id', jobId)
    .in('facility_id', facilityIds)
    .single();

  if (!job) return { error: NextResponse.json({ error: '求人が見つかりません' }, { status: 404 }) };
  return { job, userId: user.id };
}

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'admin-jobs-id-get')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const params = await props.params;
  try {
    const result = await authorize(params.id);
    if ('error' in result) return result.error;
    return NextResponse.json({ job: result.job });
  } catch (e) {
    safeCaptureException(e, 'admin-jobs-get');
    alertCaughtError('admin-jobs-get', e, '/api/admin/jobs/[id]');
    return NextResponse.json({ error: 'サーバーエラー' }, { status: 500 });
  }
}

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const csrfError = checkCsrf(request);
    if (csrfError) return csrfError;

    const ip = getClientIp(request);
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
    const { job, userId } = result;

    // DB 書き込みは service role クライアント（facility_jobs の RLS は公開 read のみ・
    // UPDATE/DELETE ポリシーが無いため auth クライアントでは失敗する）
    const serviceAdmin = createServiceRoleClient();
    const v = parsed.data;
    const { data, error } = await serviceAdmin
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
      safeCaptureException(error, 'admin-jobs-update');
      alertCaughtError('admin-jobs-update', error, '/api/admin/jobs/[id]');
      return NextResponse.json({ error: '更新に失敗しました' }, { status: 500 });
    }

    void writeAuditLog({
      userId,
      facilityId: job.facility_id,
      action: 'update',
      tableName: 'facility_jobs',
      recordId: job.id,
      newValues: { title: v.title, job_type: v.job_type, employment_type: v.employment_type },
      ipAddress: ip,
    });

    return NextResponse.json({ job: data });
  } catch (e) {
    safeCaptureException(e, 'admin-jobs-update');
    alertCaughtError('admin-jobs-update', e, '/api/admin/jobs/[id]');
    return NextResponse.json({ error: 'サーバーエラー' }, { status: 500 });
  }
}

export async function DELETE(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const csrfError = checkCsrf(request);
    if (csrfError) return csrfError;

    const ip = getClientIp(request);
    if (await checkRateLimit(mutationRateLimit, ip, 20, 60_000, 'admin-jobs-delete')) {
      return NextResponse.json({ error: '短時間に多くのリクエストがありました' }, { status: 429 });
    }

    const result = await authorize(params.id);
    if ('error' in result) return result.error;
    const { job, userId } = result;

    // DB 書き込みは service role クライアント（facility_jobs の RLS は公開 read のみ・
    // DELETE ポリシーが無いため auth クライアントでは失敗する）
    const serviceAdmin = createServiceRoleClient();
    const { error } = await serviceAdmin
      .from('facility_jobs')
      .delete()
      .eq('id', job.id)
      .eq('facility_id', job.facility_id);

    if (error) {
      safeCaptureException(error, 'admin-jobs-delete');
      alertCaughtError('admin-jobs-delete', error, '/api/admin/jobs/[id]');
      return NextResponse.json({ error: '削除に失敗しました' }, { status: 500 });
    }

    void writeAuditLog({
      userId,
      facilityId: job.facility_id,
      action: 'delete',
      tableName: 'facility_jobs',
      recordId: job.id,
      ipAddress: ip,
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    safeCaptureException(e, 'admin-jobs-delete');
    alertCaughtError('admin-jobs-delete', e, '/api/admin/jobs/[id]');
    return NextResponse.json({ error: 'サーバーエラー' }, { status: 500 });
  }
}
