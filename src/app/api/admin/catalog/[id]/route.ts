import { manageAdminContent } from '@/lib/admin-content-write';
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import { authUnavailable } from '@/lib/with-route';
import { verifyAuthUser } from '@/lib/auth-verification';

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(), // title として保存
  description: z.string().max(2000).optional().nullable(),
  tags: z.array(z.string().max(50)).max(20).optional().nullable(),
});

async function verifyCatalogAdmin(catalogId: string, userId: string): Promise<string | null | NextResponse> {
  const unavailable = () => authUnavailable('admin-catalog-access', '/api/admin/catalog/[id]');
  try {
    const admin = createServiceRoleClient();
    const { data: catalog, error: catalogError } = await admin.from('treatment_catalogs').select('facility_id').eq('id', catalogId).maybeSingle();
    if (catalogError) return unavailable();
    if (!catalog) return null;

    const supabase = await createServerSupabaseAuthClient();
    const { data: mem, error: membershipError } = await supabase
      .from('facility_members')
      .select('facility_id')
      .eq('user_id', userId)
      .eq('facility_id', catalog.facility_id)
      .in('role', ['owner', 'admin'])
      .maybeSingle();
    if (membershipError) return unavailable();

    return mem ? catalog.facility_id : null;
  } catch {
    return unavailable();
  }
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'admin-catalog-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const supabase = await createServerSupabaseAuthClient();
  const identity = await verifyAuthUser(supabase.auth);
  if (identity.state === 'unavailable') return authUnavailable('admin-catalog-patch-auth', '/api/admin/catalog/[id]');
  if (identity.state === 'unauthenticated') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = identity.user;

  const facilityId = await verifyCatalogAdmin(params.id, user.id);
  if (facilityId instanceof NextResponse) return facilityId;
  if (!facilityId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  const { name, ...rest } = parsed.data;
  const updateValues = { ...rest, ...(name !== undefined ? { title: name } : {}) };

  const data = await manageAdminContent({actorId:user.id,facilityId,recordId:params.id,kind:'catalog:update',values:updateValues});
  if (data instanceof NextResponse) return data;

  const { ip: auditIp, ua } = getRequestContext(request);
  void writeAuditLog({
    userId: user.id,
    facilityId,
    action: 'update',
    tableName: 'treatment_catalogs',
    recordId: params.id,
    newValues: updateValues,
    ipAddress: auditIp,
    userAgent: ua,
  });

  return NextResponse.json({ item: data });
}

export async function DELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 10, 60_000, 'admin-catalog-delete')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const supabase = await createServerSupabaseAuthClient();
  const identity = await verifyAuthUser(supabase.auth);
  if (identity.state === 'unavailable') return authUnavailable('admin-catalog-delete-auth', '/api/admin/catalog/[id]');
  if (identity.state === 'unauthenticated') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = identity.user;

  const facilityId = await verifyCatalogAdmin(params.id, user.id);
  if (facilityId instanceof NextResponse) return facilityId;
  if (!facilityId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const data = await manageAdminContent({actorId:user.id,facilityId,recordId:params.id,kind:'catalog:delete',values:{}});
  if (data instanceof NextResponse) return data;

  const { ip: auditIp, ua } = getRequestContext(request);
  void writeAuditLog({
    userId: user.id,
    facilityId,
    action: 'delete',
    tableName: 'treatment_catalogs',
    recordId: params.id,
    ipAddress: auditIp,
    userAgent: ua,
  });

  return NextResponse.json({ message: 'deleted' });
}
