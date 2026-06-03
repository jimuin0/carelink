import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog } from '@/lib/audit-logger';

const treatmentRecordSchema = z.object({
  user_id: z.string().uuid().optional().nullable(),
  menu_name: z.string().max(100).optional().nullable(),
  treated_at: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)),
  subjective: z.string().max(2000).optional().nullable(),
  objective: z.string().max(2000).optional().nullable(),
  assessment: z.string().max(2000).optional().nullable(),
  plan: z.string().max(2000).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  next_visit_note: z.string().max(500).optional().nullable(),
});


async function getAdminInfo(request: NextRequest): Promise<{ facilityId: string; userId: string } | null> {
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

  return data ? { facilityId: data.facility_id, userId: user.id } : null;
}

export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'admin-treatment-records-post')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const auth = await getAdminInfo(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = treatmentRecordSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  const admin = createServiceRoleClient();

  // user_id が指定された場合、その施設に予約があるユーザーのみ許可（IDOR 防止）
  if (parsed.data.user_id) {
    const { data: booking } = await admin
      .from('bookings')
      .select('id')
      .eq('facility_id', auth.facilityId)
      .eq('user_id', parsed.data.user_id)
      .limit(1)
      .maybeSingle();
    if (!booking) return NextResponse.json({ error: 'このユーザーはこの施設に予約がありません' }, { status: 403 });
  }

  const { data, error } = await admin.from('treatment_records').insert({
    facility_id: auth.facilityId,
    user_id: parsed.data.user_id ?? null,
    menu_name: parsed.data.menu_name ?? null,
    treated_at: parsed.data.treated_at,
    subjective: parsed.data.subjective ?? null,
    objective: parsed.data.objective ?? null,
    assessment: parsed.data.assessment ?? null,
    plan: parsed.data.plan ?? null,
    notes: parsed.data.notes ?? null,
    next_visit_note: parsed.data.next_visit_note ?? null,
  }).select().single();

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

  void writeAuditLog({
    userId: auth.userId,
    facilityId: auth.facilityId,
    action: 'create',
    tableName: 'treatment_records',
    recordId: data.id,
    newValues: { user_id: parsed.data.user_id ?? null, treated_at: parsed.data.treated_at, menu_name: parsed.data.menu_name ?? null },
    ipAddress: ip,
  });

  return NextResponse.json({ record: data }, { status: 201 });
}
