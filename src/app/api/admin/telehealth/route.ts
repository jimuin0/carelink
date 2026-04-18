import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';

const telehealthSchema = z.object({
  user_id: z.string().uuid().optional().nullable(),
  scheduled_at: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)),
  duration_minutes: z.number().int().min(5).max(480),
  meeting_url: z.string().url().max(500).optional().nullable().or(z.literal('')),
  platform: z.string().max(50).optional(),
  patient_notes: z.string().max(2000).optional().nullable(),
  fee: z.number().int().min(0).max(9999999).optional(),
});

async function getAdminFacilityId(request: NextRequest): Promise<string | null> {
  const supabase = createServerSupabaseAuthClient();
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

  return data?.facility_id ?? null;
}

export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 20, 60_000, 'admin-telehealth-post')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const facilityId = await getAdminFacilityId(request);
  if (!facilityId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = telehealthSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  // If user_id provided, verify they belong to this facility via a booking
  if (parsed.data.user_id) {
    const admin = createServiceRoleClient();
    const { data: booking } = await admin
      .from('bookings')
      .select('id')
      .eq('facility_id', facilityId)
      .eq('user_id', parsed.data.user_id)
      .limit(1)
      .maybeSingle();
    if (!booking) return NextResponse.json({ error: 'このユーザーはこの施設に予約がありません' }, { status: 403 });
  }

  const admin = createServiceRoleClient();
  const { data, error } = await admin.from('telehealth_sessions').insert({
    facility_id: facilityId,
    user_id: parsed.data.user_id ?? null,
    scheduled_at: parsed.data.scheduled_at,
    duration_minutes: parsed.data.duration_minutes,
    meeting_url: parsed.data.meeting_url || null,
    platform: parsed.data.platform ?? 'external',
    patient_notes: parsed.data.patient_notes ?? null,
    fee: parsed.data.fee ?? 0,
  }).select().single();

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  return NextResponse.json({ session: data }, { status: 201 });
}
