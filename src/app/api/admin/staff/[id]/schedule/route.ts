import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog } from '@/lib/audit-logger';
import { todayJst } from '@/lib/admin-date';
import type { SupabaseClient } from '@supabase/supabase-js';

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

// TIME 列は "HH:MM:SS" で返る。スケジュール入力は "HH:MM"。比較のため先頭5文字("HH:MM")に揃える。
function hhmm(t: string): string {
  return t.slice(0, 5);
}

// 週間スケジュール変更(PUT)で「担当者不在」になる既存予約の件数を数える。
// 対象＝今日以降の pending/confirmed 予約のうち、その日に override が【無く】(override 日は
// override 側が支配するため対象外)、新スケジュールで当該曜日が休み、または予約時間が新勤務時間の
// 外にはみ出すもの。get_available_slots の判定(勤務窓が予約を包含するか)と整合させる。
async function countBookingsOrphanedByWeekly(
  admin: SupabaseClient,
  staffId: string,
  newSchedules: { day_of_week: number; start_time: string; end_time: string }[],
): Promise<number> {
  const today = todayJst();
  const { data: futureBookings } = await admin
    .from('bookings')
    .select('booking_date, start_time, end_time')
    .eq('staff_id', staffId)
    .gte('booking_date', today)
    .in('status', ['pending', 'confirmed']);
  const { data: ovRows } = await admin
    .from('schedule_overrides')
    .select('date')
    .eq('staff_id', staffId)
    .gte('date', today);
  const overrideDates = new Set(((ovRows ?? []) as { date: string }[]).map((o) => o.date));
  const byDow = new Map<number, { start: string; end: string }>();
  for (const s of newSchedules) byDow.set(s.day_of_week, { start: s.start_time, end: s.end_time });

  return ((futureBookings ?? []) as { booking_date: string; start_time: string; end_time: string }[]).filter((b) => {
    if (overrideDates.has(b.booking_date)) return false; // override 日は POST 側で管理
    // 曜日は Postgres の EXTRACT(DOW) と揃えるため UTC 基準で算出する。
    const dow = new Date(`${b.booking_date}T00:00:00Z`).getUTCDay();
    const entry = byDow.get(dow);
    if (!entry) return true; // 当該曜日が休みになる → 不在
    return hhmm(b.start_time) < entry.start || hhmm(b.end_time) > entry.end; // 勤務時間外へはみ出す
  }).length;
}

// 特別日設定(POST)で「担当者不在」になる既存予約の件数を数える。
// 休日化＝その日の pending/confirmed 全件。時間変更＝新時間の外にはみ出す予約のみ。
async function countBookingsOrphanedByOverride(
  admin: SupabaseClient,
  staffId: string,
  date: string,
  isHoliday: boolean,
  startTime: string | null | undefined,
  endTime: string | null | undefined,
): Promise<number> {
  const { data: dayBookings } = await admin
    .from('bookings')
    .select('start_time, end_time')
    .eq('staff_id', staffId)
    .eq('booking_date', date)
    .in('status', ['pending', 'confirmed']);
  const rows = (dayBookings ?? []) as { start_time: string; end_time: string }[];
  if (isHoliday) return rows.length;
  // 時間変更で開始/終了が指定された場合のみ絞り込む。未指定(週間へフォールバック)は不在を生まない。
  if (startTime && endTime) {
    return rows.filter((b) => hhmm(b.start_time) < startTime || hhmm(b.end_time) > endTime).length;
  }
  return 0;
}

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
): Promise<{ userId: string; facilityId: string } | null> {
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

  return staff ? { userId: user.id, facilityId } : null;
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

  const auth = await getAdminFacilityIdAndVerifyStaff(request, params.id);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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

  // 既存予約への影響ガード（発症前予防）。新スケジュールで担当者不在になる既存予約があれば、
  // 無警告で上書きせず 409 + 件数を返す。管理者が確認して force:true で再送すれば実行する
  // （従来の変更能力は force で維持＝非破壊）。旧実装はここが無く、確定予約のあるスタッフを
  // 休みにしても客の予約はそのまま残り、当日担当者不在になる事故を検知できなかった。
  const forcePut = (body as { force?: unknown } | null)?.force === true;
  if (!forcePut) {
    const affected = await countBookingsOrphanedByWeekly(admin, params.id, parsed.data.schedules);
    if (affected > 0) {
      return NextResponse.json(
        { error: `この変更で担当者が不在になる予約が${affected}件あります。`, affectedBookings: affected, code: 'BOOKINGS_AFFECTED' },
        { status: 409 },
      );
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

  // 予約可用性に直結する重要操作のため監査ログに残す（fire-and-forget）。
  void writeAuditLog({
    userId: auth.userId,
    facilityId: auth.facilityId,
    action: 'update',
    tableName: 'staff_schedules',
    recordId: params.id,
    newValues: { schedules: parsed.data.schedules },
    ipAddress: ip,
  });

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

  const auth = await getAdminFacilityIdAndVerifyStaff(request, params.id);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = overrideSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  if (!parsed.data.is_holiday && parsed.data.start_time && parsed.data.end_time) {
    if (parsed.data.end_time <= parsed.data.start_time) {
      return NextResponse.json({ error: '終了時間は開始時間より後にしてください' }, { status: 400 });
    }
  }

  const admin = createServiceRoleClient();

  // 既存予約への影響ガード（PUT と同じ発症前予防）。休日化/時間短縮で担当者不在になる予約が
  // あれば 409 + 件数を返し、force:true で再送された時のみ実行する。
  const forcePost = (body as { force?: unknown } | null)?.force === true;
  if (!forcePost) {
    const affected = await countBookingsOrphanedByOverride(
      admin, params.id, parsed.data.date, parsed.data.is_holiday, parsed.data.start_time, parsed.data.end_time,
    );
    if (affected > 0) {
      return NextResponse.json(
        { error: `この特別日設定で担当者が不在になる予約が${affected}件あります。`, affectedBookings: affected, code: 'BOOKINGS_AFFECTED' },
        { status: 409 },
      );
    }
  }

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

  void writeAuditLog({
    userId: auth.userId,
    facilityId: auth.facilityId,
    action: 'update',
    tableName: 'schedule_overrides',
    recordId: params.id,
    newValues: row,
    ipAddress: ip,
  });

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

  const auth = await getAdminFacilityIdAndVerifyStaff(request, params.id);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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

  void writeAuditLog({
    userId: auth.userId,
    facilityId: auth.facilityId,
    action: 'delete',
    tableName: 'schedule_overrides',
    recordId: parsed.data.override_id,
    ipAddress: ip,
  });

  return NextResponse.json({ ok: true });
}
