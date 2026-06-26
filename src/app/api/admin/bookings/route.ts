import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit, mutationRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { sendBookingConfirmed } from '@/lib/email';
import { writeAuditLog } from '@/lib/audit-logger';
import { isValidIsoDate } from '@/lib/date-utils';

export const dynamic = 'force-dynamic';

// 管理者がサロンボードから手動で予約を入れる API（電話・飛び込み代行）。
// 顧客フロー POST /api/booking と異なり email 任意・user_id なし・status=confirmed 固定。
// 二重予約は顧客フローと同じ create_booking_atomic（FOR UPDATE ロック）で原理的に防止する。
const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
const adminBookingSchema = z.object({
  facility_id: z.string().uuid(),
  staff_id: z.string().uuid().nullable().optional(),
  menu_ids: z.array(z.string().uuid()).min(1).max(20),
  // 形式に加え実在する暦日かを検証する（2026-02-30 等を弾く。RPC 内の date キャスト失敗を未然に防止）。
  booking_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isValidIsoDate, '有効な日付を入力してください'),
  start_time: z.string().regex(timeRegex),
  end_time: z.string().regex(timeRegex),
  customer_name: z.string().min(1).max(100),
  email: z.string().email().max(254).nullable().optional(),
  phone: z.string().max(20).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

// 認証ユーザーが facility の owner/admin か検証し、userId を返す（IDOR 防止）
async function verifyFacilityAdmin(facilityId: string): Promise<string | null> {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user.id)
    .eq('facility_id', facilityId)
    .in('role', ['owner', 'admin'])
    .single();
  return data ? user.id : null;
}

export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = getClientIp(request);
  if (await checkRateLimit(mutationRateLimit, ip, 30, 60_000, 'admin-booking-create')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const parsed = adminBookingSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  const d = parsed.data;

  if (d.start_time >= d.end_time) {
    return NextResponse.json({ error: '開始時間は終了時間より前にしてください' }, { status: 400 });
  }

  const userId = await verifyFacilityAdmin(d.facility_id);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();

  // メニューを自施設で検証し料金を合計（他施設メニュー混入を拒否＝IDOR防止）
  const { data: menuRows } = await admin
    .from('facility_menus')
    .select('id, name, price')
    .in('id', d.menu_ids)
    .eq('facility_id', d.facility_id);
  const menuList: { id: string; name: string; price: number | null }[] = menuRows ?? [];
  const validIds = new Set(menuList.map((r) => r.id));
  if (!d.menu_ids.every((id) => validIds.has(id))) {
    return NextResponse.json({ error: 'メニューが見つかりません' }, { status: 400 });
  }
  let totalPrice = menuList.reduce((s, r) => s + (r.price ?? 0), 0);

  // スタッフ指定時は自施設所属を検証し、指名料を加算
  let staffName: string | undefined;
  if (d.staff_id) {
    const { data: staffRow } = await admin
      .from('staff_profiles')
      .select('name, nomination_fee')
      .eq('id', d.staff_id)
      .eq('facility_id', d.facility_id)
      .maybeSingle();
    if (!staffRow) return NextResponse.json({ error: 'スタッフが見つかりません' }, { status: 400 });
    staffName = staffRow.name ?? undefined;
    if (staffRow.nomination_fee) totalPrice += staffRow.nomination_fee;
  }

  // アトミック作成（status=confirmed・user_id なし）
  const { data: rpcResult, error } = await admin.rpc('create_booking_atomic', {
    p_facility_id: d.facility_id,
    p_staff_id: d.staff_id ?? null,
    p_user_id: null,
    p_menu_id: d.menu_ids[0],
    p_coupon_id: null,
    p_booking_date: d.booking_date,
    p_start_time: d.start_time,
    p_end_time: d.end_time,
    p_customer_name: d.customer_name,
    p_email: d.email ?? null,
    p_phone: d.phone ?? null,
    p_note: d.note ?? null,
    p_total_price: totalPrice,
    p_points_used: 0,
    p_status: 'confirmed',
  });

  if (error) {
    if (error.message?.includes('BOOKING_CONFLICT') || error.code === '23505') {
      return NextResponse.json({ error: 'この時間帯は既に予約が入っています' }, { status: 409 });
    }
    return NextResponse.json({ error: '予約に失敗しました' }, { status: 500 });
  }
  const newId: string = rpcResult || '';
  if (!newId) return NextResponse.json({ error: '予約に失敗しました' }, { status: 500 });

  // 複数メニュー予約は menu_ids 列に全メニューを保存（menu_id には先頭1件しか入らず表示が1件目のみに
  // なる・A6）。料金・所要時間は合算済みで正しい。失敗は致命でないため warn のみ。単一時はスキップ。
  if (d.menu_ids.length > 1) {
    const { error: menuIdsErr } = await admin.from('bookings').update({ menu_ids: d.menu_ids }).eq('id', newId);
    if (menuIdsErr) console.error('[admin-bookings] menu_ids persist failed', { bookingId: newId, err: menuIdsErr.message });
  }

  void writeAuditLog({
    userId,
    facilityId: d.facility_id,
    action: 'create',
    tableName: 'bookings',
    recordId: newId,
    newValues: { customer_name: d.customer_name, booking_date: d.booking_date, start_time: d.start_time, status: 'confirmed' },
  });

  // メールがある場合のみ確認メール送信（fire-and-forget）
  if (d.email) {
    const { data: facility } = await admin.from('facility_profiles').select('name').eq('id', d.facility_id).single();
    void sendBookingConfirmed({
      bookingId: newId,
      customerName: d.customer_name,
      customerEmail: d.email,
      facilityName: facility?.name ?? '',
      bookingDate: d.booking_date,
      startTime: d.start_time,
      endTime: d.end_time,
      menuName: menuList.map((r) => r.name).filter(Boolean).join('、'),
      staffName,
      totalPrice,
    });
  }

  return NextResponse.json({ success: true, id: newId }, { status: 201 });
}
