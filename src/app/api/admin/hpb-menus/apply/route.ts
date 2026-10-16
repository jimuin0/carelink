import { NextRequest, NextResponse } from 'next/server';
import { getAdminApiContext } from '@/lib/admin-api-context';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { applyHpbMenusToFacilityMenus } from '@/lib/hpb-menu';
import { writeAuditLog } from '@/lib/audit-logger';
import { serverError } from '@/lib/with-route';

export const dynamic = 'force-dynamic';

/** 認可: ログインユーザーが facility_id の owner/admin か検証。可なら userId/facilityId を返す。 */

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

  const auth = await getAdminApiContext(request);
  if (auth instanceof NextResponse) return auth;

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
  } catch (e) {
    return serverError('admin-hpb-menus-apply', e, '/api/admin/hpb-menus/apply');
  }
}
