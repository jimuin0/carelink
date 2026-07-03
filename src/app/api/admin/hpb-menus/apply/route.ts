import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { applyHpbMenusToFacilityMenus } from '@/lib/hpb-menu';
import { writeAuditLog } from '@/lib/audit-logger';

export const dynamic = 'force-dynamic';

/** 認可: ログインユーザーが facility_id の owner/admin か検証。可なら userId/facilityId を返す。 */
async function getAdminFacilityId(request: NextRequest): Promise<{ userId: string; facilityId: string } | null> {
  const supabase = await createServerSupabaseAuthClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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

  return data?.facility_id ? { userId: user.id, facilityId: data.facility_id } : null;
}

/**
 * POST: hpb_menu_durations を facility_menus へ一括反映。
 * 新規メニューは is_published=false(非公開)で作成されるため、反映直後は客に出ない。
 * 管理画面のメニュー編集で公開ON にしたものだけ客向けに表示される。
 */
export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 5, 60_000, 'hpb-menus-apply')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const auth = await getAdminFacilityId(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();
  try {
    const result = await applyHpbMenusToFacilityMenus(admin, auth.facilityId);
    // メニュー価格・内容を一括反映する重要操作のため監査ログに残す（fire-and-forget）。
    void writeAuditLog({
      userId: auth.userId,
      facilityId: auth.facilityId,
      action: 'update',
      tableName: 'facility_menus',
      newValues: result as unknown as Record<string, unknown>,
      ipAddress: ip,
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}
