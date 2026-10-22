import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminApiContext } from '@/lib/admin-api-context';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { serverError } from '@/lib/with-route';
import { databaseDiagnostic } from '@/lib/database-diagnostic';
import { writeAuditLog } from '@/lib/audit-logger';

const receipt = z.object({ outcome: z.literal('published'), facility_id: z.uuid(), published: z.number().int().min(0) });

/**
 * POST: 選択中の施設の非公開（下書き）メニューをすべて公開する。
 *
 * HPB 一括反映は HPB のメニュー・クーポンごとに非公開の下書きを作る（30〜100 件になることも多い）。
 * 1 件ずつの「公開する」（PATCH /api/admin/menus/[id]）だけでは、メニュー編集と共有の
 * レート制限（20 回/分）に当たって途中で止まるため、1 回のトランザクションでまとめて公開する。
 * 権限確認・ロック順は save_admin_menu_atomic と同じ（DB 側 publish_admin_menus_atomic）。
 */
export async function POST(request: NextRequest) {
  const csrf = checkCsrf(request); if (csrf) return csrf;
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 10, 60_000, 'admin-menus-publish-all')) return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  const ctx = await getAdminApiContext(request); if (ctx instanceof NextResponse) return ctx;
  const { data, error } = await createServiceRoleClient().rpc('publish_admin_menus_atomic', {
    p_actor_id: ctx.userId, p_facility_id: ctx.facilityId,
  });
  if (error) {
    if (error.code === '42501') return NextResponse.json({ error: '店舗の管理権限を確認してください' }, { status: 403 });
    if (error.code === 'P0002') return NextResponse.json({ error: '店舗が見つかりません' }, { status: 404 });
    return serverError('admin-menus-publish-all', databaseDiagnostic(error), '/api/admin/menus/publish');
  }
  const result = receipt.safeParse(data);
  if (!result.success || result.data.facility_id !== ctx.facilityId.toLowerCase()) {
    return serverError('admin-menus-publish-all-receipt', new Error('MENU_RESULT_INVALID'), '/api/admin/menus/publish');
  }
  if (result.data.published > 0) {
    void writeAuditLog({ userId: ctx.userId, facilityId: ctx.facilityId, action: 'publish', tableName: 'facility_menus',
      newValues: { is_published: true, published: result.data.published }, ipAddress: ip });
  }
  return NextResponse.json({ published: result.data.published });
}
