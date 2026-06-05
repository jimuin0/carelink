import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog } from '@/lib/audit-logger';

const telehealthSchema = z.object({
  user_id: z.string().uuid().optional().nullable(),
  scheduled_at: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)),
  duration_minutes: z.number().int().min(5).max(480),
  meeting_url: z.string().url().max(500).refine(
    (u) => /^https?:\/\//i.test(u),
    { message: 'meeting_url must be http(s)' }
  ).optional().nullable().or(z.literal('')),
  platform: z.string().max(50).optional(),
  patient_notes: z.string().max(2000).optional().nullable(),
  fee: z.number().int().min(0).max(9999999).optional(),
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
  if (await checkRateLimit(null, ip, 20, 60_000, 'admin-telehealth-post')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const auth = await getAdminInfo(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = telehealthSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  const admin = createServiceRoleClient();

  // If user_id provided, verify they belong to this facility via a booking
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

  const { data, error } = await admin.from('telehealth_sessions').insert({
    facility_id: auth.facilityId,
    user_id: parsed.data.user_id ?? null,
    scheduled_at: parsed.data.scheduled_at,
    duration_minutes: parsed.data.duration_minutes,
    meeting_url: parsed.data.meeting_url || null,
    platform: parsed.data.platform ?? 'external',
    patient_notes: parsed.data.patient_notes ?? null,
    fee: parsed.data.fee ?? 0,
  }).select().single();

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

  void writeAuditLog({
    userId: auth.userId,
    facilityId: auth.facilityId,
    action: 'create',
    tableName: 'telehealth_sessions',
    recordId: data.id,
    newValues: { user_id: parsed.data.user_id ?? null, scheduled_at: parsed.data.scheduled_at, duration_minutes: parsed.data.duration_minutes },
    ipAddress: ip,
  });

  return NextResponse.json({ session: data }, { status: 201 });
}
