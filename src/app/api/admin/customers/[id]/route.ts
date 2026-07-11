import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import { customerSchema } from '@/lib/validations';
import { zodErrorResponse } from '@/lib/api-validation';

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
  if (!parsed.success) return zodErrorResponse(parsed.error);

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
    // .maybeSingle(): 該当0行（他施設の顧客/存在しないid/同時削除）は正常結果でありDBエラーではない。
    // getAdminInfo は facility メンバーシップのみ検証し顧客idの存在は未検証のため0行は頻出パス。
    // .single() だと0行→PGRST116→下の if(error) が先に発火し 404 が到達不能（500に化ける）。
    // 23505（重複メール）は制約エラーとして maybeSingle でも error に入るため 409 判定は維持される。
    .maybeSingle();

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
    // .maybeSingle(): 0行（他施設の顧客/存在しないid）を not found として扱うため。
    // .single() だと PGRST116 で if(error)→500 が先に発火し 404 分岐が到達不能になる。
    .maybeSingle();

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
