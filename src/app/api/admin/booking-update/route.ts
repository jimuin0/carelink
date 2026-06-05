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

    // 対象予約を取得（原子的更新で全項目の最終値を渡すため customer 情報も取得）
    const { data: booking } = await admin
      .from('bookings')
      .select('id, facility_id, staff_id, menu_id, booking_date, start_time, end_time, customer_name, email, phone, note, total_price')
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

    // メニュー変更時は施設所属を検証し料金を再計算（未変更なら既存料金を維持）
    let nextTotalPrice: number | null = booking.total_price ?? null;
    if (d.menu_id !== undefined && d.menu_id !== null) {
      const { data: menu } = await admin
        .from('facility_menus')
        .select('id, price')
        .eq('id', d.menu_id)
        .eq('facility_id', booking.facility_id)
        .maybeSingle();
      if (!menu) return NextResponse.json({ error: 'メニューが見つかりません' }, { status: 400 });
      nextTotalPrice = menu.price ?? null;
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

    // 変更後の全フィールド最終値（未指定は既存値を維持）
    const nextMenuId = d.menu_id !== undefined ? d.menu_id : booking.menu_id;
    const nextCustomerName = d.customer_name !== undefined ? d.customer_name : booking.customer_name;
    const nextEmail = d.email !== undefined ? (d.email && d.email.length > 0 ? d.email : null) : booking.email;
    const nextPhone = d.phone !== undefined ? (d.phone && d.phone.length > 0 ? d.phone : null) : booking.phone;
    const nextNote = d.note !== undefined ? d.note : booking.note;

    // 競合チェック＋UPDATE を advisory lock で原子化（同時変更による二重予約を防止）
    const { data: updatedId, error } = await admin.rpc('update_admin_booking_atomic', {
      p_booking_id: booking.id,
      p_facility_id: booking.facility_id,
      p_staff_id: nextStaffId ?? null,
      p_menu_id: nextMenuId ?? null,
      p_booking_date: nextDate,
      p_start_time: nextStart,
      p_end_time: nextEnd,
      p_customer_name: nextCustomerName,
      p_email: nextEmail,
      p_phone: nextPhone,
      p_note: nextNote,
      p_total_price: nextTotalPrice,
    });

    if (error) {
      if (typeof error.message === 'string' && error.message.includes('BOOKING_CONFLICT')) {
        return NextResponse.json({ error: 'この時間帯は既に予約が入っています' }, { status: 409 });
      }
      return NextResponse.json({ error: '更新に失敗しました' }, { status: 500 });
    }
    if (!updatedId) {
      return NextResponse.json({ error: '予約が見つかりません' }, { status: 404 });
    }

    void writeAuditLog({
      userId: user.id,
      facilityId: booking.facility_id,
      action: 'update',
      tableName: 'bookings',
      recordId: booking.id,
      oldValues: { staff_id: booking.staff_id, booking_date: booking.booking_date, start_time: booking.start_time, end_time: booking.end_time },
      newValues: { staff_id: nextStaffId, menu_id: nextMenuId, booking_date: nextDate, start_time: nextStart, end_time: nextEnd, total_price: nextTotalPrice },
      ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0] ?? null,
      userAgent: request.headers.get('user-agent') ?? null,
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    safeCaptureException(e, 'admin-booking-update');
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}
