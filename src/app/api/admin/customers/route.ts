import { NextRequest, NextResponse } from 'next/server';
import { getAdminApiContext } from '@/lib/admin-api-context';
import { manageAdminCustomer } from '@/lib/admin-customer-write';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import { customerSchema } from '@/lib/validations';
import { zodErrorResponse } from '@/lib/api-validation';

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

  const data = await manageAdminCustomer({actorId:auth.userId,facilityId:auth.facilityId,customerId:null,action:'create',values:{
    name: parsed.data.name, name_kana: parsed.data.name_kana ?? null,
    email: parsed.data.email || null, phone: parsed.data.phone ?? null,
    birthday: parsed.data.birthday || null, gender: parsed.data.gender ?? null, notes: parsed.data.notes ?? null,
  }});
  if (data instanceof NextResponse) return data;

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
