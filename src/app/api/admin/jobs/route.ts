import { manageAdminContent } from '@/lib/admin-content-write';
import { verifyAuthUser } from '@/lib/auth-verification';
import { databaseDiagnostic } from '@/lib/database-diagnostic';
import { NextRequest, NextResponse } from 'next/server';
import { serverError, authUnavailable } from '@/lib/with-route';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { checkCsrf } from '@/lib/csrf';
import { mutationRateLimit, checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { jobFormSchema } from '@/lib/jobs';
import { writeAuditLog } from '@/lib/audit-logger';

export const dynamic = 'force-dynamic';

async function getOwnerFacilityIds() {
  const supabase = await createServerSupabaseAuthClient();
  const identity = await verifyAuthUser(supabase.auth);
  if (identity.state === 'unavailable') return { error: authUnavailable('admin-jobs-access', '/api/admin/jobs') };
  const user = identity.state === 'verified' ? identity.user : null;
  if (!user) return { supabase, user: null, facilityIds: [] as string[] };

  const { data: memberships, error: membershipError } = await supabase
    .from('facility_members')
    .select('facility_id, role')
    .eq('user_id', user.id)
    .in('role', ['owner', 'admin']);

  if (membershipError) throw membershipError;
  const facilityIds = (memberships ?? []).map((m) => m.facility_id as string);
  return { supabase, user, facilityIds };
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'admin-jobs-get')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  try {
    const access = await getOwnerFacilityIds();
    if ('error' in access) return access.error;
    const { user, facilityIds } = access;
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    if (facilityIds.length === 0) return NextResponse.json({ jobs: [] });

    // メンバーシップ検証後の DB 操作は service role で行う（menus/staff と同型）。facility_jobs の
    // RLS は published 施設の公開 read ポリシーのみで、INSERT/未公開施設の自店 read を許す
    // ポリシーが無いため、auth クライアントでは未公開施設の自店求人が読めず・作成も弾かれる。
    const admin = createServiceRoleClient();
    const { data, error } = await admin
      .from('facility_jobs')
      .select('*')
      .in('facility_id', facilityIds)
      .order('created_at', { ascending: false });

    if (error) return serverError('admin-jobs-list-query', error, '/api/admin/jobs', '取得に失敗しました');
    return NextResponse.json({ jobs: data ?? [] });
  } catch (e) {
    const response = serverError('admin-jobs-list', databaseDiagnostic(e), '/api/admin/jobs', 'サーバーエラー');
    response.headers.set('Cache-Control', 'no-store');
    return response;
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

    // 【2026年7月29日・恒久根治】CSRF/レートリミットの後、認証確認より先に zod バリデーションを
    // 実行していたため、未認証のリクエストでも「入力値が不正です」+ issues（バリデーションルールの
    // 詳細）を得られてしまっていた（withRoute 標準順序＝CSRF→RateLimit→認証→zod に反する）。
    // 認証・権限チェックを zod より前に移動し、未認証者はバリデーション結果に触れずに 401 で弾く。
    const access = await getOwnerFacilityIds();
    if ('error' in access) return access.error;
    const { user, facilityIds } = access;
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    if (facilityIds.length === 0) return NextResponse.json({ error: '権限がありません' }, { status: 403 });

    const body = await request.json().catch(() => null);
    const parsed = jobFormSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: '入力値が不正です', issues: parsed.error.issues }, { status: 400 });
    }

    // 投稿先施設を決定。複数施設の owner/admin の場合に facilityIds[0]（DB 返却順依存・非決定的）へ
    // 黙って書くと意図しない施設に求人が作られるため、リクエストの facility_id を所有施設集合で検証して使う。
    // 単一施設の場合は従来どおり省略可（その唯一の施設を使う）。
    const requestedFacilityId = (body as { facility_id?: unknown } | null)?.facility_id;
    let targetFacilityId: string;
    if (typeof requestedFacilityId === 'string' && requestedFacilityId.length > 0) {
      if (!facilityIds.includes(requestedFacilityId)) {
        return NextResponse.json({ error: '権限がありません' }, { status: 403 });
      }
      targetFacilityId = requestedFacilityId;
    } else if (facilityIds.length === 1) {
      targetFacilityId = facilityIds[0];
    } else {
      return NextResponse.json({ error: '投稿先の施設を指定してください' }, { status: 400 });
    }

    const v = parsed.data;
    const insertRow = {
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

    // メンバーシップ検証後の INSERT は service role で行う（RLS に INSERT ポリシーが無く
    // auth クライアントでは弾かれるため。menus/staff と同型の信頼サーバ文脈での書き込み）。
    const data = await manageAdminContent({actorId:user.id,facilityId:targetFacilityId,recordId:null,kind:'job:create',values:insertRow});
    if (data instanceof NextResponse) return data;

    void writeAuditLog({
      userId: user.id,
      facilityId: targetFacilityId,
      action: 'create',
      tableName: 'facility_jobs',
      recordId: data.id,
      newValues: { title: v.title, job_type: v.job_type, employment_type: v.employment_type },
      ipAddress: ip,
    });

    return NextResponse.json({ job: data }, { status: 201 });
  } catch (e) {
    const response = serverError('admin-jobs-create', databaseDiagnostic(e), '/api/admin/jobs', 'サーバーエラー');
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
}
