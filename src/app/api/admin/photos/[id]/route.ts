import { NextResponse } from 'next/server';
import { UUID_REGEX } from '@/lib/constants';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { serverError, withRoute } from '@/lib/with-route';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';

export async function DELETE(request: Request, props: { params: Promise<{ id: string }> }) {
  return withRoute(async (req, ctx) => {
    const { id } = await props.params;
    const facilityId = new URL(req.url).searchParams.get('facility_id');
    if (!UUID_REGEX.test(id) || !facilityId || !UUID_REGEX.test(facilityId)) {
      return NextResponse.json({ error: '店舗・写真IDが不正です' }, { status: 400 });
    }
    const admin = createServiceRoleClient();
    const { data, error } = await admin.rpc('delete_facility_photo_atomic', {
      p_actor_id: ctx.user!.id, p_facility_id: facilityId, p_photo_id: id,
    });
    if (error?.message.includes('FACILITY_PERMISSION_REVOKED')) return NextResponse.json({ error: '店舗の管理権限がありません' }, { status: 403 });
    if (error) return serverError('admin-photos-delete', error, '/api/admin/photos/[id]', '写真を削除できませんでした');
    if (data?.length === 0) return NextResponse.json({ error: 'この店舗の写真が見つかりません。再読み込みしてください' }, { status: 404 });
    if (data?.length !== 1 || data[0].id !== id) return serverError('admin-photos-delete-result', new Error('Photo deletion not confirmed'), '/api/admin/photos/[id]', '写真の削除を確認できませんでした');
    const { ip, ua } = getRequestContext(req);
    void writeAuditLog({ userId: ctx.user!.id, facilityId, action: 'delete', tableName: 'facility_photos', recordId: id,
      ipAddress: ip, userAgent: ua });
    return NextResponse.json({ ok: true, photoId: id });
  }, { requireAuth: true, rateLimit: { limiter: null, limit: 20, windowMs: 60_000, prefix: 'admin-photos-delete' }, sentryTag: 'admin-photos-delete' })(request);
}
