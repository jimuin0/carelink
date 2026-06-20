import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import { customerSchema } from '../route';

async function getAdminInfo(request: NextRequest): Promise<{ userId: string; facilityId: string } | null> {
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

  return data ? { userId: user.id, facilityId: data.facility_id } : null;
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'admin-customers-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: '不正なIDです' }, { status: 400 });

  const auth = await getAdminInfo(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = customerSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from('customers')
    .update({
      name: parsed.data.name,
      name_kana: parsed.data.name_kana ?? null,
      email: parsed.data.email || null,
      phone: parsed.data.phone ?? null,
      birthday: parsed.data.birthday || null,
      gender: parsed.data.gender ?? null,
      notes: parsed.data.notes ?? null,
    })
    .eq('id', params.id)
    .eq('facility_id', auth.facilityId)
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'このメールアドレスの顧客は既に登録されています' }, { status: 409 });
    }
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: '顧客が見つかりません' }, { status: 404 });

  const { ua } = getRequestContext(request);
  void writeAuditLog({
    userId: auth.userId,
    facilityId: auth.facilityId,
    action: 'update',
    tableName: 'customers',
    recordId: params.id,
    newValues: { name: parsed.data.name, email: parsed.data.email || null },
    ipAddress: ip,
    userAgent: ua,
  });
  return NextResponse.json({ customer: data });
}

export async function DELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'admin-customers-delete')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: '不正なIDです' }, { status: 400 });

  const auth = await getAdminInfo(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from('customers')
    .delete()
    .eq('id', params.id)
    .eq('facility_id', auth.facilityId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  if (!data) return NextResponse.json({ error: '顧客が見つかりません' }, { status: 404 });

  const { ua } = getRequestContext(request);
  void writeAuditLog({
    userId: auth.userId,
    facilityId: auth.facilityId,
    action: 'delete',
    tableName: 'customers',
    recordId: params.id,
    ipAddress: ip,
    userAgent: ua,
  });
  return NextResponse.json({ ok: true });
}
