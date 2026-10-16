import { NextRequest, NextResponse } from 'next/server';
import { getAdminApiContext } from '@/lib/admin-api-context';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import { customerSchema } from '@/lib/validations';
import { zodErrorResponse } from '@/lib/api-validation';
import { serverError } from '@/lib/with-route';

export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'admin-customers-post')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const auth = await getAdminApiContext(request);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => null);
  const parsed = customerSchema.safeParse(body);
  if (!parsed.success) return zodErrorResponse(parsed.error);

  const admin = createServiceRoleClient();
  const { data, error } = await admin.from('customers').insert({
    facility_id: auth.facilityId,
    name: parsed.data.name,
    name_kana: parsed.data.name_kana ?? null,
    email: parsed.data.email || null,
    phone: parsed.data.phone ?? null,
    birthday: parsed.data.birthday || null,
    gender: parsed.data.gender ?? null,
    notes: parsed.data.notes ?? null,
  }).select().single();

  if (error) {
    // 同一施設・同一メールの重複（部分 UNIQUE 制約違反）はユーザーに分かる 409 で返す。
    if (error.code === '23505') {
      return NextResponse.json({ error: 'このメールアドレスの顧客は既に登録されています' }, { status: 409 });
    }
    return serverError('admin-customers-create', error, '/api/admin/customers');
  }

  const { ua } = getRequestContext(request);
  void writeAuditLog({
    userId: auth.userId,
    facilityId: auth.facilityId,
    action: 'create',
    tableName: 'customers',
    recordId: data.id,
    newValues: { name: parsed.data.name, email: parsed.data.email || null },
    ipAddress: ip,
    userAgent: ua,
  });
  return NextResponse.json({ customer: data }, { status: 201 });
}
