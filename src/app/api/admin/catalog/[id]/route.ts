import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(), // title として保存
  description: z.string().max(2000).optional().nullable(),
  tags: z.array(z.string().max(50)).max(20).optional().nullable(),
});

async function verifyCatalogAdmin(catalogId: string, userId: string): Promise<string | null> {
  const admin = createServiceRoleClient();
  const { data: catalog } = await admin.from('treatment_catalogs').select('facility_id').eq('id', catalogId).single();
  if (!catalog) return null;

  const supabase = await createServerSupabaseAuthClient();
  const { data: mem } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', userId)
    .eq('facility_id', catalog.facility_id)
    .in('role', ['owner', 'admin'])
    .single();

  return mem ? catalog.facility_id : null;
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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const facilityId = await verifyCatalogAdmin(params.id, user.id);
  if (!facilityId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  const admin = createServiceRoleClient();
  const { name, ...rest } = parsed.data;
  const updateValues = { ...rest, ...(name !== undefined ? { title: name } : {}) };

  const { data, error } = await admin.from('treatment_catalogs').update(updateValues).eq('id', params.id).eq('facility_id', facilityId).select().single();
  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'カタログが見つかりません' }, { status: 404 });

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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const facilityId = await verifyCatalogAdmin(params.id, user.id);
  if (!facilityId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();
  const { error } = await admin.from('treatment_catalogs').delete().eq('id', params.id).eq('facility_id', facilityId);
  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

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
