/**
 * APIキー 無効化
 * DELETE /api/admin/api-keys/[id]
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import { authUnavailable, serverError } from '@/lib/with-route';
import { verifyAuthUser } from '@/lib/auth-verification';
import { databaseDiagnostic } from '@/lib/database-diagnostic';

export async function DELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 10, 60_000, 'api-keys-delete')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const supabase = await createServerSupabaseAuthClient();
  const identity = await verifyAuthUser(supabase.auth);
  if (identity.state === 'unavailable') return authUnavailable('admin-api-keys-delete-auth', '/api/admin/api-keys/[id]');
  if (identity.state === 'unauthenticated') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = identity.user;

  const admin = createServiceRoleClient();

  const { data: key, error: keyError } = await admin.from('api_keys').select('facility_id').eq('id', params.id).maybeSingle();
  if (keyError) {
    const response = serverError('admin-api-keys-delete-read', databaseDiagnostic(keyError), '/api/admin/api-keys/[id]');
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
  // Verify ownership first, then check existence — both return 404 to prevent ID enumeration
  const { data: mem, error: membershipError } = key
    ? await supabase
        .from('facility_members').select('role')
        .eq('user_id', user.id).eq('facility_id', key.facility_id)
        .in('role', ['owner', 'admin']).maybeSingle()
    : { data: null, error: null };
  if (membershipError) {
    const response = serverError('admin-api-keys-delete-membership', databaseDiagnostic(membershipError), '/api/admin/api-keys/[id]');
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
  if (!key || !mem) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // 更新件数(affected rows)を検証せず常に success:true を返していたため、TOCTOU（key/membership確認後に
  // 既削除等）による0件更新も「成功」と偽装していた（phantom success）。.select() で更新行を受け取り、
  // 0件なら404を返す（customers/[id]・menus/[id]・catalog/[id] と同型）。
  const { data: deactivated, error: deactivateErr } = await admin
    .from('api_keys')
    .update({ is_active: false })
    .eq('id', params.id)
    .eq('facility_id', key.facility_id)
    .select();
  if (deactivateErr) {
    return serverError('admin-api-keys-delete', deactivateErr, '/api/admin/api-keys/[id]', 'Failed to deactivate key');
  }
  if (!deactivated || deactivated.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { ip: auditIp, ua } = getRequestContext(request);
  void writeAuditLog({
    userId: user.id,
    facilityId: key.facility_id,
    action: 'delete',
    tableName: 'api_keys',
    recordId: params.id,
    newValues: { is_active: false },
    ipAddress: auditIp,
    userAgent: ua,
  });

  return NextResponse.json({ success: true });
}
