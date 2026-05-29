import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { writeAuditLog } from '@/lib/audit-logger';
import { safeCaptureException } from '@/lib/safe';

export const dynamic = 'force-dynamic';

const timeRegex = /^\d{2}:\d{2}$/;

// 予約の内容変更（時間移動・スタッフ/メニュー変更・顧客情報修正）。
// ステータス変更は /api/admin/booking-status を利用する。
const updateSchema = z.object({
  booking_id: z.string().uuid(),
  staff_id: z.string().uuid().nullable().optional(),
  menu_id: z.string().uuid().nullable().optional(),
  booking_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  start_time: z.string().regex(timeRegex).optional(),
  end_time: z.string().regex(timeRegex).optional(),
  customer_name: z.string().min(1).max(100).optional(),
  email: z.string().email().max(254).or(z.literal('')).nullable().optional(),
  phone: z.string().max(20).or(z.literal('')).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const csrfError = checkCsrf(request);
    if (csrfError) return csrfError;

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
    if (inMemoryRateLimit(ip, 30, 60_000, 'admin-booking-update')) {
      return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
    }

    const authClient = await createServerSupabaseAuthClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => null);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
    }

    const d = parsed.data;
    const admin = createServiceRoleClient();

    // 対象予約を取得
    const { data: booking } = await admin
      .from('bookings')
      .select('id, facility_id, staff_id, menu_id, booking_date, start_time, end_time')
      .eq('id', d.booking_id)
      .single();

    // 権限チェック: 当該施設の owner/admin であること（存在しない場合も 404 で ID 列挙を防ぐ）
    const membership = booking
      ? await admin
          .from('facility_members')
          .select('facility_id')
          .eq('user_id', user.id)
          .eq('facility_id', booking.facility_id)
          .in('role', ['owner', 'admin'])
          .maybeSingle()
          .then((r) => r.data)
      : null;

    if (!booking || !membership) {
      return NextResponse.json({ error: '予約が見つかりません' }, { status: 404 });
    }

    // 変更後の値（未指定は既存値を維持）
    const nextStaffId = d.staff_id !== undefined ? d.staff_id : booking.staff_id;
    const nextDate = d.booking_date ?? booking.booking_date;
    const nextStart = d.start_time ?? booking.start_time.slice(0, 5);
    const nextEnd = d.end_time ?? booking.end_time.slice(0, 5);

    if (nextStart >= nextEnd) {
      return NextResponse.json({ error: '開始時刻は終了時刻より前にしてください' }, { status: 400 });
    }

    // メニュー変更時は施設所属を検証し料金を再計算
    let totalPriceUpdate: { total_price: number | null } | Record<string, never> = {};
    if (d.menu_id !== undefined && d.menu_id !== null) {
      const { data: menu } = await admin
        .from('facility_menus')
        .select('id, price')
        .eq('id', d.menu_id)
        .eq('facility_id', booking.facility_id)
        .maybeSingle();
      if (!menu) return NextResponse.json({ error: 'メニューが見つかりません' }, { status: 400 });
      totalPriceUpdate = { total_price: menu.price ?? null };
    }

    // スタッフ変更時は施設所属を検証
    if (d.staff_id !== undefined && d.staff_id !== null) {
      const { data: staff } = await admin
        .from('staff_profiles')
        .select('id')
        .eq('id', d.staff_id)
        .eq('facility_id', booking.facility_id)
        .maybeSingle();
      if (!staff) return NextResponse.json({ error: 'スタッフが見つかりません' }, { status: 400 });
    }

    // 競合チェック（自分自身を除外）
    if (nextStaffId) {
      const { data: conflicts } = await admin
        .from('bookings')
        .select('id')
        .eq('facility_id', booking.facility_id)
        .eq('staff_id', nextStaffId)
        .eq('booking_date', nextDate)
        .neq('id', booking.id)
        .not('status', 'in', '("cancelled","no_show")')
        .lt('start_time', nextEnd)
        .gt('end_time', nextStart);
      if (conflicts && conflicts.length > 0) {
        return NextResponse.json({ error: 'この時間帯は既に予約が入っています' }, { status: 409 });
      }
    }

    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      ...totalPriceUpdate,
    };
    if (d.staff_id !== undefined) updatePayload.staff_id = d.staff_id;
    if (d.menu_id !== undefined) updatePayload.menu_id = d.menu_id;
    if (d.booking_date !== undefined) updatePayload.booking_date = d.booking_date;
    if (d.start_time !== undefined) updatePayload.start_time = d.start_time;
    if (d.end_time !== undefined) updatePayload.end_time = d.end_time;
    if (d.customer_name !== undefined) updatePayload.customer_name = d.customer_name;
    if (d.email !== undefined) updatePayload.email = d.email && d.email.length > 0 ? d.email : null;
    if (d.phone !== undefined) updatePayload.phone = d.phone && d.phone.length > 0 ? d.phone : null;
    if (d.note !== undefined) updatePayload.note = d.note;

    const { data: updated, error } = await admin
      .from('bookings')
      .update(updatePayload)
      .eq('id', booking.id)
      .eq('facility_id', booking.facility_id)
      .select('id');

    if (error) {
      return NextResponse.json({ error: '更新に失敗しました' }, { status: 500 });
    }
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: '予約が見つかりません' }, { status: 404 });
    }

    void writeAuditLog({
      userId: user.id,
      facilityId: booking.facility_id,
      action: 'update',
      tableName: 'bookings',
      recordId: booking.id,
      oldValues: { staff_id: booking.staff_id, booking_date: booking.booking_date, start_time: booking.start_time, end_time: booking.end_time },
      newValues: updatePayload,
      ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0] ?? null,
      userAgent: request.headers.get('user-agent') ?? null,
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    safeCaptureException(e, 'admin-booking-update');
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}
