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
const schema = z.object({ menu_ids: z.array(z.uuid()).min(2).max(5000), expected_ids: z.array(z.uuid()).min(2).max(5000), expected_revision: z.iso.datetime({ offset: true }).nullable() });
const receipt = z.object({ outcome: z.literal('saved'), facility_id: z.uuid(), revision: z.iso.datetime({ offset: true }) });
export async function POST(request: NextRequest) {
  const csrf = checkCsrf(request); if (csrf) return csrf;
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'admin-menus-reorder')) return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  const ctx = await getAdminApiContext(request); if (ctx instanceof NextResponse) return ctx;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: '並び順が不正です' }, { status: 400 });
  const { data, error } = await createServiceRoleClient().rpc('reorder_admin_menus_atomic', { p_actor_id: ctx.userId, p_facility_id: ctx.facilityId,
    p_menu_ids: parsed.data.menu_ids, p_expected_ids: parsed.data.expected_ids, p_expected_revision: parsed.data.expected_revision ?? '' });
  if (error) {
    if (error.code === '42501') return NextResponse.json({ error: '店舗の管理権限を確認してください' }, { status: 403 });
    if (error.code === 'P0002') return NextResponse.json({ error: 'メニューが見つかりません' }, { status: 404 });
    if (error.code === '40001') return NextResponse.json({ error: '一覧が更新されています。もう一度並び替えてください' }, { status: 409 });
    if (error.code === '22023') return NextResponse.json({ error: '並び順が不正です' }, { status: 400 });
    return serverError('admin-menus-reorder', databaseDiagnostic(error), '/api/admin/menus/reorder');
  }
  const result = receipt.safeParse(data);
  if (!result.success || result.data.facility_id !== ctx.facilityId.toLowerCase()) return serverError('admin-menus-reorder-receipt', new Error('MENU_RESULT_INVALID'), '/api/admin/menus/reorder');
  void writeAuditLog({ userId: ctx.userId, facilityId: ctx.facilityId, action: 'update', tableName: 'facility_menus', newValues: { menu_ids: parsed.data.menu_ids }, ipAddress: ip });
  return NextResponse.json(result.data);
}
