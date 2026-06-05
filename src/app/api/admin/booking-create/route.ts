import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { writeAuditLog } from '@/lib/audit-logger';
import { safeCaptureException } from '@/lib/safe';

export const dynamic = 'force-dynamic';

const timeRegex = /^\d{2}:\d{2}$/;

// 店頭/電話予約の登録スキーマ（email は任意 = 氏名のみで登録可能）
const createSchema = z.object({
  staff_id: z.string().uuid().nullable().optional(),
  menu_id: z.string().uuid().nullable().optional(),
  booking_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です'),
  start_time: z.string().regex(timeRegex, '開始時刻が不正です'),
  end_time: z.string().regex(timeRegex, '終了時刻が不正です'),
  customer_name: z.string().min(1, 'お名前は必須です').max(100),
  email: z.string().email().max(254).or(z.literal('')).nullable().optional(),
  phone: z.string().max(20).or(z.literal('')).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
  source: z.enum(['walk_in', 'phone']).optional(),
});

async function getAdminFacilityId(request: NextRequest): Promise<string | null> {
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

  return data?.facility_id ?? null;
}

export async function POST(request: NextRequest) {
  try {
    const csrfError = checkCsrf(request);
    if (csrfError) return csrfError;

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
    if (inMemoryRateLimit(ip, 30, 60_000, 'admin-booking-create')) {
      return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
    }

    const facilityId = await getAdminFacilityId(request);
    if (!facilityId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
    }

    const d = parsed.data;
    if (d.start_time >= d.end_time) {
      return NextResponse.json({ error: '開始時刻は終了時刻より前にしてください' }, { status: 400 });
    }

    const admin = createServiceRoleClient();

    // メニューが指定された場合は当該施設のものか検証し、料金を取得
    let totalPrice: number | null = null;
    if (d.menu_id) {
      const { data: menu } = await admin
        .from('facility_menus')
        .select('id, price')
        .eq('id', d.menu_id)
        .eq('facility_id', facilityId)
        .maybeSingle();
      if (!menu) {
        return NextResponse.json({ error: 'メニューが見つかりません' }, { status: 400 });
      }
      totalPrice = menu.price ?? null;
    }

    // スタッフが指定された場合は当該施設のものか検証
    if (d.staff_id) {
      const { data: staff } = await admin
        .from('staff_profiles')
        .select('id')
        .eq('id', d.staff_id)
        .eq('facility_id', facilityId)
        .maybeSingle();
      if (!staff) {
        return NextResponse.json({ error: 'スタッフが見つかりません' }, { status: 400 });
      }
    }

    const emailValue = d.email && d.email.length > 0 ? d.email : null;
    const phoneValue = d.phone && d.phone.length > 0 ? d.phone : null;

    // 競合チェック＋INSERT を advisory lock で原子化（同時2リクエストの二重予約を防止）。
    // check-then-insert を別トランザクションで行うと phantom-insert レースが残るため RPC に集約。
    const { data: insertedId, error } = await admin.rpc('create_admin_booking_atomic', {
      p_facility_id: facilityId,
      p_staff_id: d.staff_id ?? null,
      p_menu_id: d.menu_id ?? null,
      p_booking_date: d.booking_date,
      p_start_time: d.start_time,
      p_end_time: d.end_time,
      p_customer_name: d.customer_name,
      p_email: emailValue,
      p_phone: phoneValue,
      p_note: d.note ?? null,
      p_total_price: totalPrice,
      p_source: d.source ?? 'walk_in',
    });

    if (error) {
      if (typeof error.message === 'string' && error.message.includes('BOOKING_CONFLICT')) {
        return NextResponse.json({ error: 'この時間帯は既に予約が入っています' }, { status: 409 });
      }
      return NextResponse.json({ error: '登録に失敗しました' }, { status: 500 });
    }

    const supabaseAuth = await createServerSupabaseAuthClient();
    const { data: { user } } = await supabaseAuth.auth.getUser();
    void writeAuditLog({
      userId: user?.id ?? null,
      facilityId,
      action: 'create',
      tableName: 'bookings',
      recordId: (insertedId as string) ?? null,
      oldValues: null,
      newValues: { customer_name: d.customer_name, booking_date: d.booking_date, start_time: d.start_time, source: d.source ?? 'walk_in' },
      ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0] ?? null,
      userAgent: request.headers.get('user-agent') ?? null,
    });

    return NextResponse.json({ success: true, id: insertedId as string });
  } catch (e) {
    safeCaptureException(e, 'admin-booking-create');
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}
