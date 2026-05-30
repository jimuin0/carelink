import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { writeAuditLog } from '@/lib/audit-logger';
import { safeCaptureException } from '@/lib/safe';

export const dynamic = 'force-dynamic';

// 一括停止・再開：ネット予約受付（＝施設の掲載ステータス）を切り替える
const bodySchema = z.object({
  action: z.enum(['suspend', 'resume']),
});

async function getAdminFacilityId(request: NextRequest): Promise<string | null> {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const facilityId = request.nextUrl.searchParams.get('facility_id');
  if (!facilityId || !UUID_REGEX.test(facilityId)) return null;

  const { data } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user.id)
    .eq('facility_id', facilityId)
    .in('role', ['owner', 'admin'])
    .single();

  return data?.facility_id ?? null;
}

export async function POST(request: NextRequest) {
  try {
    const csrfError = checkCsrf(request);
    if (csrfError) return csrfError;

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
    if (inMemoryRateLimit(ip, 20, 60_000, 'admin-facility-status')) {
      return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
    }

    const facilityId = await getAdminFacilityId(request);
    if (!facilityId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
    }

    const newStatus = parsed.data.action === 'suspend' ? 'suspended' : 'published';
    const admin = createServiceRoleClient();
    const { data: updated, error } = await admin
      .from('facility_profiles')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', facilityId)
      .select('id, status');

    if (error) {
      return NextResponse.json({ error: '更新に失敗しました' }, { status: 500 });
    }
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: '施設が見つかりません' }, { status: 404 });
    }

    const supabaseAuth = await createServerSupabaseAuthClient();
    const { data: { user } } = await supabaseAuth.auth.getUser();
    void writeAuditLog({
      userId: user?.id ?? null,
      facilityId,
      action: parsed.data.action === 'suspend' ? 'suspend' : 'publish',
      tableName: 'facility_profiles',
      recordId: facilityId,
      oldValues: null,
      newValues: { status: newStatus },
      ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0] ?? null,
      userAgent: request.headers.get('user-agent') ?? null,
    });

    return NextResponse.json({ success: true, status: newStatus });
  } catch (e) {
    safeCaptureException(e, 'admin-facility-status');
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}
