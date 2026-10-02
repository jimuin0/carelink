import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit, mutationRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog } from '@/lib/audit-logger';
import { authUnavailable, serverError } from '@/lib/with-route';
import { verifyAuthUser } from '@/lib/auth-verification';
import { isValidIsoDate } from '@/lib/date-utils';

export const dynamic = 'force-dynamic';
const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
const schema = z.object({
  operation_id: z.string().uuid(),
  facility_id: z.string().uuid(),
  staff_id: z.string().uuid().nullable().optional(),
  menu_ids: z.array(z.string().uuid()).min(1).max(20).refine(ids => new Set(ids).size === ids.length),
  booking_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isValidIsoDate),
  start_time: z.string().regex(timeRegex), end_time: z.string().regex(timeRegex),
  customer_name: z.string().trim().min(1).max(100),
  email: z.string().email().max(254).nullable().optional(),
  phone: z.string().max(20).nullable().optional(), note: z.string().max(500).nullable().optional(),
});
const resultSchema = z.object({
  booking_id: z.string().uuid(), replayed: z.boolean(), total_price: z.number().int().nonnegative(),
  menu_names: z.string(), staff_name: z.string().nullable(), facility_name: z.string(),
});

export async function GET(request: NextRequest) {
  try {
    if (await checkRateLimit(null, getClientIp(request), 30, 60_000, 'admin-booking-recovery')) {
      return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
    }
    const params = new URL(request.url).searchParams;
    const input = z.object({ operation_id: z.string().uuid(), facility_id: z.string().uuid() })
      .safeParse({ operation_id: params.get('operation_id'), facility_id: params.get('facility_id') });
    if (!input.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
    const auth = await createServerSupabaseAuthClient();
    const verification = await verifyAuthUser(auth.auth);
    if (verification.state === 'unavailable') return authUnavailable('admin-bookings-recovery', '/api/admin/bookings');
    if (verification.state === 'unauthenticated') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const user = verification.user;
    const { data, error } = await createServiceRoleClient().rpc('get_manual_booking_operation', {
      p_actor_id: user.id, p_operation_id: input.data.operation_id, p_facility_id: input.data.facility_id,
    });
    if (error?.code === '42501') return NextResponse.json({ error: '店舗を管理する権限がありません' }, { status: 403 });
    if (error) return serverError('admin-bookings-recovery', error, '/api/admin/bookings', '予約結果の照合に失敗しました');
    const checked = z.discriminatedUnion('state', [
      z.object({ state: z.literal('saved'), booking_id: z.string().uuid() }),
      z.object({ state: z.literal('absent') }), z.object({ state: z.literal('retired') }),
    ]).safeParse(data);
    if (!checked.success) return serverError('admin-bookings-recovery-result', new Error('invalid recovery result'), '/api/admin/bookings', '予約結果の照合に失敗しました');
    return NextResponse.json(checked.data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return serverError('admin-bookings-recovery', error, '/api/admin/bookings', '予約結果の照合に失敗しました');
  }
}

export async function POST(request: NextRequest) {
  try {
    const csrfError = checkCsrf(request);
    if (csrfError) return csrfError;
    if (await checkRateLimit(mutationRateLimit, getClientIp(request), 30, 60_000, 'admin-booking-create')) {
      return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
    }
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
    const d = parsed.data;
    if (d.start_time >= d.end_time) return NextResponse.json({ error: '開始時間は終了時間より前にしてください' }, { status: 400 });
    const auth = await createServerSupabaseAuthClient();
    const verification = await verifyAuthUser(auth.auth);
    if (verification.state === 'unavailable') return authUnavailable('admin-bookings-create', '/api/admin/bookings');
    if (verification.state === 'unauthenticated') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const user = verification.user;
    const { data: member, error: memberError } = await auth.from('facility_members')
      .select('facility_id').eq('user_id', user.id).eq('facility_id', d.facility_id)
      .in('role', ['owner', 'admin']).maybeSingle();
    if (memberError) return serverError('admin-bookings-membership', memberError, '/api/admin/bookings', '権限の確認に失敗しました');
    if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    // Price, current authorization, reservation, all menus and immutable
    // operation record are committed together. A retry does not create again.
    const { data, error } = await createServiceRoleClient().rpc('create_manual_booking_atomic', {
      p_actor_id: user.id, p_operation_id: d.operation_id,
      p_input: { facility_id: d.facility_id, staff_id: d.staff_id ?? null, menu_ids: d.menu_ids,
        booking_date: d.booking_date, start_time: d.start_time, end_time: d.end_time,
        customer_name: d.customer_name, email: d.email ?? null, phone: d.phone ?? null, note: d.note ?? null },
    });
    if (error) {
      if (error.code === '42501') return NextResponse.json({ error: '店舗を管理する権限がありません' }, { status: 403 });
      if (error.message.includes('BOOKING_CONFLICT')) return NextResponse.json({ code: 'BOOKING_CONFLICT', error: 'この時間帯は既に予約が入っています' }, { status: 409 });
      if (/MANUAL_OPERATION_(CONFLICT|RETIRED)/.test(error.message)) {
        return NextResponse.json({ code: 'MANUAL_OPERATION_RECOVERY', error: 'この操作は変更または削除済みです。同じ操作で原予約を照合してください' }, { status: 409 });
      }
      if (/MANUAL_(INPUT_INVALID|MENU_UNAVAILABLE|STAFF_UNAVAILABLE|PRICE_INVALID|FACILITY_UNAVAILABLE)/.test(error.message)) {
        return NextResponse.json({ error: '店舗・メニュー・スタッフ・入力内容を確認してください' }, { status: 400 });
      }
      return serverError('admin-bookings-create-rpc', error, '/api/admin/bookings', '予約結果を確認できません。同じ操作で再確認してください');
    }
    const result = resultSchema.safeParse(data);
    if (!result.success) return serverError('admin-bookings-create-result', new Error('invalid manual booking result'), '/api/admin/bookings', '予約結果を確認できません。同じ操作で再確認してください');
    const saved = result.data;
    if (saved.replayed) return NextResponse.json({ success: true, id: saved.booking_id, replayed: true, notification: 'not_repeated' });
    void writeAuditLog({ userId: user.id, facilityId: d.facility_id, action: 'create', tableName: 'bookings',
      recordId: saved.booking_id, newValues: { booking_date: d.booking_date, start_time: d.start_time, status: 'confirmed' } });
    // The RPC atomically reserved the unique notification. Its worker can
    // resume even if this process ends now. Queued is not provider acceptance.
    const notification = d.email ? 'queued' : 'not_requested';
    return NextResponse.json({ success: true, id: saved.booking_id, replayed: false, notification }, { status: 201 });
  } catch (error) {
    return serverError('admin-bookings-create', error, '/api/admin/bookings', '予約結果を確認できません。同じ操作で再確認してください');
  }
}
