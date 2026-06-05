import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

const scheduleSchema = z.object({
  schedules: z.array(z.object({
    day_of_week: z.number().int().min(0).max(6),
    start_time: z.string().regex(TIME_REGEX),
    end_time: z.string().regex(TIME_REGEX),
  })).max(7),
});

const overrideSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  is_holiday: z.boolean(),
  start_time: z.string().regex(TIME_REGEX).optional().nullable(),
  end_time: z.string().regex(TIME_REGEX).optional().nullable(),
});

const deleteOverrideSchema = z.object({
  override_id: z.string().uuid(),
});

async function getAdminFacilityIdAndVerifyStaff(
  request: NextRequest,
  staffId: string
): Promise<string | null> {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const facilityId = request.nextUrl.searchParams.get('facility_id');
  if (!facilityId || !UUID_REGEX.test(facilityId)) return null;

  // Verify user is admin/owner of the facility
  const { data: membership } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user.id)
    .eq('facility_id', facilityId)
    .in('role', ['owner', 'admin'])
    .single();

  if (!membership) return null;

  // Verify the staff belongs to the facility
  const admin = createServiceRoleClient();
  const { data: staff } = await admin
    .from('staff_profiles')
    .select('id')
    .eq('id', staffId)
    .eq('facility_id', facilityId)
    .single();

  return staff ? facilityId : null;
}

// PUT: Replace all weekly schedules for a staff member
export async function PUT(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'staff-schedule-put')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: '不正なIDです' }, { status: 400 });

  const facilityId = await getAdminFacilityIdAndVerifyStaff(request, params.id);
  if (!facilityId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = scheduleSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  const admin = createServiceRoleClient();

  // Validate times
  for (const s of parsed.data.schedules) {
    if (s.end_time <= s.start_time) {
      return NextResponse.json({ error: '終了時間は開始時間より後にしてください' }, { status: 400 });
    }
  }

  // Delete then insert
  const { error: deleteErr } = await admin.from('staff_schedules').delete().eq('staff_id', params.id);
  if (deleteErr) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

  if (parsed.data.schedules.length > 0) {
    const rows = parsed.data.schedules.map((s) => ({
      staff_id: params.id,
      day_of_week: s.day_of_week,
      start_time: s.start_time,
      end_time: s.end_time,
    }));
    const { error } = await admin.from('staff_schedules').insert(rows);
    if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// POST: Add or update a schedule override
export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'staff-schedule-post')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: '不正なIDです' }, { status: 400 });

  const facilityId = await getAdminFacilityIdAndVerifyStaff(request, params.id);
  if (!facilityId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = overrideSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  if (!parsed.data.is_holiday && parsed.data.start_time && parsed.data.end_time) {
    if (parsed.data.end_time <= parsed.data.start_time) {
      return NextResponse.json({ error: '終了時間は開始時間より後にしてください' }, { status: 400 });
    }
  }

  const admin = createServiceRoleClient();
  const row: Record<string, unknown> = {
    staff_id: params.id,
    date: parsed.data.date,
    is_holiday: parsed.data.is_holiday,
  };
  if (!parsed.data.is_holiday) {
    row.start_time = parsed.data.start_time ?? null;
    row.end_time = parsed.data.end_time ?? null;
  }

  const { error } = await admin.from('schedule_overrides').upsert(row, { onConflict: 'staff_id,date' });
  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  return NextResponse.json({ ok: true }, { status: 201 });
}

// DELETE: Remove a schedule override
export async function DELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 10, 60_000, 'staff-schedule-delete')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: '不正なIDです' }, { status: 400 });

  const facilityId = await getAdminFacilityIdAndVerifyStaff(request, params.id);
  if (!facilityId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = deleteOverrideSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });

  const admin = createServiceRoleClient();
  // Ensure the override belongs to this staff member (and thus this facility)
  const { error } = await admin
    .from('schedule_overrides')
    .delete()
    .eq('id', parsed.data.override_id)
    .eq('staff_id', params.id);

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
