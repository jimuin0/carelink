import { NextRequest, NextResponse } from 'next/server';
import { getAdminApiContext } from '@/lib/admin-api-context';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import { serverError } from '@/lib/with-route';
import { staffMutationError } from '@/lib/staff-mutation';

const staffSchema = z.object({
  operation_id: z.string().uuid(),
  name: z.string().trim().min(1).max(50),
  position: z.string().max(50).optional().nullable(),
  bio: z.string().max(500).optional().nullable(),
  specialties: z.array(z.string().max(50)).max(20).optional(),
  years_experience: z.number().int().min(0).max(99).optional().nullable(),
  instagram_url: z.string().url().max(200).optional().nullable().or(z.literal('')),
  nomination_fee: z.number().int().min(0).max(99999).optional(),
  line_works_channel_id: z.string().max(50).optional().nullable(),
  line_works_notify_all: z.boolean().optional(),
});


export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'admin-staff-post')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const auth = await getAdminApiContext(request);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => null);
  const parsed = staffSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: '入力内容を確認してください。古い画面は再読み込みしてから追加してください。', details: parsed.error.flatten() }, { status: 400 });

  const admin = createServiceRoleClient();
  const { operation_id, ...input } = parsed.data;
  const { data, error } = await admin.rpc('create_staff_with_schedules_atomic', {
    p_actor_id: auth.userId, p_facility_id: auth.facilityId,
    p_operation_id: operation_id, p_input: input,
  });
  if (error) return staffMutationError(error, 'admin-staff-create', '/api/admin/staff');
  const result = z.object({ staff: z.object({ id: z.string().uuid() }).passthrough(), replayed: z.boolean() }).safeParse(data);
  if (!result.success) return serverError('admin-staff-create-result', result.error, '/api/admin/staff');
  const staff = result.data.staff;

  const { ua } = getRequestContext(request);
  void writeAuditLog({
    userId: auth.userId,
    facilityId: auth.facilityId,
    action: 'create',
    tableName: 'staff_profiles',
    recordId: staff.id,
    newValues: { name: parsed.data.name, position: parsed.data.position ?? null, nomination_fee: parsed.data.nomination_fee ?? 0 },
    ipAddress: ip,
    userAgent: ua,
  });
  return NextResponse.json({ staff, replayed: result.data.replayed }, { status: 201 });
}

// Reload recovery runs under the operation lock so an in-flight first request
// commits or rolls back before the browser starts another creation.
export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 30, 60_000, 'admin-staff-recovery')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const auth = await getAdminApiContext(request);
  if (auth instanceof NextResponse) return auth;
  const input = z.object({ operation_id: z.string().uuid(), kind: z.enum(['create', 'weekly']), staff_id: z.string().uuid().nullable() }).safeParse({
    operation_id: request.nextUrl.searchParams.get('operation_id'), kind: request.nextUrl.searchParams.get('kind') ?? 'create',
    staff_id: request.nextUrl.searchParams.get('staff_id'),
  });
  if (!input.success || (input.data.kind === 'weekly' && input.data.staff_id === null)) {
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }
  const { data, error } = await createServiceRoleClient().rpc('get_staff_mutation_operation', {
    p_actor_id: auth.userId, p_facility_id: auth.facilityId,
    p_operation_id: input.data.operation_id, p_kind: input.data.kind, p_staff_id: input.data.staff_id,
  });
  if (error) return staffMutationError(error, 'admin-staff-recovery', '/api/admin/staff');
  const result = z.discriminatedUnion('state', [
    z.object({ state: z.literal('absent') }), z.object({ state: z.literal('retired') }),
    z.object({ state: z.literal('saved'), staff_id: z.string().uuid() }),
  ]).safeParse(data);
  if (!result.success) return serverError('admin-staff-recovery-result', result.error, '/api/admin/staff');
  return NextResponse.json(result.data, { headers: { 'Cache-Control': 'no-store' } });
}
