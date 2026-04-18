/**
 * APIキー 無効化
 * DELETE /api/admin/api-keys/[id]
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';

export async function DELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 10, 60_000, 'api-keys-delete')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();

  const { data: key } = await admin.from('api_keys').select('facility_id').eq('id', params.id).single();
  // Verify ownership first, then check existence — both return 404 to prevent ID enumeration
  const { data: mem } = key
    ? await supabase
        .from('facility_members').select('role')
        .eq('user_id', user.id).eq('facility_id', key.facility_id)
        .in('role', ['owner', 'admin']).single()
    : { data: null };
  if (!key || !mem) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await admin.from('api_keys').update({ is_active: false }).eq('id', params.id);

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
