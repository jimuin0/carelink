import type { Database } from '@/types/database-overrides';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminApiContext } from '@/lib/admin-api-context';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog } from '@/lib/audit-logger';
import { serverError } from '@/lib/with-route';
import { isValidIsoDate } from '@/lib/date-utils';
import { staffMutationError } from '@/lib/staff-mutation';

type ScheduleOverrideInsert = Database['public']['Tables']['schedule_overrides']['Insert'];

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

const scheduleSchema = z.object({
  operation_id: z.string().uuid(),
  schedules: z.array(z.object({
    day_of_week: z.number().int().min(0).max(6),
    start_time: z.string().regex(TIME_REGEX),
    end_time: z.string().regex(TIME_REGEX),
  })).max(7),
}).refine(
  // 【恒久根治】同じ曜日を複数件送っても zod は素通りし、insert 後に day_of_week 単位で
  // 判定する get_available_slots 側が後勝ち/不定の挙動になる（意図しない曜日の枠が消える）。
  // 入口で重複を明確な 400 として拒否する。
  (data) => new Set(data.schedules.map((s) => s.day_of_week)).size === data.schedules.length,
  { message: '同じ曜日が複数含まれています', path: ['schedules'] },
);

const overrideSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isValidIsoDate),
  is_holiday: z.boolean(),
  start_time: z.string().regex(TIME_REGEX).optional().nullable(),
  end_time: z.string().regex(TIME_REGEX).optional().nullable(),
}).refine(data => data.is_holiday || (data.start_time == null) === (data.end_time == null), { message: '開始時間と終了時間を両方入力してください' });

const deleteOverrideSchema = z.object({
  override_id: z.string().uuid(),
});


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

  const auth = await getAdminApiContext(request, params.id);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => null);
  const parsed = scheduleSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: '入力内容を確認してください。古い画面は再読み込みしてから保存してください。', details: parsed.error.flatten() }, { status: 400 });

  const admin = createServiceRoleClient();

  // Validate times
  for (const s of parsed.data.schedules) {
    if (s.end_time <= s.start_time) {
      return NextResponse.json({ error: '終了時間は開始時間より後にしてください' }, { status: 400 });
    }
  }

  const { data, error } = await admin.rpc('replace_staff_schedules_atomic', {
    p_actor_id: auth.userId, p_facility_id: auth.facilityId, p_staff_id: params.id,
    p_operation_id: parsed.data.operation_id, p_schedules: parsed.data.schedules,
    p_force: (body as { force?: unknown }).force === true,
  });
  if (error) return staffMutationError(error, 'admin-staff-schedule-put', '/api/admin/staff/[id]/schedule');
  const affected = z.object({ code: z.literal('BOOKINGS_AFFECTED'), affectedBookings: z.number().int().positive() }).safeParse(data);
  if (affected.success) return NextResponse.json({ ...affected.data, error: `この変更で担当者が不在になる予約が${affected.data.affectedBookings}件あります。` }, { status: 409 });
  if (!z.object({ ok: z.literal(true), replayed: z.boolean() }).safeParse(data).success) {
    return serverError('admin-staff-schedule-put-result', new Error('Invalid transaction result'), '/api/admin/staff/[id]/schedule');
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

  const auth = await getAdminApiContext(request, params.id);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => null);
  const parsed = overrideSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: '入力内容を確認してください。古い画面は再読み込みしてから保存してください。', details: parsed.error.flatten() }, { status: 400 });

  if (!parsed.data.is_holiday && parsed.data.start_time && parsed.data.end_time) {
    if (parsed.data.end_time <= parsed.data.start_time) {
      return NextResponse.json({ error: '終了時間は開始時間より後にしてください' }, { status: 400 });
    }
  }

  const admin = createServiceRoleClient();

  const row: ScheduleOverrideInsert = {
    staff_id: params.id, date: parsed.data.date, is_holiday: parsed.data.is_holiday,
    start_time: parsed.data.is_holiday ? null : parsed.data.start_time ?? null,
    end_time: parsed.data.is_holiday ? null : parsed.data.end_time ?? null,
  };
  const { data, error } = await admin.rpc('save_staff_override_atomic', {
    p_actor_id: auth.userId, p_facility_id: auth.facilityId, p_staff_id: params.id,
    p_date: row.date, p_is_holiday: parsed.data.is_holiday,
    p_start_time: row.start_time ?? null, p_end_time: row.end_time ?? null,
    p_force: (body as { force?: unknown }).force === true,
  });
  if (error) return staffMutationError(error, 'admin-staff-schedule-post', '/api/admin/staff/[id]/schedule');
  const affected = z.object({ code: z.literal('BOOKINGS_AFFECTED'), affectedBookings: z.number().int().positive() }).safeParse(data);
  if (affected.success) return NextResponse.json({ ...affected.data, error: `この特別日設定で担当者が不在になる予約が${affected.data.affectedBookings}件あります。` }, { status: 409 });
  if (!z.object({ ok: z.literal(true) }).safeParse(data).success) {
    return serverError('admin-staff-schedule-post-result', new Error('Invalid transaction result'), '/api/admin/staff/[id]/schedule');
  }

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

  const auth = await getAdminApiContext(request, params.id);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => null);
  const parsed = deleteOverrideSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });

  const admin = createServiceRoleClient();
  const { data, error } = await admin.rpc('delete_staff_override_atomic', {
    p_actor_id: auth.userId, p_facility_id: auth.facilityId, p_staff_id: params.id,
    p_override_id: parsed.data.override_id,
  });
  if (error) return staffMutationError(error, 'admin-staff-schedule-delete', '/api/admin/staff/[id]/schedule');
  if (data === false) return NextResponse.json({ error: '休日設定が見つかりません' }, { status: 404 });
  if (data !== true) return serverError('admin-staff-schedule-delete-result', new Error('Invalid transaction result'), '/api/admin/staff/[id]/schedule');

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
